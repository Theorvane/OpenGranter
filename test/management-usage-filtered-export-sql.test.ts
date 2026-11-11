import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresSsoUsageHistoryServer } from '../src/gateway/postgres-sso-usage-history-http.ts';
import type { CatalogRequest } from '../src/management/catalog-client.ts';
import { exportFilteredUsageCsv } from '../src/management/usage-export.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

async function setup(attemptId: string) {
  const db = new PGlite();
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
  await db.exec(
    await readFile(new URL('../contracts/sso-usage-audit-schema.sql', import.meta.url), 'utf8'),
  );
  const jwt = await createSsoAccessTokenFixture();
  await db.query('INSERT INTO iam_principals VALUES ($1,$2,$3)', ['human', 'human', true]);
  await db.query('INSERT INTO iam_policies VALUES ($1,$2,$3::jsonb)', [
    'p',
    'v1',
    JSON.stringify([
      { effect: 'Allow', actions: ['usage:ReadSelf'], resources: ['principal:human'] },
    ]),
  ]);
  await db.exec(
    "INSERT INTO iam_roles VALUES ('reader'); INSERT INTO iam_principal_roles VALUES ('human','reader'); INSERT INTO iam_role_policies VALUES ('reader','p');",
  );
  await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
    jwt.issuer,
    jwt.subject,
    'human',
  ]);
  const client = { query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]) };
  for (const [id, time] of [
    [attemptId, 200],
    ['older-attempt', 100],
  ] as const) {
    await createPostgresUsageLedger(client)(
      buildUsageRecord({
        principalId: 'human',
        credentialId: 'original-credential',
        policyVersions: [],
        requestId: 'original-chat',
        attemptId: id,
        modelAlias: 'chat',
        routeKind: 'managed',
        upstreamModelId: 'model',
        selectedCandidateId: 'candidate',
        occurredAt: time,
        latencyMs: 1,
        outcome: 'succeeded',
        possiblyBilled: true,
        possibleDuplicate: false,
      }),
    );
  }
  let request = 0;
  const server = createPostgresSsoUsageHistoryServer({
    ...jwt.config,
    client,
    newRequestId: () => `read-${++request}`,
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
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await db.close();
    },
  };
}

test('actual SQL + signed JWT + loopback exports both pages and audits each; later policy denial discards partial CSV', async () => {
  const app = await setup('newer-attempt');
  try {
    const result = await exportFilteredUsageCsv(
      app.request,
      { model: 'chat', limit: 1 },
      { signal: new AbortController().signal },
    );
    assert.equal(result.state, 'ready');
    if (result.state === 'ready') {
      assert.equal(result.data.pages, 2);
      assert.match(result.data.csv, /newer-attempt/u);
      assert.match(result.data.csv, /older-attempt/u);
      assert.equal(result.data.csv.match(/request_id/gu)?.length, 1);
    }
    assert.deepEqual(
      (
        await app.db.query(
          'SELECT outcome,record_count FROM sso_usage_audit_events ORDER BY event_id',
        )
      ).rows,
      [
        { outcome: 'ready', record_count: 1 },
        { outcome: 'ready', record_count: 1 },
      ],
    );
    let pages = 0;
    const request: CatalogRequest = async (path, init) => {
      if (++pages === 2) await app.db.exec('DELETE FROM iam_role_policies');
      return app.request(path, init);
    };
    assert.deepEqual(
      await exportFilteredUsageCsv(request, { limit: 1 }, { signal: new AbortController().signal }),
      { state: 'denied' },
    );
    assert.deepEqual(
      (
        await app.db.query(
          'SELECT outcome,record_count FROM sso_usage_audit_events ORDER BY event_id DESC LIMIT 1',
        )
      ).rows,
      [{ outcome: 'forbidden', record_count: 0 }],
    );
  } finally {
    await app.close();
  }
});
