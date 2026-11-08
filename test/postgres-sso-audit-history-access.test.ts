import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import { createPostgresSsoAuditHistoryAccessStore } from '../src/audit/postgres-sso-audit-history-access.ts';
import { createPostgresSsoAdministrationBrowserServer } from '../src/gateway/postgres-sso-administration-browser-http.ts';
import type { SsoAuditHistoryAccessEvent } from '../src/gateway/postgres-sso-audit-history.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const event: SsoAuditHistoryAccessEvent = {
  requestId: 'r',
  principalId: 'human',
  policyVersions: [{ id: 'p', version: 'v1' }],
  targetPrincipalId: 'human',
  outcome: 'ready',
  count: 0,
};
async function database() {
  const db = new PGlite();
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
  await db.exec(
    await readFile(
      new URL('../contracts/sso-audit-history-access-schema.sql', import.meta.url),
      'utf8',
    ),
  );
  return db;
}

test('durable audit access metadata is allowlisted, acknowledged and independently queryable', async () => {
  const db = await database();
  try {
    const store = createPostgresSsoAuditHistoryAccessStore(
      { query: (sql, params) => db.query(sql, [...params]) },
      () => 100,
    );
    await store.append({
      ...event,
      token: 'private-token',
      query: 'private-query',
      records: ['private-content'],
    } as SsoAuditHistoryAccessEvent);
    await store.append({
      ...event,
      principalId: null,
      policyVersions: null,
      targetPrincipalId: null,
      outcome: 'unauthenticated',
    });
    const rows = (await db.query('SELECT * FROM sso_audit_history_access_events ORDER BY event_id'))
      .rows;
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], {
      event_id: 1,
      occurred_at_ms: 100,
      request_id: 'r',
      principal_id: 'human',
      policy_versions: [{ id: 'p', version: 'v1' }],
      target_principal_id: 'human',
      outcome: 'ready',
      record_count: 0,
    });
    assert.equal(JSON.stringify(rows).includes('private'), false);
    assert.equal(JSON.stringify(rows).includes('credential'), false);
    await assert.rejects(
      db.exec('UPDATE sso_audit_history_access_events SET record_count = 101 WHERE event_id = 1'),
    );
    await assert.rejects(
      db.exec(
        'UPDATE sso_audit_history_access_events SET target_principal_id = NULL WHERE event_id = 1',
      ),
    );
  } finally {
    await db.close();
  }
});

test('invalid states and identifiers reject before SQL', async () => {
  let calls = 0;
  const store = createPostgresSsoAuditHistoryAccessStore(
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
    { ...event, outcome: 'unknown' },
    { ...event, count: NaN },
    { ...event, count: 101 },
    { ...event, count: -1 },
    { ...event, count: 0.5 },
    { ...event, outcome: 'forbidden', count: 1 },
    { ...event, outcome: 'unauthenticated' },
    { ...event, principalId: null },
    { ...event, policyVersions: null },
    { ...event, targetPrincipalId: null },
    { ...event, outcome: 'invalid_query' },
    { ...event, principalId: 'human\n' },
    { ...event, targetPrincipalId: 'other\u007f' },
    { ...event, requestId: '' },
    { ...event, requestId: 'x'.repeat(257) },
    { ...event, requestId: 'r\n' },
    { ...event, policyVersions: [{ id: 'p', version: '' }] },
    { ...event, policyVersions: Array(1025).fill({ id: 'p', version: 'v' }) },
  ]) {
    await assert.rejects(store.append(value as SsoAuditHistoryAccessEvent), {
      name: 'InvalidSsoAuditHistoryAccessEvent',
    });
  }
  assert.equal(calls, 0);
});

test('fixed failures for SQL, invalid acknowledgement and bad clock', async () => {
  for (const rows of [
    [],
    [null],
    [{}],
    [{ event_id: '0' }],
    [{ event_id: 1 }],
    [{ event_id: '01' }],
    [{ event_id: '-1' }],
    [{ event_id: '1' }, { event_id: '2' }],
  ]) {
    await assert.rejects(
      createPostgresSsoAuditHistoryAccessStore({ query: async () => ({ rows }) }, () => 1).append(
        event,
      ),
      {
        name: 'SsoAuditHistoryAccessUnavailable',
        message: 'SSO audit history access store unavailable',
      },
    );
  }
  await assert.rejects(
    createPostgresSsoAuditHistoryAccessStore(
      {
        query: async () => {
          throw Error('private-sql');
        },
      },
      () => 1,
    ).append(event),
    { message: 'SSO audit history access store unavailable' },
  );
  let calls = 0;
  for (const now of [
    () => -1,
    () => NaN,
    () => 1.5,
    () => Number.MAX_SAFE_INTEGER + 1,
    () => {
      throw Error('private-clock');
    },
  ]) {
    await assert.rejects(
      createPostgresSsoAuditHistoryAccessStore(
        {
          query: async () => {
            calls++;
            return { rows: [] };
          },
        },
        now,
      ).append(event),
      { message: 'SSO audit history access store unavailable' },
    );
  }
  assert.equal(calls, 0);
});

test('signed SSO workspace HTTP JSON/CSV and failures persist access metadata, not proxy events', async () => {
  const db = await database();
  let server: ReturnType<typeof createPostgresSsoAdministrationBrowserServer> | undefined;
  try {
    const jwt = await createSsoAccessTokenFixture();
    const token = await jwt.token();
    await db.exec(`INSERT INTO iam_principals VALUES ('human','human',true),('other','human',true);
      INSERT INTO iam_policies VALUES ('audit','v1','[{"effect":"Allow","actions":["audit:Read"],"resources":["principal:human"]}]');
      INSERT INTO iam_principal_policies VALUES ('human','audit');`);
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    const client = {
      query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]),
    };
    const store = createPostgresSsoAuditHistoryAccessStore(client, () => 100);
    let request = 0;
    server = createPostgresSsoAdministrationBrowserServer({
      ...jwt.config,
      client,
      javascript: 'export {};',
      newRequestId: () => `access-${++request}`,
      writeAuditHistoryAccess: store.append,
    });
    const listeningServer = server;
    await new Promise<void>((resolve) => listeningServer.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const get = (query = '', authorization = `Bearer ${token}`) =>
      fetch(`http://127.0.0.1:${address.port}/management/v1/audit${query}`, {
        headers: { authorization },
      });
    assert.equal((await get()).status, 200);
    for (const principalId of ['human', 'other'])
      await createPostgresGatewayAuditStore(client, () => 1).append({
        kind: 'request-denied',
        reason: 'invalid-request',
        requestId: `gateway-${principalId}`,
        principalId,
        credentialId: 'original-proxy',
        policyVersions: [],
        modelAlias: 'chat',
      });
    const json = await get('?model=chat');
    assert.equal(json.status, 200);
    const body = await json.text();
    assert.match(body, /gateway-human/);
    assert.doesNotMatch(body, /gateway-other|access-1/);
    const csv = await get('?format=csv');
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-disposition') ?? '', /audit.csv/);
    assert.doesNotMatch(await csv.text(), /gateway-other|access-1/);
    assert.equal((await get('?principal_id=other')).status, 403);
    assert.equal((await get('?unknown=private-query')).status, 400);
    assert.equal((await get('?unknown=private-query', 'Bearer private-invalid-token')).status, 401);
    const rows = (
      await db.query<{
        outcome: string;
        record_count: number;
        principal_id: string | null;
        target_principal_id: string | null;
      }>('SELECT * FROM sso_audit_history_access_events ORDER BY event_id')
    ).rows;
    assert.deepEqual(
      rows.map((r) => r.outcome),
      ['ready', 'ready', 'ready', 'forbidden', 'invalid_query', 'unauthenticated'],
    );
    assert.deepEqual(
      rows.map((r) => r.record_count),
      [0, 1, 1, 0, 0, 0],
    );
    assert.equal(rows[3]?.target_principal_id, 'other');
    assert.equal(rows[4]?.target_principal_id, null);
    assert.equal(rows[5]?.principal_id, null);
    assert.doesNotMatch(JSON.stringify(rows), /private-|original-proxy|gateway-human/);
    // History SQL still succeeds with one authorized row, but a missing ACCESS
    // sink must withhold both representations rather than release that row.
    await db.exec('ALTER TABLE sso_audit_history_access_events RENAME TO held_access_events');
    for (const query of ['', '?format=csv']) {
      const response = await get(query);
      assert.equal(response.status, 503);
      assert.doesNotMatch(await response.text(), /gateway-human|sso_audit|private|SELECT|INSERT/);
    }
    await db.exec('ALTER TABLE held_access_events RENAME TO sso_audit_history_access_events');
    await db.exec('DROP TABLE gateway_audit_events');
    assert.equal((await get()).status, 503);
    const failed = (
      await db.query<{ outcome: string }>(
        'SELECT outcome FROM sso_audit_history_access_events ORDER BY event_id DESC LIMIT 1',
      )
    ).rows;
    assert.equal(failed[0]?.outcome, 'unavailable');
  } finally {
    const closingServer = server;
    if (closingServer)
      await new Promise<void>((resolve, reject) =>
        closingServer.close((error) => (error ? reject(error) : resolve())),
      );
    await db.close();
  }
});

test('concrete insert is awaited and snapshots metadata before caller mutation', async () => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let sent: readonly unknown[] = [];
  const versions = [{ id: 'p', version: 'v1' }];
  const mutable = { ...event, policyVersions: versions };
  const store = createPostgresSsoAuditHistoryAccessStore(
    {
      query: async (_sql, params) => {
        entered();
        await barrier;
        sent = params;
        return { rows: [{ event_id: '123' }] };
      },
    },
    () => 1,
  );
  let resolved = false;
  const pending = store.append(mutable).then(() => {
    resolved = true;
  });
  await started;
  assert.equal(resolved, false);
  mutable.requestId = 'changed';
  const policy = versions[0];
  assert.ok(policy);
  policy.version = 'changed';
  release();
  await pending;
  assert.equal(resolved, true);
  assert.equal(sent[1], 'r');
  assert.equal(sent[3], JSON.stringify([{ id: 'p', version: 'v1' }]));
});

test('candidate schema is not activated by the existing migration manifest', async () => {
  const db = new PGlite();
  try {
    for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
    assert.deepEqual(
      (
        await db.query(
          "SELECT tablename FROM pg_tables WHERE tablename = 'sso_audit_history_access_events'",
        )
      ).rows,
      [],
    );
  } finally {
    await db.close();
  }
});
