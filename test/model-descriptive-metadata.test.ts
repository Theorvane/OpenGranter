import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresModelCatalogReader } from '../src/gateway/postgres-model-catalog.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import {
  descriptiveFields,
  descriptiveModel,
  descriptivePrivacy,
} from './model-descriptive-metadata-fixture.ts';
import { discoveryFixture, discoveryModel } from './model-discovery-filters-fixture.ts';

type List = {
  data: Array<Record<string, unknown>>;
  total_count: number;
  links: { next: string | null };
};
const fields = ['description', 'expiration_date', 'knowledge_cutoff'] as const;
for (const extra of [
  descriptiveFields,
  { description: '' },
  { description: ' \n\t ' },
  { expiration_date: null, knowledge_cutoff: null },
  { expiration_date: '', knowledge_cutoff: 'not-a-date' },
  { expiration_date: '2026-02-30', knowledge_cutoff: '2024-06' },
  {},
])
  test(`public descriptive metadata preserves exact values: ${JSON.stringify(extra)}`, async () => {
    const f = discoveryFixture([descriptiveModel(extra)]);
    const response = await f.handler(f.request());
    assert.equal(response.status, 200);
    const body = (await response.json()) as List;
    assert.equal(body.total_count, 1);
    for (const field of fields) {
      assert.equal(Object.hasOwn(body.data[0] ?? {}, field), Object.hasOwn(extra, field));
      if (Object.hasOwn(extra, field))
        assert.equal(body.data[0]?.[field], (extra as Record<string, unknown>)[field]);
    }
    descriptivePrivacy(f);
  });
for (const [field, max] of [
  ['description', 8192],
  ['expiration_date', 256],
  ['knowledge_cutoff', 256],
] as const)
  for (const text of ['x'.repeat(max), '😀'.repeat(max / 2)])
    test(`descriptive ${field} accepts exact UTF-16 boundary ${text[0]}`, async () => {
      const f = discoveryFixture([descriptiveModel({ [field]: text })]);
      const response = await f.handler(f.request());
      assert.equal(response.status, 200);
      assert.equal(((await response.json()) as List).data[0]?.[field], text);
      descriptivePrivacy(f);
    });
for (const [field, values] of [
  ['description', [null, undefined, 1, false, {}, [], 'x'.repeat(8193), `${'😀'.repeat(4096)}x`]],
  ['expiration_date', [undefined, 1, false, {}, [], 'x'.repeat(257)]],
  ['knowledge_cutoff', [undefined, 1, false, {}, [], `${'😀'.repeat(128)}x`]],
] as const)
  for (const [index, value] of values.entries())
    test(`invalid descriptive ${field} value${index} fails the entire hidden catalog`, async () => {
      const bad = { ...descriptiveModel({ [field]: value }, 'private-denied'), enabled: false };
      const f = discoveryFixture([discoveryModel('visible'), bad]);
      const response = await f.handler(f.request('?limit=1'));
      assert.equal(response.status, 503);
      assert.doesNotMatch(
        await response.text(),
        /descriptive-private|visible|description|expiration_date|knowledge_cutoff/u,
      );
      descriptivePrivacy(f);
    });
for (const resource of ['model:one', 'provider:provider', '*'])
  test(`descriptive metadata retains explicit Deny: ${resource}`, async () => {
    const f = discoveryFixture([descriptiveModel()], {
      statements: [
        { effect: 'Allow', actions: ['*'], resources: ['*'] },
        { effect: 'Deny', actions: ['*'], resources: [resource] },
      ],
    });
    const response = await f.handler(f.request());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      object: 'list',
      data: [],
      total_count: 0,
      links: { next: null },
    });
    descriptivePrivacy(f);
  });
test('descriptive metadata retains implicit Deny and authentication before catalog access', async () => {
  const denied = discoveryFixture([descriptiveModel()], { statements: [] });
  const response = await denied.handler(denied.request());
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as List).data.length, 0);
  descriptivePrivacy(denied);
  const f = discoveryFixture([descriptiveModel()], { authenticated: false });
  assert.equal((await f.handler(f.request())).status, 401);
  assert.equal(f.reads(), 0);
  descriptivePrivacy(f);
});
for (const options of [{ catalogFailure: true }, { auditFailure: true }])
  test(`descriptive metadata stays private on required dependency failure: ${JSON.stringify(options)}`, async () => {
    const f = discoveryFixture([descriptiveModel()], options);
    const response = await f.handler(f.request());
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /descriptive-private|2000-01-01|description/u);
    descriptivePrivacy(f);
  });
test('legacy/basic responses omit descriptive metadata and missing fields stay absent', async () => {
  const f = discoveryFixture([descriptiveModel(), discoveryModel('basic', { basic: true })]);
  const legacy = await f.handler(f.request('', '/v1'));
  assert.equal(legacy.status, 200);
  const old = (await legacy.json()) as List;
  assert.deepEqual(
    old.data.map((m) => Object.keys(m).sort()),
    [
      ['created', 'id', 'object', 'owned_by'],
      ['created', 'id', 'object', 'owned_by'],
    ],
  );
  const response = await f.handler(f.request());
  assert.equal(response.status, 200);
  const body = (await response.json()) as List;
  assert.ok(body.data[0]?.description);
  assert.ok(fields.every((field) => !Object.hasOwn(body.data[1] ?? {}, field)));
  descriptivePrivacy(f);
});
test('past expiration does not disable an alias and descriptive strings do not expand search/order', async () => {
  const f = discoveryFixture([
    descriptiveModel(descriptiveFields, 'old'),
    descriptiveModel({ ...descriptiveFields, expiration_date: '2099-01-01' }, 'future'),
  ]);
  const response = await f.handler(f.request('?sort=newest&limit=1'));
  assert.equal(response.status, 200);
  const body = (await response.json()) as List;
  assert.equal(body.total_count, 2);
  assert.equal(body.data[0]?.id, 'old');
  const search = await f.handler(f.request('?q=descriptive-private'));
  assert.equal(search.status, 200);
  assert.deepEqual(((await search.json()) as List).data, []);
  descriptivePrivacy(f);
});
test('descriptive values survive source mutation during required audit', async () => {
  const model = descriptiveModel();
  const metadata = model.openRouterMetadata;
  assert.ok(metadata);
  const f = discoveryFixture([model], {
    audit: () =>
      Object.assign(metadata, {
        description: 'changed',
        expiration_date: null,
        knowledge_cutoff: null,
      }),
  });
  const response = await f.handler(f.request());
  assert.equal(response.status, 200);
  const row = ((await response.json()) as List).data[0];
  for (const field of fields) assert.equal(row?.[field], descriptiveFields[field]);
  descriptivePrivacy(f);
});
for (const field of fields)
  test(`descriptive ${field} captures its own getter once before validation/projection`, async () => {
    const model = descriptiveModel({});
    const metadata = model.openRouterMetadata;
    assert.ok(metadata);
    let reads = 0;
    Object.defineProperty(metadata, field, {
      enumerable: true,
      get: () => (++reads === 1 ? descriptiveFields[field] : {}),
    });
    const f = discoveryFixture([model]);
    const response = await f.handler(f.request());
    assert.equal(response.status, 200);
    assert.equal(reads, 1);
    assert.equal(((await response.json()) as List).data[0]?.[field], descriptiveFields[field]);
    descriptivePrivacy(f);
  });
test('inherited descriptive fields are omitted and throwing getters stay private', async () => {
  const model = descriptiveModel({});
  const metadata = model.openRouterMetadata;
  assert.ok(metadata);
  Object.setPrototypeOf(metadata, descriptiveFields);
  const f = discoveryFixture([model]);
  const response = await f.handler(f.request());
  assert.equal(response.status, 200);
  const row = ((await response.json()) as List).data[0] ?? {};
  assert.ok(fields.every((field) => !Object.hasOwn(row, field)));
  const bad = descriptiveModel({});
  assert.ok(bad.openRouterMetadata);
  Object.defineProperty(bad.openRouterMetadata, 'description', {
    enumerable: true,
    get: () => {
      throw Error('descriptive-private-failure');
    },
  });
  const broken = discoveryFixture([bad]);
  const error = await broken.handler(broken.request());
  assert.equal(error.status, 503);
  assert.doesNotMatch(await error.text(), /descriptive-private-failure/u);
  descriptivePrivacy(broken);
});
function storedRow(metadata: unknown) {
  return {
    alias: 'one',
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
    openrouter_metadata: metadata,
  };
}
test('PostgreSQL reader captures descriptive fields but retains the same route for past expiration', async () => {
  const model = descriptiveModel();
  const row = storedRow(model.openRouterMetadata);
  const reader = createPostgresModelCatalogReader({ query: async () => ({ rows: [row] }) });
  const result = await reader.listPublishedModels();
  const route = await reader.resolveRoute('one');
  assert.deepEqual(route, { kind: 'managed', version: 'v1', candidates: row.candidates });
  assert.ok(model.openRouterMetadata);
  Object.assign(model.openRouterMetadata, { description: 'changed', expiration_date: null });
  const captured = result[0]?.openRouterMetadata as unknown as Record<string, unknown>;
  for (const field of fields) assert.equal(captured[field], descriptiveFields[field]);
  row.openrouter_metadata = { ...model.openRouterMetadata, knowledge_cutoff: 5 };
  for (const call of [() => reader.listPublishedModels(), () => reader.resolveRoute('one')])
    await assert.rejects(call, {
      name: 'ModelCatalogUnavailable',
      message: 'Model catalog unavailable',
    });
});
test('migrated JSONB stores descriptive values without backfill and retains64KiB cap', async () => {
  const db = new PGlite();
  try {
    for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
    await db.exec(
      "INSERT INTO catalog_models (alias,created_at_seconds,enabled) VALUES ('one',42,false)",
    );
    const reader = createPostgresModelCatalogReader({
      query: (sql, params) => db.query(sql, [...params]),
    });
    assert.equal((await reader.listPublishedModels())[0]?.openRouterMetadata, undefined);
    const metadata = descriptiveModel({
      ...descriptiveFields,
      expiration_date: null,
    }).openRouterMetadata;
    await db.query('UPDATE catalog_models SET openrouter_metadata=$1::jsonb WHERE alias=$2', [
      JSON.stringify(metadata),
      'one',
    ]);
    assert.deepEqual((await reader.listPublishedModels())[0]?.openRouterMetadata, metadata);
    await assert.rejects(
      db.query('UPDATE catalog_models SET openrouter_metadata=$1::jsonb WHERE alias=$2', [
        JSON.stringify({ ...metadata, description: 'x'.repeat(65536) }),
        'one',
      ]),
    );
    assert.deepEqual((await reader.listPublishedModels())[0]?.openRouterMetadata, metadata);
  } finally {
    await db.close();
  }
});
