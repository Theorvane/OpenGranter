import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoManagementGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

for (const browserJavascript of [undefined, 'export {};']) {
  test(`owned SSO listener traces scoped requests; browser=${browserJavascript !== undefined}`, async () => {
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
      ...(browserJavascript === undefined ? {} : { browserJavascript }),
      newRequestId: () => `request-trace-${++ids}`,
      openConnection: () => connection,
    });
    const base = `http://127.0.0.1:${runtime.address.port}/management/v1/usage`;
    async function read(query: string, status = 200) {
      const response = await fetch(`${base}?${query}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const text = await response.text();
      assert.equal(response.status, status, text);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.ok(!text.includes(token));
      return { text, response };
    }
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
      const query = new URLSearchParams({
        request_id: 'Trace:/A+1',
        model: 'chat',
        from_ms: '100',
        to_ms: '600',
        limit: '1',
      });
      const first = JSON.parse((await read(query.toString())).text);
      assert.deepEqual(
        first.data.map((row: { attemptId: string }) => row.attemptId),
        ['b'],
      );
      assert.equal(first.has_more, true);
      assert.equal(typeof first.next_cursor, 'string');
      query.set('cursor', first.next_cursor);
      const second = JSON.parse((await read(query.toString())).text);
      assert.deepEqual(
        second.data.map((row: { attemptId: string }) => row.attemptId),
        ['a'],
      );
      assert.equal(second.has_more, false);
      assert.equal(second.next_cursor, null);
      query.set('format', 'csv');
      const csv = await read(query.toString());
      assert.match(csv.response.headers.get('content-type') ?? '', /^text\/csv/u);
      assert.ok(csv.text.includes('Trace:/A+1'));
      assert.ok(!csv.text.includes('different'));
      assert.ok(!csv.text.includes('foreign'));
      const empty = JSON.parse((await read('request_id=absent')).text);
      assert.deepEqual(empty.data, []);
      const before = reads;
      await read('request_id=Trace%3A%2FA%2B1&principal_id=foreign', 403);
      await read('request_id=', 400);
      await read('request_id=one&request_id=two', 400);
      await read('request_id=%27%20OR%201%3D1', 400);
      assert.equal(reads, before);
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
          'forbidden',
          'invalid_query',
          'invalid_query',
          'invalid_query',
        ],
      );
    } finally {
      await runtime.close();
    }
  });
}
