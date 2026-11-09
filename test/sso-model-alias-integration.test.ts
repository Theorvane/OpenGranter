import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresSsoModelCatalogServer } from '../src/gateway/postgres-sso-model-catalog-http.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

async function fixture() {
  const jwt = await createSsoAccessTokenFixture();
  const db = new PGlite();
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
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
  let sequence = 0;
  return {
    db,
    token: await jwt.token(),
    ports: {
      ...jwt.config,
      client: { query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]) },
      newRequestId: () => `alias-${++sequence}`,
    },
  };
}
async function safe(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const text = await response.text();
  assert.doesNotMatch(text, /private-secret|client-forged|Bearer|SELECT|INSERT/u);
  return JSON.parse(text);
}

test('visible unaddressable SQL aliases fail before durable Models success audit', async () => {
  const f = await fixture();
  const server = createPostgresSsoModelCatalogServer(f.ports);
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const get = (suffix = '') =>
      fetch(`http://127.0.0.1:${address.port}/management/v1/models${suffix}`, {
        headers: { authorization: `Bearer ${f.token}`, 'x-request-id': 'client-forged' },
        redirect: 'error',
      });
    const audits = async () =>
      (
        await f.db.query<{
          outcome: string;
          model_count: number;
          principal_id: string;
          policy_versions: unknown;
          request_id: string;
        }>(
          'SELECT outcome, model_count, principal_id, policy_versions, request_id FROM sso_catalog_audit_events ORDER BY event_id',
        )
      ).rows;
    for (const alias of ['team//chat', 'team/./chat', 'team/../chat', 'team/chat/']) {
      await f.db.query(
        'INSERT INTO catalog_models (alias, created_at_seconds, enabled) VALUES ($1, 43, true)',
        [alias],
      );
      await f.db.query(
        `INSERT INTO catalog_routes (route_id, alias, kind, version, credential_ref, candidates) VALUES ('invalid-route', $1, 'managed', 'v1', NULL, '[{"id":"one","kind":"managed","providerId":"openai","upstreamModelId":"private-secret"}]')`,
        [alias],
      );
      await f.db.query('UPDATE catalog_models SET active_route_id = $1 WHERE alias = $2', [
        'invalid-route',
        alias,
      ]);
      const before = (await audits()).length;
      const body = await safe(await get(), 503);
      assert.equal(body.error.code, 'catalog_unavailable', alias);
      assert.doesNotMatch(JSON.stringify(body), /team|private-secret|invalid-route/u);
      const rows = await audits();
      assert.equal(rows.length, before + 1);
      assert.deepEqual(rows.at(-1), {
        outcome: 'unavailable',
        model_count: 0,
        principal_id: 'human',
        policy_versions: [{ id: 'allow', version: 'v1' }],
        request_id: body.request_id,
      });
      // Only visible aliases are checked; a denied publication must not poison the list.
      await f.db.query(
        "UPDATE iam_policies SET version = 'v2', statements = $1::jsonb WHERE policy_id = 'allow'",
        [
          JSON.stringify([
            {
              effect: 'Allow',
              actions: ['llm:InvokeModel', 'llm:UseProvider'],
              resources: ['model:*', 'provider:openai'],
            },
            { effect: 'Deny', actions: ['llm:InvokeModel'], resources: [`model:${alias}`] },
          ]),
        ],
      );
      assert.deepEqual(
        (await safe(await get(), 200)).data.map((row: { id: string }) => row.id),
        ['team/chat'],
      );
      assert.deepEqual((await audits()).at(-1)?.policy_versions, [{ id: 'allow', version: 'v2' }]);
      await f.db.query(
        'UPDATE catalog_models SET active_route_id = NULL, enabled = false WHERE alias = $1',
        [alias],
      );
      await f.db.exec("DELETE FROM catalog_routes WHERE route_id = 'invalid-route'");
      await f.db.query('DELETE FROM catalog_models WHERE alias = $1', [alias]);
      await f.db.exec("UPDATE iam_policies SET version = 'v1' WHERE policy_id = 'allow'");
    }
    assert.equal((await safe(await get('/team%2Fchat'), 200)).id, 'team/chat');
    await f.db.exec('DROP TABLE sso_catalog_audit_events');
    assert.equal((await safe(await get(), 503)).error.code, 'audit_unavailable');
  } finally {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await f.db.close();
  }
});
