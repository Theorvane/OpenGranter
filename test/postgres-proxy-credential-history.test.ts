import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  CredentialHistoryUnavailable,
  createPostgresProxyCredentialHistory,
  InvalidCredentialHistoryInput,
} from '../src/gateway/postgres-proxy-credential-history.ts';
import { createPostgresProxyCredentialStore } from '../src/gateway/postgres-proxy-credentials.ts';
import { createProxyTokenService } from '../src/gateway/proxy-tokens.ts';

const query = { principalId: 'alice', limit: 1, observedAt: 200, cursor: null };
const row = (id = 'z', created = '100', extra = {}) => ({
  credential_id: id,
  principal_id: 'alice',
  created_at_ms: created,
  expires_at_ms: '300',
  revoked_at_ms: null,
  ...extra,
});
test('projects only nonsecret metadata and returns the visible continuation', async () => {
  let sql = '';
  let params: readonly unknown[] = [];
  const read = createPostgresProxyCredentialHistory({
    query: async (text, values) => {
      sql = text;
      params = values;
      return { rows: [row('z', '100', { token_digest: 'never expose' }), row('a')] };
    },
  });
  assert.deepEqual(await read(query), {
    credentials: [
      {
        credentialId: 'z',
        principalId: 'alice',
        createdAt: 100,
        expiresAt: 300,
        revokedAt: null,
        state: 'active',
      },
    ],
    hasMore: true,
    nextCursor: { createdAt: 100, credentialId: 'z' },
  });
  assert.ok(!sql.includes('token_digest'));
  assert.match(sql, /COLLATE "C"/u);
  assert.deepEqual(params, ['alice', null, null, 2]);
});
test('empty page and lifecycle precedence including exact expiry', async () => {
  const read = createPostgresProxyCredentialHistory({ query: async () => ({ rows: [] }) });
  assert.deepEqual(await read(query), { credentials: [], hasMore: false, nextCursor: null });
  for (const [extra, state] of [
    [{ expires_at_ms: '200' }, 'expired'],
    [{ revoked_at_ms: '150', expires_at_ms: '200' }, 'revoked'],
    [{ revoked_at_ms: '150' }, 'revoked'],
  ] as const) {
    const read = createPostgresProxyCredentialHistory({
      query: async () => ({ rows: [row('z', '100', extra)] }),
    });
    assert.equal((await read(query)).credentials[0]?.state, state);
  }
});
test('invalid query fails before SQL', async () => {
  let calls = 0;
  const read = createPostgresProxyCredentialHistory({
    query: async () => {
      calls++;
      return { rows: [] };
    },
  });
  for (const change of [
    { principalId: '' },
    { principalId: 'a\u0000' },
    { principalId: '\ud800' },
    { principalId: 'a'.repeat(257) },
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { observedAt: -1 },
    { observedAt: Number.NaN },
    { observedAt: Number.MAX_SAFE_INTEGER + 1 },
    { cursor: undefined },
    { cursor: {} },
    { cursor: { createdAt: -1, credentialId: 'z' } },
    { cursor: { createdAt: 100, credentialId: '' } },
  ])
    await assert.rejects(
      read({ ...query, ...change } as typeof query),
      InvalidCredentialHistoryInput,
    );
  assert.equal(calls, 0);
});
test('validates the whole page including scope, lookahead, ordering and cursor', async () => {
  for (const rows of [
    [row('z', '100', { principal_id: 'bob' })],
    [row(), row('a', '100', { expires_at_ms: '100' })],
    [row('a'), row('z')],
    [row(), row()],
    [row(), row('a', '101')],
    [row('z', '-1')],
    [row('z', '01')],
    [row('z', '9007199254740992')],
    [row('z', '100', { revoked_at_ms: '99' })],
    [row('z', '100', { expires_at_ms: 300 })],
    [row('bad\ud800')],
    [null],
    [row(), row('a'), row('b')],
  ]) {
    const read = createPostgresProxyCredentialHistory({ query: async () => ({ rows }) });
    await assert.rejects(read(query), CredentialHistoryUnavailable);
  }
  const read = createPostgresProxyCredentialHistory({ query: async () => ({ rows: [row()] }) });
  await assert.rejects(
    read({ ...query, cursor: { createdAt: 100, credentialId: 'z' } }),
    CredentialHistoryUnavailable,
  );
});
test('SQL failure is fixed and private', async () => {
  const read = createPostgresProxyCredentialHistory({
    query: async () => {
      throw new Error('secret connection');
    },
  });
  await assert.rejects(read(query), {
    name: 'CredentialHistoryUnavailable',
    message: 'Credential history unavailable',
  });
});
test('migration002 SQL: isolated stable paging, UTF8 tie ordering and fresh revocation', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL('../migrations/002_proxy_credentials.sql', import.meta.url), 'utf8'),
    );
    for (const [id, owner, created, expires] of [
      ['z', 'alice', 100, 300],
      ['é', 'alice', 100, 200],
      ['😀', 'alice', 100, 300],
      ['\ue000', 'alice', 100, 300],
      ['old', 'alice', 50, 150],
      ['other', 'bob', 200, 300],
    ] as const)
      await db.query(
        'INSERT INTO proxy_credentials (credential_id, principal_id, token_digest, created_at_ms, expires_at_ms) VALUES ($1,$2,$3,$4,$5)',
        [id, owner, 'a'.repeat(64), created, expires],
      );
    const client = {
      query: async (sql: string, params: readonly unknown[]) => db.query(sql, [...params]),
    };
    const read = createPostgresProxyCredentialHistory(client);
    const ids: string[] = [];
    let cursor: { createdAt: number; credentialId: string } | null = null;
    for (;;) {
      const page = await read({ ...query, cursor });
      ids.push(...page.credentials.map((entry) => entry.credentialId));
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }
    assert.deepEqual(ids, ['😀', '\ue000', 'é', 'z', 'old']);
    await db.query('UPDATE proxy_credentials SET revoked_at_ms=150 WHERE credential_id=$1', ['😀']);
    assert.equal((await read(query)).credentials[0]?.state, 'revoked');
    const all = await read({ ...query, limit: 100 });
    assert.equal(all.credentials.find((entry) => entry.credentialId === 'é')?.state, 'expired');
    assert.equal(JSON.stringify(all).includes('token_digest'), false);
    assert.equal(
      (await read({ ...query, principalId: 'bob', cursor: { createdAt: 100, credentialId: 'z' } }))
        .credentials.length,
      0,
    );
    assert.equal(
      (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM proxy_credential_events'))
        .rows[0]?.n,
      0,
    );
  } finally {
    await db.close();
  }
});

test('captures target, time and cursor before SQL await', async () => {
  const mutable = { ...query, cursor: { createdAt: 200, credentialId: 'z' } };
  let release: ((value: { rows: unknown[] }) => void) | undefined;
  const read = createPostgresProxyCredentialHistory({
    query: async () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const pending = read(mutable);
  mutable.principalId = 'bob';
  mutable.observedAt = 999;
  mutable.cursor.createdAt = 0;
  release?.({ rows: [row()] });
  const result = await pending;
  assert.equal(result.credentials[0]?.principalId, 'alice');
  assert.equal(result.credentials[0]?.state, 'active');
});

test('real issue and revoke are discoverable without exposing credentials or writing read events', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL('../migrations/002_proxy_credentials.sql', import.meta.url), 'utf8'),
    );
    const client = {
      query: async (sql: string, params: readonly unknown[]) => db.query(sql, [...params]),
    };
    let now = 100;
    const service = createProxyTokenService({
      store: createPostgresProxyCredentialStore(client),
      now: () => now,
    });
    const read = createPostgresProxyCredentialHistory(client);
    const issued = await service.issue({
      principalId: 'alice',
      actorId: 'admin',
      requestId: 'issue',
      expiresAt: 300,
    });
    const active = await read(query);
    assert.equal(active.credentials[0]?.credentialId, issued.credentialId);
    assert.equal(active.credentials[0]?.state, 'active');
    assert.equal(JSON.stringify(active).includes(issued.token), false);
    assert.ok(await service.verifyCredential(issued.token));
    now = 200;
    const selected = active.credentials[0];
    assert.ok(selected);
    await service.revoke({
      credentialId: selected.credentialId,
      actorId: 'admin',
      requestId: 'revoke',
    });
    const revoked = await read(query);
    assert.equal(revoked.credentials[0]?.state, 'revoked');
    assert.equal(revoked.credentials[0]?.revokedAt, 200);
    assert.equal(await service.verifyCredential(issued.token), undefined);
    assert.deepEqual(
      (
        await db.query<{ action: string }>(
          'SELECT action FROM proxy_credential_events ORDER BY event_id',
        )
      ).rows,
      [{ action: 'issued' }, { action: 'revoked' }],
    );
    assert.deepEqual((await read({ ...query, principalId: 'bob' })).credentials, []);
  } finally {
    await db.close();
  }
});
