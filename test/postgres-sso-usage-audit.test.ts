import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresSsoUsageAuditStore } from '../src/audit/postgres-sso-usage.ts';
import { createPostgresSsoUsageHistoryWithAudit } from '../src/gateway/postgres-sso-usage-audited.ts';
import type { SsoUsageAuditEvent } from '../src/gateway/postgres-sso-usage-history.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const event: SsoUsageAuditEvent = {
  requestId: 'r',
  principalId: 'human',
  policyVersions: [{ id: 'p', version: 'v1' }],
  targetPrincipalId: 'human',
  mode: 'self',
  outcome: 'ready',
  count: 0,
};
async function database() {
  const db = new PGlite();
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
  await db.exec(
    await readFile(new URL('../contracts/sso-usage-audit-schema.sql', import.meta.url), 'utf8'),
  );
  return db;
}

test('durable usage metadata is allowlisted, acknowledged and independently queryable', async () => {
  const db = await database();
  try {
    const store = createPostgresSsoUsageAuditStore(
      { query: (sql, params) => db.query(sql, [...params]) },
      () => 100,
    );
    await store.append({
      ...event,
      token: 'private-token',
      query: 'private-query',
      records: ['private-content'],
    } as SsoUsageAuditEvent);
    await store.append({
      ...event,
      principalId: null,
      policyVersions: null,
      targetPrincipalId: null,
      mode: null,
      outcome: 'unauthenticated',
    });
    const rows = (await db.query('SELECT * FROM sso_usage_audit_events ORDER BY event_id')).rows;
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], {
      event_id: 1,
      occurred_at_ms: 100,
      request_id: 'r',
      principal_id: 'human',
      policy_versions: [{ id: 'p', version: 'v1' }],
      target_principal_id: 'human',
      mode: 'self',
      outcome: 'ready',
      record_count: 0,
    });
    assert.equal(JSON.stringify(rows).includes('private'), false);
    assert.equal(JSON.stringify(rows).includes('credential'), false);
    await assert.rejects(
      db.exec('UPDATE sso_usage_audit_events SET record_count = 101 WHERE event_id = 1'),
    );
    await assert.rejects(
      db.exec("UPDATE sso_usage_audit_events SET target_principal_id = 'other' WHERE event_id = 1"),
    );
  } finally {
    await db.close();
  }
});

test('invalid states and identifiers reject before SQL', async () => {
  let calls = 0;
  const store = createPostgresSsoUsageAuditStore(
    {
      query: async () => {
        calls++;
        return { rows: [{ event_id: '1' }] };
      },
    },
    () => 1,
  );
  for (const value of [
    null,
    { ...event, count: 101 },
    { ...event, count: -1 },
    { ...event, count: 0.5 },
    { ...event, outcome: 'forbidden', count: 1 },
    { ...event, outcome: 'unauthenticated' },
    { ...event, principalId: null },
    { ...event, policyVersions: null },
    { ...event, targetPrincipalId: null },
    { ...event, mode: null },
    { ...event, targetPrincipalId: 'other' },
    { ...event, requestId: '' },
    { ...event, requestId: 'x'.repeat(257) },
    { ...event, requestId: 'r\n' },
    { ...event, policyVersions: [{ id: 'p', version: '' }] },
    { ...event, policyVersions: Array(1025).fill({ id: 'p', version: 'v' }) },
  ]) {
    await assert.rejects(store.append(value as SsoUsageAuditEvent), {
      name: 'InvalidSsoUsageAuditEvent',
    });
  }
  assert.equal(calls, 0);
});

test('fixed failures for SQL, invalid acknowledgement and bad clock', async () => {
  for (const rows of [[], [{}], [{ event_id: '0' }], [{ event_id: '1' }, { event_id: '2' }]]) {
    await assert.rejects(
      createPostgresSsoUsageAuditStore({ query: async () => ({ rows }) }, () => 1).append(event),
      { name: 'SsoUsageAuditUnavailable', message: 'SSO usage audit store unavailable' },
    );
  }
  await assert.rejects(
    createPostgresSsoUsageAuditStore(
      {
        query: async () => {
          throw Error('private-sql');
        },
      },
      () => 1,
    ).append(event),
    { message: 'SSO usage audit store unavailable' },
  );
  let calls = 0;
  for (const now of [
    () => -1,
    () => NaN,
    () => {
      throw Error('private-clock');
    },
  ]) {
    await assert.rejects(
      createPostgresSsoUsageAuditStore(
        {
          query: async () => {
            calls++;
            return { rows: [] };
          },
        },
        now,
      ).append(event),
      { message: 'SSO usage audit store unavailable' },
    );
  }
  assert.equal(calls, 0);
});

test('real RFC9068 usage read cannot release results when its concrete audit database fails', async () => {
  const db = await database();
  try {
    const jwt = await createSsoAccessTokenFixture();
    const token = await jwt.token();
    await db.exec(`INSERT INTO iam_principals VALUES ('human', 'human', true);
      INSERT INTO iam_policies VALUES ('p', 'v1', '[{"effect":"Allow","actions":["usage:ReadSelf"],"resources":["principal:human"]}]');
      INSERT INTO iam_roles VALUES ('reader'); INSERT INTO iam_principal_roles VALUES ('human', 'reader'); INSERT INTO iam_role_policies VALUES ('reader', 'p');`);
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    const service = createPostgresSsoUsageHistoryWithAudit({
      ...jwt.config,
      client: { query: (sql, params) => db.query(sql, [...params]) },
    });
    assert.equal((await service.read(token, 'empty', '')).state, 'ready');
    assert.equal((await service.read(token, 'denied', '?principal_id=other')).state, 'forbidden');
    assert.equal((await service.read(token, 'bad-query', '?unknown=x')).state, 'invalid_query');
    assert.equal((await service.read('bad-token', 'anonymous', '')).state, 'unauthenticated');
    const rows = (
      await db.query<{ outcome: string; principal_id: string | null; record_count: number }>(
        'SELECT outcome,principal_id,record_count FROM sso_usage_audit_events ORDER BY event_id',
      )
    ).rows;
    assert.deepEqual(
      rows.map((row) => row.outcome),
      ['ready', 'forbidden', 'invalid_query', 'unauthenticated'],
    );
    assert.equal(rows[3]?.principal_id, null);
    const client = {
      query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]),
    };
    await createPostgresUsageLedger(client)(
      buildUsageRecord({
        principalId: 'human',
        credentialId: 'original-credential',
        policyVersions: [],
        requestId: 'original-chat',
        attemptId: 'attempt-1',
        modelAlias: 'chat',
        routeKind: 'managed',
        upstreamModelId: 'model',
        selectedCandidateId: 'candidate',
        occurredAt: 1,
        latencyMs: 1,
        outcome: 'succeeded',
        possiblyBilled: true,
        possibleDuplicate: false,
      }),
    );
    const populated = await service.read(token, 'populated', '');
    assert.equal(populated.state, 'ready');
    if (populated.state !== 'ready' || populated.format !== 'json') throw Error('expected JSON');
    assert.equal(populated.data.length, 1);
    const persisted = (
      await db.query<{ record_count: number }>(
        "SELECT record_count FROM sso_usage_audit_events WHERE request_id = 'populated'",
      )
    ).rows;
    assert.equal(persisted[0]?.record_count, 1);
    await db.exec('DROP TABLE sso_usage_audit_events');
    assert.deepEqual(await service.read(token, 'blocked', ''), { state: 'audit_unavailable' });
  } finally {
    await db.close();
  }
});

test('caller mutation cannot change allowlisted values after SQL dispatch', async () => {
  let release!: () => void;
  let sent: readonly unknown[] = [];
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store = createPostgresSsoUsageAuditStore(
    {
      query: async (_sql, params) => {
        sent = params;
        await wait;
        return { rows: [{ event_id: '1' }] };
      },
    },
    () => 1,
  );
  const versions = [{ id: 'p', version: 'v1' }];
  const mutable = { ...event, policyVersions: versions };
  const pending = store.append(mutable);
  mutable.requestId = 'changed';
  assert.ok(versions[0]);
  versions[0].version = 'changed';
  release();
  await pending;
  assert.equal(sent[1], 'r');
  assert.equal(sent[3], JSON.stringify([{ id: 'p', version: 'v1' }]));
});
