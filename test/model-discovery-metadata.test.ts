import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { OpenRouter } from '@openrouter/sdk';
import { createChatHandler, type PublishedModel } from '../src/gateway/chat-handler.ts';
import type { OpenRouterModelMetadata } from '../src/gateway/model-discovery-metadata.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { createPostgresModelCatalogReader } from '../src/gateway/postgres-model-catalog.ts';
import type { Statement } from '../src/policy/evaluate.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';

function metadata() {
  return {
    canonical_slug: 'published/canonical',
    name: 'Published model',
    context_length: 8192,
    architecture: {
      modality: 'text->text',
      input_modalities: ['text'],
      output_modalities: ['text'],
    },
    pricing: { prompt: '0.000001', completion: '0.000002' },
    top_provider: { is_moderated: true, context_length: 8192, max_completion_tokens: 1024 },
    supported_parameters: ['temperature', 'max_tokens'],
    supported_voices: null,
    default_parameters: { temperature: 0.5 },
    per_request_limits: null,
    links: { details: 'https://catalog.example/model' },
  };
}
function model(extra: unknown = metadata(), alias = 'chat'): PublishedModel {
  return {
    alias,
    created: 42,
    enabled: true,
    routes: [
      {
        kind: 'managed',
        candidates: [
          { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'upstream' },
        ],
      },
    ],
    ...{ openRouterMetadata: extra },
  } as unknown as PublishedModel;
}
function fixture(
  catalog: readonly PublishedModel[] = [model()],
  options: {
    deny?: boolean;
    statements?: readonly Statement[];
    audit?: (event: unknown) => void;
  } = {},
) {
  const events: unknown[] = [];
  const handler = createChatHandler({
    newRequestId: () => 'request',
    authenticate: async () => ({
      id: 'user',
      active: true,
      credentialId: 'credential',
      policyVersions: [],
      statements:
        options.statements ??
        (options.deny ? [] : [{ effect: 'Allow', actions: ['*'], resources: ['*'] }]),
    }),
    listPublishedModels: async () => catalog,
    resolveRoute: async () => assert.fail('listing routed'),
    resolveSecret: async () => assert.fail('listing read secrets'),
    checkLimit: async () => assert.fail('listing checked limits'),
    invokeDirect: async () => assert.fail('listing invoked inference'),
    invokeOpenRouter: async () => assert.fail('listing invoked inference'),
    writeUsage: async () => assert.fail('listing wrote usage'),
    writeAudit: async (event) => {
      options.audit?.(event);
      events.push(event);
    },
  });
  const request = (base = '/api/v1') =>
    new Request(`http://localhost${base}/models`, { headers: { authorization: 'Bearer fixture' } });
  return { handler, request, events };
}
test('official SDK deserializes trusted rich discovery and empty IAM-filtered list', async () => {
  for (const deny of [false, true]) {
    const f = fixture([model()], { deny });
    const server = createNodeRequestServer(f.handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const sdk = new OpenRouter({
        apiKey: 'fixture',
        serverURL: `http://127.0.0.1:${address.port}/api/v1`,
        retryConfig: { strategy: 'none' },
      });
      const page = await sdk.models.list();
      const result = page.result;
      assert.equal(result.totalCount, deny ? 0 : 1);
      assert.equal(result.links.next, null);
      assert.equal(result.data.length, deny ? 0 : 1);
      if (!deny) {
        assert.equal(result.data[0]?.id, 'chat');
        assert.equal(result.data[0]?.contextLength, 8192);
        assert.equal(result.data[0]?.pricing.prompt, '0.000001');
        assert.equal(result.data[0]?.topProvider.isModerated, true);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
});
test('rich discovery preserves legacy/basic catalogs and captured metadata during required audit', async () => {
  const source = metadata();
  const f = fixture([model(source)], {
    audit: () => {
      source.pricing.prompt = '999';
      source.architecture.input_modalities.push('image');
      source.supported_parameters.push('private');
    },
  });
  const response = await f.handler(f.request());
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: Array<Record<string, unknown>> };
  assert.deepEqual(body.data[0]?.pricing, { prompt: '0.000001', completion: '0.000002' });
  assert.deepEqual(body.data[0]?.supported_parameters, ['temperature', 'max_tokens']);
  assert.doesNotMatch(JSON.stringify(f.events), /0\.000001|published\/canonical|catalog\.example/);
  const legacy = fixture([model()]);
  const old = await legacy.handler(legacy.request('/v1'));
  assert.deepEqual(await old.json(), {
    object: 'list',
    data: [{ id: 'chat', object: 'model', created: 42, owned_by: 'opengranter' }],
  });
  // Explicitly remove configuration; the optional snapshot has no invented defaults.
  const noMetadata = { ...model() } as PublishedModel & { openRouterMetadata?: unknown };
  delete noMetadata.openRouterMetadata;
  const absent = fixture([noMetadata]);
  const absentBody = (await (await absent.handler(absent.request())).json()) as {
    data: Array<Record<string, unknown>>;
  };
  assert.equal(Object.hasOwn(absentBody.data[0] ?? {}, 'pricing'), false);
});

test('migrated PostgreSQL catalog stores exact discovery snapshots with no required backfill', async () => {
  const db = new PGlite();
  try {
    for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
    await db.exec(
      "INSERT INTO catalog_models (alias,created_at_seconds,enabled) VALUES ('retired',42,false)",
    );
    const reader = createPostgresModelCatalogReader({
      query: (sql, params) => db.query(sql, [...params]),
    });
    assert.equal(
      Object.hasOwn((await reader.listPublishedModels())[0] ?? {}, 'openRouterMetadata'),
      false,
    );
    await db.query('UPDATE catalog_models SET openrouter_metadata=$1::jsonb WHERE alias=$2', [
      JSON.stringify(metadata()),
      'retired',
    ]);
    assert.deepEqual((await reader.listPublishedModels())[0]?.openRouterMetadata, metadata());
    await assert.rejects(
      db.query('UPDATE catalog_models SET openrouter_metadata=$1::jsonb', [JSON.stringify([])]),
    );
    await db.query('UPDATE catalog_models SET openrouter_metadata=$1::jsonb', [
      JSON.stringify({ pricing: { prompt: 'private-secret' } }),
    ]);
    await assert.rejects(reader.listPublishedModels(), {
      name: 'ModelCatalogUnavailable',
      message: 'Model catalog unavailable',
    });
  } finally {
    await db.close();
  }
});
test('malformed configured discovery fails entire catalog safely including denied/disabled records', async () => {
  const invalid = [
    {},
    { ...metadata(), id: 'unauthorized' },
    { ...metadata(), pricing: { prompt: 'private-secret', completion: '0' } },
    { ...metadata(), context_length: -1 },
    { ...metadata(), top_provider: { is_moderated: null } },
    {
      ...metadata(),
      architecture: { modality: null, input_modalities: 'text', output_modalities: ['text'] },
    },
    { ...metadata(), supported_parameters: ['temperature', 42] },
    { ...metadata(), links: { details: 'javascript:private-secret' } },
    { ...metadata(), links: { details: 'https://private-secret@catalog.example/model' } },
    { ...metadata(), name: 'x'.repeat(257) },
    { ...metadata(), context_length: Number.MAX_SAFE_INTEGER + 1 },
    { ...metadata(), context_length: 1.5 },
    { ...metadata(), default_parameters: { temperature: Number.NaN } },
    { ...metadata(), default_parameters: { top_k: 1.5 } },
    { ...metadata(), per_request_limits: { prompt_tokens: -1, completion_tokens: 1 } },
    { ...metadata(), supported_parameters: ['temperature', 'temperature'] },
    { ...metadata(), supported_parameters: Array(65).fill('temperature') },
    { ...metadata(), supported_parameters: Array(1) },
    { ...metadata(), top_provider: { is_moderated: true, credential: 'private-secret' } },
    { ...metadata(), pricing: { prompt: 'Infinity', completion: '0' } },
    { ...metadata(), pricing: { prompt: '-1', completion: '0' } },
  ];
  for (const value of invalid)
    for (const deny of [false, true]) {
      const f = fixture([model(), { ...model(value, 'invalid'), enabled: false }], { deny });
      const response = await f.handler(f.request());
      assert.equal(response.status, 503);
      assert.doesNotMatch(await response.text(), /private-secret|unauthorized/);
      assert.doesNotMatch(JSON.stringify(f.events), /private-secret|unauthorized/);
    }
});
test('required listing audit failure suppresses rich metadata', async () => {
  const f = fixture([model()], {
    audit: () => {
      throw new Error('private-secret');
    },
  });
  const response = await f.handler(f.request());
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private-secret|published\/canonical/);
});
test('PostgreSQL catalog reader captures metadata and rejects invalid stored snapshots', async () => {
  const source = metadata();
  const row = {
    alias: 'chat',
    created_at_seconds: '42',
    enabled: true,
    active_route_id: 'route',
    route_id: 'route',
    kind: 'managed',
    version: 'v1',
    credential_ref: null,
    jev_credential_ref: null,
    jev_minimum_confidence: null,
    jev_send_prompt: null,
    candidates: [
      { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'upstream' },
    ],
    openrouter_metadata: source,
  };
  const reader = createPostgresModelCatalogReader({ query: async () => ({ rows: [row] }) });
  const result = await reader.listPublishedModels();
  assert.deepEqual(
    (result[0] as unknown as { openRouterMetadata: unknown }).openRouterMetadata,
    source,
  );
  source.supported_parameters.push('private');
  assert.deepEqual(
    (result[0] as unknown as { openRouterMetadata: { supported_parameters: string[] } })
      .openRouterMetadata.supported_parameters,
    ['temperature', 'max_tokens'],
  );
  row.openrouter_metadata = {} as typeof source;
  await assert.rejects(reader.listPublishedModels(), {
    name: 'ModelCatalogUnavailable',
    message: 'Model catalog unavailable',
  });
  await assert.rejects(reader.resolveRoute('chat'), {
    name: 'ModelCatalogUnavailable',
    message: 'Model catalog unavailable',
  });
});

test('rich discovery retains alias/provider explicit deny and disabled filtering in both route kinds', async () => {
  for (const kind of ['managed', 'delegated'] as const)
    for (const deniedResource of ['model:hidden', 'provider:blocked']) {
      const visible = model();
      const hidden = {
        ...model(metadata(), 'hidden'),
        routes: [
          {
            kind,
            candidates: [
              { id: 'blocked', kind, providerId: 'blocked', upstreamModelId: 'upstream' },
            ],
          },
        ],
      };
      const f = fixture([visible, hidden, { ...model(metadata(), 'disabled'), enabled: false }], {
        statements: [
          { effect: 'Allow', actions: ['*'], resources: ['*'] },
          { effect: 'Deny', actions: ['*'], resources: [deniedResource] },
        ],
      });
      const response = await f.handler(f.request());
      assert.equal(response.status, 200);
      const body = (await response.json()) as { total_count: number; data: Array<{ id: string }> };
      assert.equal(body.total_count, 1);
      assert.deepEqual(
        body.data.map((entry) => entry.id),
        ['chat'],
      );
      assert.equal((f.events[0] as { count: number }).count, 1);
    }
});
test('nullable metadata and exact price spellings survive without invented defaults', async () => {
  const source = {
    ...metadata(),
    context_length: null,
    default_parameters: null,
    per_request_limits: { prompt_tokens: 12, completion_tokens: 4 },
    pricing: { prompt: '1e-6', completion: '0.0000020', request: '0' },
    supported_voices: ['voice'],
    top_provider: { is_moderated: false },
  };
  const f = fixture([model(source)]);
  const body = (await (await f.handler(f.request())).json()) as {
    data: Array<Record<string, unknown>>;
  };
  assert.equal(body.data[0]?.context_length, null);
  assert.deepEqual(body.data[0]?.pricing, source.pricing);
  assert.deepEqual(body.data[0]?.top_provider, { is_moderated: false });
});

test('public discovery captures validated nested metadata values once', async () => {
  for (const field of ['moderation', 'modality', 'voices', 'limits']) {
    const source = metadata();
    let reads = 0;
    const getter = (first: unknown, later: unknown) => ({
      enumerable: true,
      get: () => (++reads === 1 ? first : later),
    });
    if (field === 'moderation')
      Object.defineProperty(source.top_provider, 'is_moderated', getter(true, 'private invalid'));
    if (field === 'modality')
      Object.defineProperty(source.architecture, 'modality', getter('text->text', null));
    if (field === 'voices')
      Object.defineProperty(source, 'supported_voices', getter(['voice'], null));
    if (field === 'limits')
      Object.defineProperty(
        source,
        'per_request_limits',
        getter({ prompt_tokens: 1, completion_tokens: 2 }, null),
      );
    const f = fixture([model(source)]);
    const response = await f.handler(f.request());
    assert.equal(response.status, 200);
    const result = ((await response.json()) as { data: OpenRouterModelMetadata[] }).data[0];
    assert.ok(result);
    assert.equal(reads, 1);
    if (field === 'moderation') assert.equal(result.top_provider.is_moderated, true);
    if (field === 'modality') assert.equal(result.architecture.modality, 'text->text');
    if (field === 'voices') assert.deepEqual(result.supported_voices, ['voice']);
    if (field === 'limits')
      assert.deepEqual(result.per_request_limits, { prompt_tokens: 1, completion_tokens: 2 });
    assert.equal(JSON.stringify(f.events).includes('private'), false);
  }
});
