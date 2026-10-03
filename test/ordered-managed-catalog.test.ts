import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createPostgresModelCatalogReader } from '../src/gateway/postgres-model-catalog.ts';

const catalogMigration =
  (await readFile(new URL('../migrations/005_model_catalog.sql', import.meta.url), 'utf8')) +
  '\n' +
  (await readFile(
    new URL('../migrations/010_model_discovery_metadata.sql', import.meta.url),
    'utf8',
  ));
const optionalJevMigration = await readFile(
  new URL('../migrations/006_optional_managed_jev.sql', import.meta.url),
  'utf8',
);

test('persisted managed route without Jev invokes an authorized direct provider', async () => {
  const db = new PGlite();
  try {
    await db.exec(catalogMigration);
    await db.exec(optionalJevMigration);
    await db.exec(`
      INSERT INTO catalog_models VALUES ('chat', 1000, true, NULL);
      INSERT INTO catalog_routes
        (route_id, alias, kind, version, candidates)
      VALUES ('ordered-v1', 'chat', 'managed', 'v1',
        '[{"id":"openai","kind":"managed","providerId":"openai","upstreamModelId":"gpt"}]');
      UPDATE catalog_models SET active_route_id = 'ordered-v1' WHERE alias = 'chat';
    `);
    const reader = createPostgresModelCatalogReader({
      query: (sql, params) => db.query(sql, [...params]),
    });
    assert.deepEqual(await reader.resolveRoute('chat'), {
      kind: 'managed',
      version: 'v1',
      candidates: [{ id: 'openai', kind: 'managed', providerId: 'openai', upstreamModelId: 'gpt' }],
    });
    const calls: string[] = [];
    const handler = createChatHandler({
      newRequestId: () => 'persisted-1',
      authenticate: async () => ({
        id: 'service-1',
        active: true,
        credentialId: 'credential-1',
        policyVersions: [],
        statements: [
          { effect: 'Allow', actions: ['llm:InvokeModel'], resources: ['model:chat'] },
          { effect: 'Allow', actions: ['llm:UseProvider'], resources: ['provider:openai'] },
        ],
      }),
      resolveRoute: reader.resolveRoute,
      checkLimit: async () => true,
      resolveSecret: async () => {
        calls.push('secret');
        throw new Error('unexpected Jev secret');
      },
      writeAudit: async () => {},
      writeUsage: async () => {},
      invokeDirect: async () => {
        calls.push('direct');
        return { id: 'completion' };
      },
      fetchJev: async () => {
        calls.push('jev');
        throw new Error('unexpected Jev');
      },
    });
    const response = await handler(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: 'Bearer proxy-token', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'chat', messages: [{ role: 'user', content: 'hello' }] }),
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ['direct']);
  } finally {
    await db.close();
  }
});

test('upgraded schema rejects partial Jev settings and keeps Jev routes valid', async () => {
  const db = new PGlite();
  try {
    await db.exec(catalogMigration);
    await db.exec(`
      INSERT INTO catalog_models VALUES ('previous', 1000, true, NULL);
      INSERT INTO catalog_routes
        (route_id, alias, kind, version, jev_credential_ref,
         jev_minimum_confidence, jev_send_prompt, candidates)
      VALUES ('jev-v1', 'previous', 'managed', 'v1', 'secret/jev', 0.7, false,
        '[{"id":"openai","kind":"managed","providerId":"openai","upstreamModelId":"gpt"}]');
      UPDATE catalog_models SET active_route_id = 'jev-v1' WHERE alias = 'previous';
    `);
    await db.exec(optionalJevMigration);
    const reader = createPostgresModelCatalogReader({
      query: (sql, params) => db.query(sql, [...params]),
    });
    assert.equal((await reader.resolveRoute('previous'))?.kind, 'managed');
    await db.exec("INSERT INTO catalog_models VALUES ('partial', 1000, true, NULL)");
    await assert.rejects(
      db.exec(`
      INSERT INTO catalog_routes
        (route_id, alias, kind, version, jev_credential_ref, jev_send_prompt, candidates)
      VALUES ('bad-v1', 'partial', 'managed', 'v1', 'secret/jev', false,
        '[{"id":"openai","kind":"managed","providerId":"openai","upstreamModelId":"gpt"}]');
    `),
    );
  } finally {
    await db.close();
  }
});
