import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { createPostgresSsoAuditHistoryHandler } from '../src/gateway/postgres-sso-audit-history-http.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

test('canonical audit artifact reads signed SSO JSON/CSV over actual loopback HTTP and migrated storage with fresh Deny', async () => {
  const jwt = await createSsoAccessTokenFixture();
  const token = await jwt.token();
  const db = new PGlite();
  let server: ReturnType<typeof createNodeRequestServer> | undefined;
  try {
    const javascript = await buildManagementBrowser({
      root: process.cwd(),
      entry: 'src/management/audit-review.ts',
    });
    const { createAuditReview } = (await import(
      `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
    )) as typeof import('../src/management/audit-review.ts');
    for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
    await db.exec(`INSERT INTO iam_principals VALUES ('human', 'human', true);
      INSERT INTO iam_policies VALUES ('reader', 'v1', '[{"effect":"Allow","actions":["audit:Read"],"resources":["principal:human"]}]');
      INSERT INTO iam_principal_policies VALUES ('human', 'reader');`);
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1, $2, $3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    const client = {
      query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]),
    };
    const writer = createPostgresGatewayAuditStore(client, () => 100);
    for (const requestId of ['first', 'second']) {
      await writer.append({
        kind: 'models-listed',
        principalId: 'human',
        requestId,
        credentialId: 'historical',
        policyVersions: [],
        count: 1,
      });
    }
    await db.exec(
      `UPDATE gateway_audit_events SET details = details || '{"prompt":"PRIVATE","upstreamKey":"PRIVATE"}'::jsonb`,
    );
    const handler = createPostgresSsoAuditHistoryHandler({
      ...jwt.config,
      client,
      newRequestId: () => 'review',
    });
    server = createNodeRequestServer(handler);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const review = createAuditReview(async (path, init) =>
      fetch(base + path, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${token}` },
      }),
    );
    await review.load({ principalId: 'human', fromMs: 0, toMs: 101, limit: 1 });
    assert.equal(review.snapshot().state, 'ready');
    assert.equal(review.snapshot().data[0]?.requestId, 'second');
    assert.equal(review.snapshot().canNext, true);
    await review.next();
    assert.equal(review.snapshot().data[0]?.requestId, 'first');
    const csv = await review.exportCsv();
    assert.equal(csv.state, 'ready');
    if (csv.state === 'ready') {
      assert.match(csv.csv, /first/u);
      assert.doesNotMatch(csv.csv, /second|PRIVATE|upstreamKey/u);
    }
    await review.previous();
    assert.equal(review.snapshot().data[0]?.requestId, 'second');
    await review.load({ requestId: 'absent' });
    assert.equal(review.snapshot().state, 'empty');
    await db.query('UPDATE iam_policies SET version = $1, statements = $2::jsonb', [
      'v2',
      JSON.stringify([{ effect: 'Deny', actions: ['audit:*'], resources: ['principal:*'] }]),
    ]);
    assert.equal((await review.exportCsv()).state, 'denied');
    assert.equal(review.snapshot().state, 'denied');
    assert.deepEqual(review.snapshot().data, []);
    const accesses = (
      await db.query<{ outcome: string }>(
        'SELECT outcome FROM sso_audit_history_access_events ORDER BY event_id',
      )
    ).rows;
    assert.deepEqual(
      accesses.map((entry) => entry.outcome),
      ['ready', 'ready', 'ready', 'ready', 'ready', 'forbidden'],
    );
    assert.doesNotMatch(JSON.stringify(review.snapshot()), /PRIVATE|Bearer/u);
    review.dispose();
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server?.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await db.close();
  }
});
