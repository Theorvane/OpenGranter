import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoManagementGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import type { CatalogRequest } from '../src/management/catalog-client.ts';
import { createSsoUsageClient } from '../src/management/usage-client.ts';
import { createSsoUsageExportClient } from '../src/management/usage-export-client.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

for (const browserJavascript of [undefined, 'export {};']) {
  test(`explicit SSO runtime serves scoped durable usage; browser=${browserJavascript !== undefined}`, async () => {
    const jwt = await createSsoAccessTokenFixture();
    const token = await jwt.token();
    const db = new PGlite();
    let opens = 0;
    let closes = 0;
    let ids = 0;
    let failSql = false;
    let failAudit = false;
    const connection: PostgresConnection = {
      query: (sql, params) => {
        if (
          (failSql && sql.includes('FROM usage_records')) ||
          (failAudit && sql.includes('INSERT INTO sso_usage_audit_events'))
        ) {
          throw new Error('private database diagnostic');
        }
        return db.query(sql, [...params]);
      },
      transaction: (callback) =>
        db.transaction((tx) =>
          callback({
            exec: (sql) => tx.exec(sql),
            query: (sql, params) => tx.query(sql, [...params]),
          }),
        ),
      close: async () => {
        closes++;
        await db.close();
      },
    };
    const runtime = await startPostgresSsoManagementGateway({
      ...jwt.config,
      host: '127.0.0.1',
      port: 0,
      ...(browserJavascript === undefined ? {} : { browserJavascript }),
      newRequestId: () => `usage-runtime-${++ids}`,
      openConnection: () => {
        opens++;
        return connection;
      },
    });
    const base = `http://127.0.0.1:${runtime.address.port}`;
    async function read(
      path: string,
      expected: number,
      credential: string | null = token,
      method = 'GET',
    ) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: credential === null ? {} : { authorization: `Bearer ${credential}` },
      });
      const body = await response.text();
      assert.equal(response.status, expected, `${path}: ${body}`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.ok(!body.includes(token));
      assert.ok(!body.includes('private database diagnostic'));
      assert.ok(!body.includes(jwt.subject));
      return { response, body };
    }
    try {
      await db.exec(`
        INSERT INTO iam_principals VALUES ('human', 'human', true);
        INSERT INTO iam_policies VALUES ('usage-reader', 'v1',
          '[{"effect":"Allow","actions":["usage:ReadSelf"],"resources":["principal:human"]}]');
        INSERT INTO iam_principal_policies VALUES ('human', 'usage-reader');
      `);
      await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1, $2, $3)', [
        jwt.issuer,
        jwt.subject,
        'human',
      ]);
      const append = createPostgresUsageLedger(connection);
      for (const [principalId, attemptId, occurredAt] of [
        ['human', 'c', 300],
        ['human', 'b', 200],
        ['human', 'a', 100],
        ['other', 'foreign', 400],
      ] as const) {
        await append(
          buildUsageRecord({
            principalId,
            attemptId,
            occurredAt,
            credentialId: 'prior-proxy',
            policyVersions: [],
            requestId: 'inference',
            modelAlias: 'chat',
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
      const page = await read(
        '/management/v1/usage?format=json&limit=2&model=chat&from_ms=100&to_ms=301',
        200,
      );
      assert.equal(page.response.headers.get('x-content-type-options'), 'nosniff');
      const first = JSON.parse(page.body);
      assert.deepEqual(
        first.data.map((row: { attemptId: string }) => row.attemptId),
        ['c', 'b'],
      );
      assert.equal(first.has_more, true);
      assert.equal(typeof first.next_cursor, 'string');
      assert.ok(first.data.every((row: { principalId: string }) => row.principalId === 'human'));
      const next = await read(
        `/management/v1/usage?format=json&limit=2&cursor=${encodeURIComponent(first.next_cursor)}`,
        200,
      );
      const second = JSON.parse(next.body);
      assert.deepEqual(
        second.data.map((row: { attemptId: string }) => row.attemptId),
        ['a'],
      );
      assert.equal(second.has_more, false);
      assert.equal(second.next_cursor, null);
      const csv = await read('/management/v1/usage?format=csv&limit=1', 200);
      assert.match(csv.response.headers.get('content-type') ?? '', /^text\/csv/u);
      assert.ok(csv.body.includes('human'));
      assert.ok(!csv.body.includes('foreign'));
      await read('/management/v1/usage?principal_id=other', 403);
      await read('/management/v1/usage', 401, null);
      await read('/management/v1/usage', 401, await jwt.token({ exp: jwt.nowSeconds - 3600 }));
      await read('/management/v1/usage', 401, await jwt.token({ sub: 'unbound' }));
      await read('/management/v1/usage?limit=0', 400);
      await read('/management/v1/usage', 400, token, 'POST');
      for (const path of ['/management/v1/usage/', '/management/v1/usage-extra', '/v1/usage'])
        await read(path, 404);
      await read('/management/v1/models', 200);
      await read('/management/v1/proxy-tokens', 401, null, 'POST');
      await read('/management', browserJavascript === undefined ? 404 : 200, null);
      const audit = await db.query<{
        outcome: string;
        principal_id: string | null;
        policy_versions: unknown;
      }>(
        'SELECT outcome, principal_id, policy_versions FROM sso_usage_audit_events ORDER BY event_id',
      );
      assert.deepEqual(
        audit.rows.map((row) => row.outcome),
        [
          'ready',
          'ready',
          'ready',
          'forbidden',
          'unauthenticated',
          'unauthenticated',
          'unauthenticated',
          'invalid_query',
        ],
      );
      assert.equal(audit.rows[0]?.principal_id, 'human');
      assert.deepEqual(audit.rows[0]?.policy_versions, [{ id: 'usage-reader', version: 'v1' }]);
      // Production browser-compatible transports through the same real listener.
      const request: CatalogRequest = (path, init) =>
        fetch(`${base}${path}`, {
          ...init,
          headers: { authorization: `Bearer ${token}` },
        });
      const usageClient = createSsoUsageClient(request);
      const jsonResult = await usageClient.read({ limit: 1, model: 'chat' });
      assert.equal(jsonResult.state, 'ready');
      if (jsonResult.state !== 'ready') assert.fail('Expected validated JSON');
      assert.equal(jsonResult.data[0]?.attemptId, 'c');
      assert.equal(jsonResult.data[0]?.usage.status, 'missing');
      assert.equal(jsonResult.data[0]?.estimatedCost, null);
      assert.equal(jsonResult.data[0]?.upstreamBilledCost, null);
      const csvClient = createSsoUsageExportClient(request);
      const csvResult = await csvClient.read({ limit: 1 });
      assert.equal(csvResult.state, 'ready');
      if (csvResult.state !== 'ready') assert.fail('Expected validated CSV');
      assert.ok(csvResult.csv.includes('human'));
      assert.ok(!csvResult.csv.includes('foreign'));
      usageClient.invalidate();
      csvClient.invalidate();
      await db.exec(`UPDATE iam_policies SET version='v2', statements='[
        {"effect":"Allow","actions":["usage:ReadSelf"],"resources":["principal:human"]},
        {"effect":"Deny","actions":["usage:ReadSelf"],"resources":["principal:human"]}
      ]' WHERE policy_id='usage-reader'`);
      await read('/management/v1/usage', 403);
      await db.exec(
        `UPDATE iam_policies SET statements='[{"effect":"Allow","actions":["usage:ReadSelf"],"resources":["principal:human"]}]' WHERE policy_id='usage-reader'`,
      );
      failSql = true;
      assert.equal(
        JSON.parse((await read('/management/v1/usage', 503)).body).error.code,
        'usage_unavailable',
      );
      failSql = false;
      failAudit = true;
      for (const credential of [token, null]) {
        assert.equal(
          JSON.parse((await read('/management/v1/usage', 503, credential)).body).error.code,
          'audit_unavailable',
        );
      }
      failAudit = false;
      await db.exec('DELETE FROM iam_sso_identity_bindings');
      await read('/management/v1/usage', 401);
      assert.equal(opens, 1);
      assert.equal(closes, 0);
    } finally {
      const closing = runtime.close();
      assert.equal(runtime.close(), closing);
      await closing;
    }
    assert.equal(closes, 1);
    await assert.rejects(fetch(`${base}/management/v1/usage`));
  });
}
