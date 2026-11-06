import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  CredentialDetailUnavailable,
  createPostgresProxyCredentialDetail,
  InvalidCredentialDetailInput,
} from '../src/gateway/postgres-proxy-credential-detail.ts';
import { createPostgresProxyCredentialHistory } from '../src/gateway/postgres-proxy-credential-history.ts';
import { createPostgresProxyCredentialStore } from '../src/gateway/postgres-proxy-credentials.ts';
import { createProxyTokenService } from '../src/gateway/proxy-tokens.ts';

const query = { principalId: 'alice', credentialId: 'chosen', observedAt: 200 };
const row = (extra = {}) => ({
  credential_id: 'chosen',
  principal_id: 'alice',
  created_at_ms: '100',
  expires_at_ms: '300',
  revoked_at_ms: null,
  ...extra,
});
test('detail queries exact IDs and projects only lifecycle metadata', async () => {
  let sql = '';
  let params: readonly unknown[] = [];
  const read = createPostgresProxyCredentialDetail({
    query: async (text, values) => {
      sql = text;
      params = values;
      return { rows: [row({ token_digest: 'not allowed', token: 'never', actor_id: 'hidden' })] };
    },
  });
  assert.deepEqual(await read(query), {
    credentialId: 'chosen',
    principalId: 'alice',
    createdAt: 100,
    expiresAt: 300,
    revokedAt: null,
    state: 'active',
  });
  assert.match(sql, /WHERE principal_id = \$1 AND credential_id = \$2/u);
  assert.match(sql, /LIMIT 2/u);
  assert.doesNotMatch(sql, /token|digest|SELECT\s+\*/iu);
  assert.deepEqual(params, ['alice', 'chosen']);
});
test('detail is absent for empty rows and reports inclusive expiry with revocation precedence', async () => {
  assert.equal(
    await createPostgresProxyCredentialDetail({ query: async () => ({ rows: [] }) })(query),
    null,
  );
  for (const [extra, state] of [
    [{ expires_at_ms: '200' }, 'expired'],
    [{ expires_at_ms: '201' }, 'active'],
    [{ revoked_at_ms: '150', expires_at_ms: '200' }, 'revoked'],
    [{ revoked_at_ms: '150' }, 'revoked'],
  ] as const) {
    const read = createPostgresProxyCredentialDetail({
      query: async () => ({ rows: [row(extra)] }),
    });
    assert.equal((await read(query))?.state, state);
  }
});
test('invalid detail inputs fail before querying', async () => {
  let calls = 0;
  const read = createPostgresProxyCredentialDetail({
    query: async () => {
      calls++;
      return { rows: [] };
    },
  });
  const invalid: unknown[] = [
    null,
    [],
    undefined,
    {},
    { ...query, observedAt: -1 },
    { ...query, observedAt: 0.1 },
    { ...query, observedAt: Number.MAX_SAFE_INTEGER + 1 },
  ];
  for (const field of ['principalId', 'credentialId']) {
    for (const value of ['', 'a\n', '\0', '\u007f', '\ud800', 'a'.repeat(257), null, 3]) {
      invalid.push({ ...query, [field]: value });
    }
  }
  for (const input of invalid) {
    await assert.rejects(read(input as typeof query), InvalidCredentialDetailInput);
  }
  assert.equal(calls, 0);
});
test('detail rejects corrupt cardinality, scope and timestamp output without partial results', async () => {
  const invalid: unknown[] = [
    null,
    {},
    [row(), row()],
    [null],
    [row({ principal_id: 'bob' })],
    [row({ credential_id: 'other' })],
    [row({ created_at_ms: '01' })],
    [row({ created_at_ms: '-1' })],
    [row({ created_at_ms: 100 })],
    [row({ expires_at_ms: '100' })],
    [row({ expires_at_ms: '9007199254740992' })],
    [row({ revoked_at_ms: '99' })],
    [row({ revoked_at_ms: undefined })],
    [row({ revoked_at_ms: '-1' })],
    [row({ revoked_at_ms: '01' })],
  ];
  for (const rows of invalid) {
    const read = createPostgresProxyCredentialDetail({
      query: async () => ({ rows: rows as readonly unknown[] }),
    });
    await assert.rejects(
      read(query),
      (error: unknown) =>
        error instanceof CredentialDetailUnavailable &&
        error.message === 'Credential detail unavailable' &&
        error.cause === undefined,
    );
  }
});
test('driver failures are private', async () => {
  const read = createPostgresProxyCredentialDetail({
    query: async () => {
      throw new Error('password=private SELECT token_digest');
    },
  });
  await assert.rejects(
    read(query),
    (error: unknown) =>
      error instanceof CredentialDetailUnavailable &&
      error.message === 'Credential detail unavailable' &&
      !JSON.stringify(error).includes('private'),
  );
});
test('detail captures identifiers and trusted observation time before driver await', async () => {
  const mutable = { ...query };
  const read = createPostgresProxyCredentialDetail({
    query: async () => {
      mutable.principalId = 'bob';
      mutable.credentialId = 'other';
      mutable.observedAt = 900;
      await Promise.resolve();
      return { rows: [row()] };
    },
  });
  const result = await read(mutable);
  assert.equal(result?.principalId, 'alice');
  assert.equal(result?.credentialId, 'chosen');
  assert.equal(result?.state, 'active');
});
test('migrated lifecycle: issue -> inventory -> detail -> revoke -> fresh detail and verification denial', async () => {
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
    const issued = await service.issue({
      principalId: 'alice',
      actorId: 'admin',
      requestId: 'issue',
      expiresAt: 300,
    });
    const inventory = await createPostgresProxyCredentialHistory(client)({
      principalId: 'alice',
      limit: 1,
      observedAt: 200,
      cursor: null,
    });
    const selected = inventory.credentials[0];
    assert.ok(selected);
    const read = createPostgresProxyCredentialDetail(client);
    const detailQuery = { ...query, credentialId: selected.credentialId };
    const active = await read(detailQuery);
    assert.deepEqual(active, selected);
    assert.equal(active?.credentialId, issued.credentialId);
    assert.equal(JSON.stringify(active).includes(issued.token), false);
    assert.equal(await read({ ...detailQuery, principalId: 'bob' }), null);
    assert.equal(await read({ ...detailQuery, credentialId: 'unknown' }), null);
    assert.equal((await read({ ...detailQuery, observedAt: 300 }))?.state, 'expired');
    assert.ok(await service.verifyCredential(issued.token));
    now = 200;
    await service.revoke({
      credentialId: selected.credentialId,
      actorId: 'admin',
      requestId: 'revoke',
    });
    const revoked = await read(detailQuery);
    assert.equal(revoked?.state, 'revoked');
    assert.equal(revoked?.revokedAt, 200);
    assert.equal(await service.verifyCredential(issued.token), undefined);
    assert.deepEqual(
      (
        await db.query<{ action: string }>(
          'SELECT action FROM proxy_credential_events ORDER BY event_id',
        )
      ).rows,
      [{ action: 'issued' }, { action: 'revoked' }],
    );
  } finally {
    await db.close();
  }
});
