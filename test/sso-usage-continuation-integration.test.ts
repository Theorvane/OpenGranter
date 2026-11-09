import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresSsoUsageHistoryServer } from '../src/gateway/postgres-sso-usage-history-http.ts';
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
    get: (query: string) =>
      fetch(`http://127.0.0.1:${address.port}/management/v1/usage?${query}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await db.close();
    },
  };
}

for (const format of ['json', 'csv']) {
  test(`SQL/HTTP ${format} rejects an unconsumable continuation before success audit`, async () => {
    const app = await setup('界'.repeat(512));
    try {
      const response = await app.get(`limit=1&format=${format}`);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-usage-next-cursor'), null);
      const body = await response.text();
      assert.match(body, /usage_unavailable/u);
      assert.ok(!body.includes('original-chat'));
      const audit = (
        await app.db.query(
          'SELECT outcome,record_count,principal_id,policy_versions FROM sso_usage_audit_events',
        )
      ).rows;
      assert.deepEqual(audit, [
        {
          outcome: 'unavailable',
          record_count: 0,
          principal_id: 'human',
          policy_versions: [{ id: 'p', version: 'v1' }],
        },
      ]);
    } finally {
      await app.close();
    }
  });
  test(`SQL/HTTP ${format} navigates an accepted multibyte continuation and final page`, async () => {
    const app = await setup('界'.repeat(500));
    try {
      const first = await app.get(`limit=1&format=${format}`);
      assert.equal(first.status, 200);
      assert.equal(first.headers.get('x-usage-has-more'), 'true');
      const cursor = first.headers.get('x-usage-next-cursor');
      assert.ok(cursor);
      await first.text();
      const second = await app.get(`limit=1&format=${format}&cursor=${encodeURIComponent(cursor)}`);
      assert.equal(second.status, 200);
      assert.equal(second.headers.get('x-usage-has-more'), 'false');
      assert.equal(second.headers.get('x-usage-next-cursor'), null);
      assert.match(await second.text(), /older-attempt/u);
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
      await app.db.exec('DROP TABLE sso_usage_audit_events');
      const blocked = await app.get(`limit=1&format=${format}`);
      assert.equal(blocked.status, 503);
      assert.match(await blocked.text(), /audit_unavailable/u);
    } finally {
      await app.close();
    }
  });
}
