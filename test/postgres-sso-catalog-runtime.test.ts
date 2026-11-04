import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoManagementGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

for (const browserJavascript of [undefined, 'export {};']) {
  test(`owned management listener serves durable SSO catalog; browser=${browserJavascript !== undefined}`, async () => {
    const jwt = await createSsoAccessTokenFixture();
    const db = new PGlite();
    let opens = 0;
    let closes = 0;
    let ids = 0;
    const connection: PostgresConnection = {
      query: (sql, params) => db.query(sql, [...params]),
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
      newRequestId: () => `runtime-${++ids}`,
      openConnection: () => {
        opens++;
        return connection;
      },
    });
    const base = `http://127.0.0.1:${runtime.address.port}`;
    const token = await jwt.token();
    const headers = { authorization: `Bearer ${token}` };
    async function status(path: string, expected: number, authenticated = true) {
      const response = await fetch(`${base}${path}`, { headers: authenticated ? headers : {} });
      assert.equal(response.status, expected);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.text();
      assert.ok(!body.includes(token));
      assert.ok(!body.includes('private-secret'));
      return body;
    }
    try {
      await db.exec(`
        INSERT INTO iam_principals VALUES ('human', 'human', true);
        INSERT INTO iam_policies VALUES ('allow', 'v1',
          '[{"effect":"Allow","actions":["llm:InvokeModel","llm:UseProvider"],"resources":["model:*","provider:openai"]}]');
        INSERT INTO iam_roles VALUES ('reader');
        INSERT INTO iam_principal_roles VALUES ('human', 'reader');
        INSERT INTO iam_role_policies VALUES ('reader', 'allow');
        INSERT INTO catalog_models (alias, created_at_seconds, enabled) VALUES ('team/chat', 42, true);
        INSERT INTO catalog_routes (route_id, alias, kind, version, credential_ref, candidates) VALUES
          ('direct', 'team/chat', 'managed', 'v1', NULL,
           '[{"id":"one","kind":"managed","providerId":"openai","upstreamModelId":"private-secret"}]');
        UPDATE catalog_models SET active_route_id = 'direct' WHERE alias = 'team/chat';
      `);
      await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1, $2, $3)', [
        jwt.issuer,
        jwt.subject,
        'human',
      ]);
      const list = JSON.parse(await status('/management/v1/models', 200));
      assert.equal(list.data[0].id, 'team/chat');
      const detail = JSON.parse(await status('/management/v1/models/team%2Fchat', 200));
      assert.equal(detail.id, 'team/chat');
      await status('/management/v1/models', 401, false);
      const audit = await db.query<{
        operation: string;
        outcome: string;
        principal_id: string | null;
        policy_versions: unknown;
      }>(
        'SELECT operation, outcome, principal_id, policy_versions FROM sso_catalog_audit_events ORDER BY event_id',
      );
      assert.equal(audit.rows.length, 3);
      assert.deepEqual(
        audit.rows.map((row) => ({
          operation: row.operation,
          outcome: row.outcome,
          principalId: row.principal_id,
          policies: row.policy_versions,
        })),
        [
          {
            operation: 'list',
            outcome: 'ready',
            principalId: 'human',
            policies: [{ id: 'allow', version: 'v1' }],
          },
          {
            operation: 'detail',
            outcome: 'ready',
            principalId: 'human',
            policies: [{ id: 'allow', version: 'v1' }],
          },
          { operation: 'list', outcome: 'unauthenticated', principalId: null, policies: null },
        ],
      );
      const wrongMethod = await fetch(`${base}/management/v1/models`, { method: 'POST', headers });
      assert.equal(wrongMethod.status, 404);
      assert.equal(wrongMethod.headers.get('cache-control'), 'no-store');
      await wrongMethod.text();
      await db.exec(
        `UPDATE iam_policies SET version='v2', statements='[{"effect":"Deny","actions":["llm:InvokeModel"],"resources":["model:*"]}]' WHERE policy_id='allow'`,
      );
      const denied = JSON.parse(await status('/management/v1/models', 200));
      assert.deepEqual(denied.data, []);
      await status('/management/v1/models/team%2Fchat', 404);
      await db.exec('DELETE FROM iam_sso_identity_bindings');
      await status('/management/v1/models', 401);
      await status('/api/v1/models', 404);
      await status('/management/v1/models-extra', 404);
      await status('/management', browserJavascript === undefined ? 404 : 200, false);
      const issuance = await fetch(`${base}/management/v1/proxy-tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(issuance.status, 401);
      await issuance.text();
      await db.exec('DROP TABLE sso_catalog_audit_events');
      await status('/management/v1/models', 503, false);
      assert.equal(opens, 1);
      assert.equal(closes, 0);
    } finally {
      const closing = runtime.close();
      assert.equal(runtime.close(), closing);
      await closing;
    }
    assert.equal(closes, 1);
    await assert.rejects(fetch(`${base}/management/v1/models`));
  });
}
