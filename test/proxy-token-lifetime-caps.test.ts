import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { CredentialSqlClient } from '../src/gateway/postgres-proxy-credentials.ts';
import { createPostgresProxyCredentialStore } from '../src/gateway/postgres-proxy-credentials.ts';
import { createPostgresTokenManagementService } from '../src/gateway/postgres-token-management-service.ts';
import { createProxyTokenService } from '../src/gateway/proxy-tokens.ts';

const day = 86_400_000;
const unavailable = { name: 'TokenManagementUnavailable', message: 'Token management unavailable' };
const denied = { name: 'TokenManagementDenied', message: 'Token management denied' };
const request = (principalId: string, expiresAt: number) => ({
  authenticatedActorId: 'admin',
  requestId: 'lifetime-request',
  principalId,
  expiresAt,
});
const ownerQuery = (sql: string) => sql.startsWith('SELECT principal_id, kind FROM iam_principals');

async function fixture() {
  const db = new PGlite();
  for (const name of [
    '002_proxy_credentials.sql',
    '004_iam_snapshots.sql',
    '008_token_management_decisions.sql',
  ]) {
    await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  await db.exec(`
    INSERT INTO iam_principals VALUES ('admin', 'human', true), ('human-owner', 'human', true), ('service-owner', 'service', true);
    INSERT INTO iam_policies VALUES ('manage', 'v1', '[{"effect":"Allow","actions":["iam:Manage"],"resources":["principal:*"]}]');
    INSERT INTO iam_principal_policies VALUES ('admin', 'manage');
  `);
  const client: CredentialSqlClient = { query: (sql, params) => db.query(sql, [...params]) };
  const now = () => 1_000;
  const service = createPostgresTokenManagementService({ client, now });
  const tokens = createProxyTokenService({
    store: createPostgresProxyCredentialStore(client),
    now,
  });
  const counts = async () => ({
    credentials: (
      await db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM proxy_credentials')
    ).rows[0]?.count,
    events: (
      await db.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM proxy_credential_events',
      )
    ).rows[0]?.count,
  });
  return { db, client, now, service, tokens, counts };
}

for (const [owner, days] of [
  ['human-owner', 30],
  ['service-owner', 90],
] as const) {
  test(`${owner} permits its exact cap and rejects one millisecond beyond`, async () => {
    const f = await fixture();
    try {
      const expiresAt = f.now() + days * day;
      const issued = await f.service.issue(request(owner, expiresAt));
      assert.equal((await f.tokens.verifyCredential(issued.token))?.principalId, owner);
      await assert.rejects(f.service.issue(request(owner, expiresAt + 1)), unavailable);
      assert.deepEqual(await f.counts(), { credentials: 1, events: 1 });
      assert.deepEqual((await f.db.query('SELECT outcome FROM token_management_decisions')).rows, [
        { outcome: 'allowed' },
        { outcome: 'allowed' },
      ]);
    } finally {
      await f.db.close();
    }
  });
}

test('caller kind/cap fields cannot widen the persisted human-owner cap', async () => {
  const f = await fixture();
  try {
    const input = {
      ...request('human-owner', f.now() + 60 * day),
      principalKind: 'service',
      maxLifetimeMs: 90 * day,
    };
    await assert.rejects(f.service.issue(input), unavailable);
    assert.deepEqual(await f.counts(), { credentials: 0, events: 0 });
  } finally {
    await f.db.close();
  }
});

test('the next issuance observes a persisted owner-kind change', async () => {
  const f = await fixture();
  try {
    const input = request('human-owner', f.now() + 60 * day);
    await assert.rejects(f.service.issue(input), unavailable);
    await f.db.exec(
      "UPDATE iam_principals SET kind = 'service' WHERE principal_id = 'human-owner'",
    );
    assert.equal(
      (await f.tokens.verifyCredential((await f.service.issue(input)).token))?.principalId,
      'human-owner',
    );
    assert.deepEqual(await f.counts(), { credentials: 1, events: 1 });
  } finally {
    await f.db.close();
  }
});

test('policy denial and decision-audit failure stop before owner-kind lookup', async () => {
  const f = await fixture();
  let ownerReads = 0;
  const service = createPostgresTokenManagementService({
    now: f.now,
    client: {
      query: (sql, params) => {
        if (ownerQuery(sql)) ownerReads++;
        return f.client.query(sql, params);
      },
    },
  });
  try {
    await f.db.exec(
      'UPDATE iam_policies SET statements = \'[{"effect":"Deny","actions":["iam:Manage"],"resources":["*"]}]\'',
    );
    await assert.rejects(service.issue(request('missing-owner', f.now() + 100 * day)), denied);
    assert.equal(ownerReads, 0);
    await f.db.exec(
      'UPDATE iam_policies SET statements = \'[{"effect":"Allow","actions":["iam:Manage"],"resources":["*"]}]\'; DROP TABLE token_management_decisions',
    );
    await assert.rejects(service.issue(request('human-owner', f.now() + day)), unavailable);
    assert.equal(ownerReads, 0);
    assert.deepEqual(await f.counts(), { credentials: 0, events: 0 });
  } finally {
    await f.db.close();
  }
});

test('missing and malformed owner rows prevent issuance without leaking data', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.service.issue(request('missing-owner', f.now() + day)), unavailable);
    for (const rows of [
      [],
      [{ principal_id: 'wrong', kind: 'human' }],
      [{ principal_id: 'human-owner', kind: 'private-driver-value' }],
      [
        { principal_id: 'human-owner', kind: 'human' },
        { principal_id: 'human-owner', kind: 'service' },
      ],
      [null],
    ]) {
      const service = createPostgresTokenManagementService({
        now: f.now,
        client: {
          query: (sql, params) =>
            ownerQuery(sql) ? Promise.resolve({ rows }) : f.client.query(sql, params),
        },
      });
      await assert.rejects(service.issue(request('human-owner', f.now() + day)), unavailable);
    }
    assert.deepEqual(await f.counts(), { credentials: 0, events: 0 });
    assert.equal(
      JSON.stringify((await f.db.query('SELECT * FROM token_management_decisions')).rows).includes(
        'private-driver-value',
      ),
      false,
    );
  } finally {
    await f.db.close();
  }
});

test('failed owner lookup remains a safe post-authorization failure without mutation', async () => {
  const f = await fixture();
  try {
    const service = createPostgresTokenManagementService({
      now: f.now,
      client: {
        query: (sql, params) =>
          ownerQuery(sql)
            ? Promise.reject(new Error('private-db-error'))
            : f.client.query(sql, params),
      },
    });
    await assert.rejects(service.issue(request('human-owner', f.now() + day)), unavailable);
    assert.deepEqual(await f.counts(), { credentials: 0, events: 0 });
    assert.deepEqual((await f.db.query('SELECT outcome FROM token_management_decisions')).rows, [
      { outcome: 'allowed' },
    ]);
  } finally {
    await f.db.close();
  }
});

test('cap validation and credential creation share one captured issuance time', async () => {
  const f = await fixture();
  let calls = 0;
  try {
    const service = createPostgresTokenManagementService({
      client: f.client,
      now: () => (++calls <= 2 ? 1_000 : 0),
    });
    await service.issue(request('human-owner', 1_000 + 30 * day));
    assert.deepEqual(
      (
        await f.db.query(
          'SELECT created_at_ms::text AS created, expires_at_ms::text AS expires FROM proxy_credentials',
        )
      ).rows,
      [{ created: '1000', expires: String(1_000 + 30 * day) }],
    );
    assert.equal(calls, 2);
  } finally {
    await f.db.close();
  }
});

test('existing long-lived credentials remain revocable', async () => {
  const f = await fixture();
  try {
    const issued = await f.tokens.issue({
      principalId: 'human-owner',
      actorId: 'admin',
      requestId: 'legacy-issue',
      expiresAt: f.now() + 100 * day,
    });
    assert.equal(
      await f.service.revoke({
        authenticatedActorId: 'admin',
        requestId: 'legacy-revoke',
        credentialId: issued.credentialId,
      }),
      true,
    );
    assert.equal(await f.tokens.verifyCredential(issued.token), undefined);
    assert.deepEqual(await f.counts(), { credentials: 1, events: 2 });
  } finally {
    await f.db.close();
  }
});
