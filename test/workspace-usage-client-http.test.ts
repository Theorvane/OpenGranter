import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoManagementGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import type { CatalogRequest } from '../src/management/catalog-client.ts';
import { createManagementUsageClient } from '../src/management/workspace-usage-client.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

test('workspace bridge uses canonical owned HTTP, signed JWT and durable scoped history', async () => {
  const jwt = await createSsoAccessTokenFixture();
  const token = await jwt.token();
  const db = new PGlite();
  let ids = 0;
  let reads = 0;
  const connection: PostgresConnection = {
    query: (sql, params) => {
      if (sql.includes('FROM usage_records')) reads++;
      return db.query(sql, [...params]);
    },
    transaction: (callback) =>
      db.transaction((tx) =>
        callback({
          exec: (sql) => tx.exec(sql),
          query: (sql, params) => tx.query(sql, [...params]),
        }),
      ),
    close: () => db.close(),
  };
  const runtime = await startPostgresSsoManagementGateway({
    ...jwt.config,
    host: '127.0.0.1',
    port: 0,
    newRequestId: () => `request-trace-${++ids}`,
    openConnection: () => connection,
  });
  const base = `http://127.0.0.1:${runtime.address.port}`;
  const request: CatalogRequest = (path, init) =>
    fetch(base + path, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
    });
  const client = createManagementUsageClient(request);
  const json = { read: client.list, invalidate: client.invalidate };
  const csv = { read: client.csv, invalidate: client.invalidate };
  try {
    await db.exec(`INSERT INTO iam_principals VALUES ('human','human',true),('foreign','human',true);
        INSERT INTO iam_policies VALUES ('reader','v1','[{"effect":"Allow","actions":["usage:ReadSelf"],"resources":["principal:human"]}]');
        INSERT INTO iam_principal_policies VALUES ('human','reader');`);
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    const append = createPostgresUsageLedger(connection);
    for (const [attemptId, principalId, requestId, occurredAt, modelAlias] of [
      ['a', 'human', 'Trace:/A+1', 100, 'chat'],
      ['b', 'human', 'Trace:/A+1', 200, 'chat'],
      ['c', 'human', 'different', 300, 'chat'],
      ['d', 'foreign', 'Trace:/A+1', 400, 'chat'],
      ['e', 'human', 'Trace:/A+1', 500, 'other'],
      ['f', 'human', 'trace:/A+1', 600, 'chat'],
    ] as const) {
      await append(
        buildUsageRecord({
          attemptId,
          principalId,
          requestId,
          occurredAt,
          modelAlias,
          credentialId: 'prior-proxy',
          policyVersions: [],
          routeKind: 'managed',
          upstreamModelId: 'upstream',
          selectedCandidateId: 'candidate',
          latencyMs: 2,
          outcome: 'succeeded',
          possiblyBilled: true,
          possibleDuplicate: false,
        }),
      );
    }

    const filters = { requestId: 'Trace:/A+1', model: 'chat', fromMs: 100, toMs: 600, limit: 1 };
    const first = await json.read(filters);
    assert.equal(first.state, 'ready');
    if (first.state !== 'ready') throw new Error('Expected first page');
    assert.deepEqual(
      first.data.records.map((row) => row.attemptId),
      ['b'],
    );
    assert.equal(first.data.hasMore, true);
    assert.ok(first.data.nextCursor);
    const second = await json.read({ ...filters, cursor: first.data.nextCursor });
    assert.equal(second.state, 'ready');
    if (second.state !== 'ready') throw new Error('Expected second page');
    assert.deepEqual(
      second.data.records.map((row) => row.attemptId),
      ['a'],
    );
    assert.equal(second.data.hasMore, false);
    const exportFirst = await csv.read(filters);
    assert.equal(exportFirst.state, 'ready');
    if (exportFirst.state !== 'ready') throw new Error('Expected CSV');
    assert.ok(exportFirst.data.csv.includes('Trace:/A+1'));
    assert.ok(!exportFirst.data.csv.includes('foreign'));
    assert.ok(!exportFirst.data.csv.includes('different'));
    assert.equal(exportFirst.data.hasMore, true);
    assert.ok(exportFirst.data.nextCursor);
    const exportSecond = await csv.read({ ...filters, cursor: exportFirst.data.nextCursor });
    assert.equal(exportSecond.state, 'ready');
    if (exportSecond.state !== 'ready') throw new Error('Expected second CSV');
    assert.equal(exportSecond.data.hasMore, false);
    assert.ok(exportSecond.data.csv.includes('Trace:/A+1'));
    assert.ok(!exportSecond.data.csv.includes('trace:/A+1'));
    const empty = await json.read({ requestId: 'absent' });
    assert.deepEqual(empty, {
      state: 'ready',
      data: { records: [], hasMore: false, nextCursor: null },
    });
    const emptyCsv = await csv.read({ requestId: 'absent' });
    assert.equal(emptyCsv.state, 'ready');
    if (emptyCsv.state !== 'ready') throw new Error('Expected empty CSV');
    assert.equal(emptyCsv.data.csv.trim().split('\n').length, 1);
    const wrongCase = await json.read({ ...filters, requestId: 'trace:/A+1', toMs: 700 });
    assert.equal(wrongCase.state, 'ready');
    if (wrongCase.state !== 'ready') throw new Error('Expected case match');
    assert.deepEqual(
      wrongCase.data.records.map((row) => row.attemptId),
      ['f'],
    );
    const beforeDenied = reads;
    for (const client of [json, csv]) {
      assert.deepEqual(await client.read({ ...filters, principalId: 'foreign' }), {
        state: 'denied',
      });
    }
    const anonymous = {
      read: createManagementUsageClient((path, init) => fetch(base + path, init)).list,
    };
    assert.deepEqual(await anonymous.read(filters), { state: 'unauthenticated' });
    assert.equal(reads, beforeDenied);
    const audit = await db.query<{ outcome: string }>(
      'SELECT outcome FROM sso_usage_audit_events ORDER BY event_id',
    );
    assert.deepEqual(
      audit.rows.map((row) => row.outcome),
      [
        'ready',
        'ready',
        'ready',
        'ready',
        'ready',
        'ready',
        'ready',
        'forbidden',
        'forbidden',
        'unauthenticated',
      ],
    );
    await db.exec('DROP TABLE sso_usage_audit_events');
    assert.deepEqual(await json.read(filters), { state: 'unavailable' });
    assert.deepEqual(await csv.read(filters), { state: 'unavailable' });
  } finally {
    json.invalidate();
    csv.invalidate();
    await runtime.close();
  }
});
