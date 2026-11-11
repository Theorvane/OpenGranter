import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import { createPostgresSsoAuditHistoryServer } from '../src/gateway/postgres-sso-audit-history-http.ts';
import { exportFilteredAuditCsv } from '../src/management/audit-export.ts';
import type { CatalogRequest } from '../src/management/catalog-client.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

async function setup() {
  const db = new PGlite();
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
  await db.exec(
    await readFile(
      new URL('../contracts/sso-audit-history-access-schema.sql', import.meta.url),
      'utf8',
    ),
  );
  const jwt = await createSsoAccessTokenFixture();
  await db.exec(`
    INSERT INTO iam_principals VALUES ('human','human',true),('other','human',true);
    INSERT INTO iam_policies VALUES ('audit','v1','[{"effect":"Allow","actions":["audit:Read"],"resources":["principal:human"]}]');
    INSERT INTO iam_principal_policies VALUES ('human','audit');
  `);
  await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
    jwt.issuer,
    jwt.subject,
    'human',
  ]);
  const client = { query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]) };
  for (const principalId of ['human', 'human', 'other']) {
    await createPostgresGatewayAuditStore(client, () => 100).append({
      kind: 'request-denied',
      reason: 'invalid-request',
      requestId: `event-${principalId}`,
      principalId,
      credentialId: 'proxy-reference',
      policyVersions: [],
      modelAlias: 'chat',
    });
  }
  let count = 0;
  const server = createPostgresSsoAuditHistoryServer({
    ...jwt.config,
    client,
    auditClient: client,
    newRequestId: () => `export-${++count}`,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const token = await jwt.token();
  return {
    db,
    request: ((path, init) =>
      fetch(`http://127.0.0.1:${address.port}${path}`, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${token}` },
      })) as CatalogRequest,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await db.close();
    },
  };
}

test('actual SQL/JWT/HTTP filtered audit export is isolated and each page has durable reader audit', async () => {
  const app = await setup();
  try {
    const result = await exportFilteredAuditCsv(
      app.request,
      'human',
      { limit: 1, model: 'chat' },
      { signal: new AbortController().signal },
    );
    assert.equal(result.state, 'ready');
    if (result.state === 'ready') {
      assert.equal(result.data.pages, 2);
      assert.equal(result.data.csv.match(/event-human/gu)?.length, 2);
      assert.doesNotMatch(result.data.csv, /event-other/u);
      assert.equal(result.data.csv.match(/event_id/gu)?.length, 1);
    }
    assert.deepEqual(
      (
        await app.db.query(
          'SELECT principal_id,target_principal_id,outcome,record_count FROM sso_audit_history_access_events ORDER BY event_id',
        )
      ).rows,
      [1, 1].map((record_count) => ({
        principal_id: 'human',
        target_principal_id: 'human',
        outcome: 'ready',
        record_count,
      })),
    );
    let pages = 0;
    const request: CatalogRequest = async (path, init) => {
      if (++pages === 2) await app.db.exec('DELETE FROM iam_principal_policies');
      return app.request(path, init);
    };
    assert.deepEqual(
      await exportFilteredAuditCsv(
        request,
        'human',
        { limit: 1 },
        { signal: new AbortController().signal },
      ),
      { state: 'denied' },
    );
    assert.deepEqual(
      (
        await app.db.query(
          'SELECT outcome,record_count FROM sso_audit_history_access_events ORDER BY event_id DESC LIMIT 1',
        )
      ).rows,
      [{ outcome: 'forbidden', record_count: 0 }],
    );
  } finally {
    await app.close();
  }
});

test('durable access-audit failure on second page never releases partial export', async () => {
  const app = await setup();
  try {
    let pages = 0;
    const request: CatalogRequest = async (path, init) => {
      if (++pages === 2) await app.db.exec('DROP TABLE sso_audit_history_access_events');
      return app.request(path, init);
    };
    assert.deepEqual(
      await exportFilteredAuditCsv(
        request,
        'human',
        { limit: 1 },
        { signal: new AbortController().signal },
      ),
      { state: 'unavailable' },
    );
    assert.equal(pages, 2);
  } finally {
    await app.close();
  }
});
