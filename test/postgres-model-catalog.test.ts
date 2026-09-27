import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createPostgresModelCatalogReader } from '../src/gateway/postgres-model-catalog.ts';

const migration = await readFile(
  new URL('../migrations/005_model_catalog.sql', import.meta.url),
  'utf8',
);

async function fixture() {
  const db = new PGlite();
  await db.exec(migration);
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const reader = createPostgresModelCatalogReader({
    query: (sql, params) => {
      calls.push({ sql, params });
      return db.query(sql, [...params]);
    },
  });
  return { db, reader, calls };
}

test('published managed and delegated snapshots preserve ordered approved candidates', async () => {
  const { db, reader } = await fixture();
  try {
    await db.exec(`
      INSERT INTO catalog_models (alias, created_at_seconds, enabled) VALUES
        ('chat-managed', 1000, true), ('chat-router', 2000, true);
      INSERT INTO catalog_routes
        (route_id, alias, kind, version, credential_ref, jev_credential_ref,
         jev_minimum_confidence, jev_send_prompt, candidates)
      VALUES
        ('managed-v1', 'chat-managed', 'managed', 'v1', NULL, 'secret/jev', 0.7, false,
         '[{"id":"direct-openai","kind":"managed","providerId":"openai","upstreamModelId":"gpt"},{"id":"direct-anthropic","kind":"managed","providerId":"anthropic","upstreamModelId":"claude"}]'),
        ('router-v1', 'chat-router', 'delegated', 'v1', 'secret/openrouter', NULL, NULL, NULL,
         '[{"id":"router-openai","kind":"delegated","providerId":"openai","upstreamModelId":"openai/gpt"}]');
      UPDATE catalog_models SET active_route_id = 'managed-v1' WHERE alias = 'chat-managed';
      UPDATE catalog_models SET active_route_id = 'router-v1' WHERE alias = 'chat-router';
    `);
    const models = await reader.listPublishedModels();
    assert.deepEqual(
      models.map((model) => model.alias),
      ['chat-managed', 'chat-router'],
    );
    assert.deepEqual(
      models[0]?.routes[0]?.candidates.map((candidate) => candidate.id),
      ['direct-openai', 'direct-anthropic'],
    );
    assert.equal(models[1]?.routes[0]?.kind, 'delegated');
    assert.deepEqual(await reader.resolveRoute('chat-managed'), {
      kind: 'managed',
      version: 'v1',
      candidates: models[0]?.routes[0]?.candidates,
      jev: { credentialRef: 'secret/jev', minimumConfidence: 0.7, sendPrompt: false },
    });
    assert.deepEqual(await reader.resolveRoute('chat-router'), {
      kind: 'delegated',
      version: 'v1',
      credentialRef: 'secret/openrouter',
      candidates: models[1]?.routes[0]?.candidates,
    });
  } finally {
    await db.close();
  }
});

test('unknown and disabled aliases return no active route', async () => {
  const { db, reader, calls } = await fixture();
  try {
    await db.exec(`
      INSERT INTO catalog_models (alias, created_at_seconds, enabled)
      VALUES ('retired', 3000, false);
    `);
    assert.equal(await reader.resolveRoute('missing'), undefined);
    assert.equal(await reader.resolveRoute('retired'), undefined);
    assert.deepEqual(await reader.listPublishedModels(), [
      { alias: 'retired', created: 3000, enabled: false, routes: [] },
    ]);
    assert.deepEqual(
      calls.slice(0, 2).map((call) => call.params),
      [['missing'], ['retired']],
    );
    assert.equal(calls[0]?.sql.includes('m.alias = $1'), true);
  } finally {
    await db.close();
  }
});

test('a disabled alias cannot publish an active route to inference', async () => {
  const { db, reader } = await fixture();
  try {
    await db.exec(`
      INSERT INTO catalog_models VALUES ('retired', 3000, false, NULL);
      INSERT INTO catalog_routes
        (route_id, alias, kind, version, credential_ref, candidates)
      VALUES ('router-old', 'retired', 'delegated', 'v1', 'secret/openrouter',
        '[{"id":"route","kind":"delegated","providerId":"openai","upstreamModelId":"openai/gpt"}]');
      UPDATE catalog_models SET active_route_id = 'router-old' WHERE alias = 'retired';
    `);
    assert.equal(await reader.resolveRoute('retired'), undefined);
    assert.equal((await reader.listPublishedModels())[0]?.enabled, false);
  } finally {
    await db.close();
  }
});

test('schema prevents an active route from pointing to another alias', async () => {
  const { db } = await fixture();
  try {
    await db.exec(`
      INSERT INTO catalog_models VALUES ('first', 1000, true, NULL), ('second', 1000, true, NULL);
      INSERT INTO catalog_routes
        (route_id, alias, kind, version, credential_ref, candidates)
      VALUES ('router', 'first', 'delegated', 'v1', 'secret/openrouter',
        '[{"id":"route","kind":"delegated","providerId":"openai","upstreamModelId":"openai/gpt"}]');
    `);
    await assert.rejects(
      db.exec("UPDATE catalog_models SET active_route_id = 'router' WHERE alias = 'second'"),
    );
  } finally {
    await db.close();
  }
});

test('malformed, duplicate, and inconsistent rows fail closed without partial catalog', async () => {
  const base = {
    alias: 'chat',
    created_at_seconds: '1000',
    enabled: true,
    active_route_id: 'route-v1',
    route_id: 'route-v1',
    kind: 'delegated',
    version: 'v1',
    credential_ref: 'secret/openrouter',
    jev_credential_ref: null,
    jev_minimum_confidence: null,
    jev_send_prompt: null,
    candidates: [
      { id: 'one', kind: 'delegated', providerId: 'openai', upstreamModelId: 'openai/gpt' },
    ],
  };
  for (const malformed of [
    { ...base, enabled: false, active_route_id: 'other-route' },
    { ...base, credential_ref: null },
    { ...base, candidates: [] },
    { ...base, candidates: [...base.candidates, base.candidates[0]] },
    { ...base, candidates: [{ ...base.candidates[0], kind: 'managed' }] },
    {
      ...base,
      candidates: [{ ...base.candidates[0], apiKey: 'private' }],
      route_id: 'other-route',
    },
    { ...base, created_at_seconds: '9007199254740992' },
    { ...base, alias: 'bad alias' },
  ]) {
    const reader = createPostgresModelCatalogReader({
      query: async () => ({ rows: [base, malformed] }),
    });
    await assert.rejects(reader.listPublishedModels(), {
      name: 'ModelCatalogUnavailable',
      message: 'Model catalog unavailable',
    });
  }
});

test('reader strips extra stored fields and bounds list size', async () => {
  const base = {
    alias: 'chat',
    created_at_seconds: '1000',
    enabled: true,
    active_route_id: 'route-v1',
    route_id: 'route-v1',
    kind: 'delegated',
    version: 'v1',
    credential_ref: 'secret/openrouter',
    jev_credential_ref: null,
    jev_minimum_confidence: null,
    jev_send_prompt: null,
    candidates: [
      {
        id: 'one',
        kind: 'delegated',
        providerId: 'openai',
        upstreamModelId: 'openai/gpt',
        apiKey: 'private',
      },
    ],
    prompt: 'private prompt',
  };
  const reader = createPostgresModelCatalogReader({ query: async () => ({ rows: [base] }) });
  const models = await reader.listPublishedModels();
  assert.equal(JSON.stringify(models).includes('private'), false);
  assert.deepEqual(models[0]?.routes[0]?.candidates[0], {
    id: 'one',
    kind: 'delegated',
    providerId: 'openai',
    upstreamModelId: 'openai/gpt',
  });
  const oversized = createPostgresModelCatalogReader({
    query: async () => ({ rows: Array.from({ length: 1001 }, () => base) }),
  });
  await assert.rejects(oversized.listPublishedModels(), { name: 'ModelCatalogUnavailable' });
});

test('database and mismatched alias failures expose fixed safe errors', async () => {
  const failing = createPostgresModelCatalogReader({
    query: async () => {
      throw new Error('private connection detail');
    },
  });
  await assert.rejects(failing.listPublishedModels(), {
    name: 'ModelCatalogUnavailable',
    message: 'Model catalog unavailable',
  });
  await assert.rejects(failing.resolveRoute('chat'), {
    name: 'ModelCatalogUnavailable',
    message: 'Model catalog unavailable',
  });
  const mismatched = createPostgresModelCatalogReader({
    query: async () => ({
      rows: [
        {
          alias: 'other',
          created_at_seconds: '1',
          enabled: false,
          active_route_id: null,
          route_id: null,
        },
      ],
    }),
  });
  await assert.rejects(mismatched.resolveRoute('chat'), { name: 'ModelCatalogUnavailable' });
});

test('gateway model listing consumes the stored active route and applies IAM', async () => {
  const { db, reader } = await fixture();
  try {
    await db.exec(`
      INSERT INTO catalog_models VALUES ('chat', 1000, true, NULL);
      INSERT INTO catalog_routes
        (route_id, alias, kind, version, credential_ref, candidates)
      VALUES ('router', 'chat', 'delegated', 'v1', 'secret/openrouter',
        '[{"id":"openai","kind":"delegated","providerId":"openai","upstreamModelId":"openai/gpt"}]');
      UPDATE catalog_models SET active_route_id = 'router' WHERE alias = 'chat';
    `);
    const makeHandler = (allowProvider: boolean) =>
      createChatHandler({
        newRequestId: () => 'list-1',
        authenticate: async () => ({
          id: 'service-1',
          active: true,
          credentialId: 'credential-1',
          policyVersions: [],
          statements: [
            { effect: 'Allow' as const, actions: ['llm:InvokeModel'], resources: ['model:chat'] },
            ...(allowProvider
              ? [
                  {
                    effect: 'Allow' as const,
                    actions: ['llm:UseProvider'],
                    resources: ['provider:openai'],
                  },
                ]
              : []),
          ],
        }),
        resolveRoute: reader.resolveRoute,
        listPublishedModels: reader.listPublishedModels,
        checkLimit: async () => {
          throw new Error('unexpected limit');
        },
        resolveSecret: async () => {
          throw new Error('unexpected secret');
        },
        writeUsage: async () => {
          throw new Error('unexpected usage');
        },
        writeAudit: async () => {},
        invokeDirect: async () => {
          throw new Error('unexpected inference');
        },
      });
    const request = new Request('http://localhost/v1/models', {
      headers: { authorization: 'Bearer proxy-token' },
    });
    const allowed = await makeHandler(true)(request);
    assert.equal(allowed.status, 200);
    assert.deepEqual(
      ((await allowed.json()) as { data: { id: string }[] }).data.map((model) => model.id),
      ['chat'],
    );
    const denied = await makeHandler(false)(request);
    assert.equal(denied.status, 200);
    assert.deepEqual(((await denied.json()) as { data: unknown[] }).data, []);
  } finally {
    await db.close();
  }
});
