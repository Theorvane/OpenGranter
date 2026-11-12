import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import { startPostgresSsoManagementGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

for (const source of ['usage', 'audit'] as const) {
  test(`canonical workspace ${source} CSV fresh Deny clears both histories over owned HTTP and migrated SQL`, async () => {
    const javascript = await buildManagementBrowser({
      root: process.cwd(),
      entry: 'src/management/history-workspace.ts',
    });
    assert.doesNotMatch(javascript, /node:|process\.env|INSERT INTO|sourceMappingURL/u);
    const { createHistoryWorkspace } = (await import(
      `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
    )) as typeof import('../src/management/history-workspace.ts');
    const jwt = await createSsoAccessTokenFixture();
    const token = await jwt.token();
    const db = new PGlite();
    let closes = 0;
    const client: PostgresConnection = {
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
      newRequestId: () => 'workspace-read',
      openConnection: () => client,
      browserJavascript: javascript,
    });
    try {
      const base = `http://127.0.0.1:${runtime.address.port}`;
      const shell = await fetch(`${base}/management`);
      assert.equal(shell.status, 200);
      const artifact = await fetch(`${base}/management/app.js`);
      assert.equal(await artifact.text(), javascript);
      await db.exec(`INSERT INTO iam_principals VALUES ('human','human',true);
        INSERT INTO iam_policies VALUES ('reader','v1','[{"effect":"Allow","actions":["usage:ReadSelf","audit:Read"],"resources":["principal:human"]}]');
        INSERT INTO iam_principal_policies VALUES ('human','reader');`);
      await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
        jwt.issuer,
        jwt.subject,
        'human',
      ]);
      await createPostgresGatewayAuditStore(client, () => 100).append({
        kind: 'models-listed',
        principalId: 'human',
        requestId: 'historical',
        credentialId: 'old',
        policyVersions: [],
        count: 1,
      });
      await createPostgresUsageLedger(client)(
        buildUsageRecord({
          principalId: 'human',
          credentialId: 'old',
          policyVersions: [],
          requestId: 'historical',
          attemptId: 'z',
          occurredAt: 100,
          modelAlias: 'chat',
          routeKind: 'managed',
          upstreamModelId: 'upstream',
          selectedCandidateId: 'candidate',
          latencyMs: 2,
          outcome: 'succeeded',
          possiblyBilled: true,
          possibleDuplicate: true,
          estimatedCost: {
            amountDecimal: '9007199254740993.0000000001',
            currency: 'USD',
            priceVersion: 'v1',
          },
        }),
      );
      const states: string[] = [];
      let calls = 0;
      const workspace = createHistoryWorkspace(
        async (path, init) => {
          calls++;
          return fetch(base + path, {
            ...init,
            headers: { ...init.headers, authorization: `Bearer ${token}` },
          });
        },
        (snapshot) => states.push(snapshot.state),
      );
      await workspace.usage.load();
      await workspace.audit.load();
      assert.equal(workspace.snapshot().usage.state, 'ready');
      assert.equal(workspace.snapshot().audit.state, 'ready');
      assert.equal(
        workspace.snapshot().usage.data[0]?.estimatedCost?.amountDecimal,
        '9007199254740993.0000000001',
      );
      const exported = await workspace[source].exportCsv();
      assert.equal(exported.state, 'ready');
      const action = source === 'usage' ? 'usage:ReadSelf' : 'audit:Read';
      await db.query('UPDATE iam_policies SET version=$1, statements=$2::jsonb', [
        'v2',
        JSON.stringify([
          {
            effect: 'Allow',
            actions: ['usage:ReadSelf', 'audit:Read'],
            resources: ['principal:human'],
          },
          { effect: 'Deny', actions: [action], resources: ['principal:human'] },
        ]),
      ]);
      await workspace[source].exportCsv();
      assert.equal(workspace.snapshot().state, 'denied');
      assert.deepEqual(workspace.snapshot().usage.data, []);
      assert.deepEqual(workspace.snapshot().audit.data, []);
      assert.equal(states.filter((state) => state === 'denied').length, 1);
      const before = calls;
      await workspace.usage.load();
      await workspace.audit.load();
      assert.equal(calls, before);
      const table =
        source === 'usage' ? 'sso_usage_audit_events' : 'sso_audit_history_access_events';
      const audit = await db.query<{ outcome: string }>(
        `SELECT outcome FROM ${table} ORDER BY event_id`,
      );
      assert.deepEqual(
        audit.rows.map((row) => row.outcome),
        ['ready', 'ready', 'forbidden'],
      );
      assert.doesNotMatch(JSON.stringify(workspace.snapshot()), /Bearer|historical|upstream/u);
      workspace.dispose();
    } finally {
      await runtime.close();
    }
    assert.equal(closes, 1);
  });
}
