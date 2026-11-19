import { PGlite } from '@electric-sql/pglite';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import { startPostgresSsoCanonicalOperationsGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import type { CatalogRequest } from '../src/management/catalog-client.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

/** Isolated test identity only. Never an installed login or provider acceptance. */
export async function historyPageSizeRuntime() {
  const jwt = await createSsoAccessTokenFixture();
  const token = await jwt.token();
  const db = new PGlite();
  const client: PostgresConnection = {
    query: (sql, params) => db.query(sql, [...params]),
    transaction: (callback) =>
      db.transaction((tx) =>
        callback({
          exec: (sql) => tx.exec(sql),
          query: (sql, params) => tx.query(sql, [...params]),
        }),
      ),
    close: () => db.close(),
  };
  const runtime = await startPostgresSsoCanonicalOperationsGateway({
    ...jwt.config,
    host: '127.0.0.1',
    port: 0,
    newRequestId: () => 'page-size-test',
    openConnection: () => client,
  });
  try {
    await db.exec(`INSERT INTO iam_principals VALUES ('human','human',true);
      INSERT INTO iam_policies VALUES ('reader','v1','[{"effect":"Allow","actions":["usage:ReadSelf","audit:Read"],"resources":["principal:human"]}]');
      INSERT INTO iam_principal_policies VALUES ('human','reader');`);
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    const audit = createPostgresGatewayAuditStore(client, () => 100);
    const write = createPostgresUsageLedger(client);
    for (const principalId of ['human', 'other']) {
      for (let i = 1; i <= 3; i++) {
        await audit.append({
          kind: 'models-listed',
          principalId,
          requestId: `${principalId}-request-${i}`,
          credentialId: `${principalId}-credential`,
          policyVersions: [],
          count: 1,
        });
        await write(
          buildUsageRecord({
            principalId,
            credentialId: `${principalId}-credential`,
            policyVersions: [],
            requestId: `${principalId}-request-${i}`,
            attemptId: `${principalId}-attempt-${i}`,
            occurredAt: 100 + i,
            modelAlias: 'chat',
            routeKind: 'managed',
            upstreamModelId: 'up',
            selectedCandidateId: 'c',
            latencyMs: 1,
            outcome: 'succeeded',
            possiblyBilled: true,
            possibleDuplicate: false,
          }),
        );
      }
    }
  } catch (error) {
    await runtime.close();
    throw error;
  }
  const statuses: { path: string; status: number }[] = [];
  const request: CatalogRequest = async (path, init) => {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    const response = await fetch(`http://127.0.0.1:${runtime.address.port}${path}`, {
      ...init,
      headers,
    });
    statuses.push({ path, status: response.status });
    return response;
  };
  return {
    request,
    statuses,
    close: () => runtime.close(),
    deny: () =>
      db.exec(
        `UPDATE iam_policies SET version='v2', statements='[{"effect":"Deny","actions":["usage:ReadSelf","audit:Read"],"resources":["principal:human"]}]'`,
      ),
    auditCount: async (kind: 'usage' | 'audit') => {
      const table = kind === 'usage' ? 'sso_usage_audit_events' : 'sso_audit_history_access_events';
      return (await db.query(`SELECT * FROM ${table}`)).rows.length;
    },
  };
}
