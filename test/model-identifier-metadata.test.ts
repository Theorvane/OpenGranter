import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresModelCatalogReader } from '../src/gateway/postgres-model-catalog.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { discoveryFixture, discoveryModel } from './model-discovery-filters-fixture.ts';
import {
  identifierContainer,
  identifierFields,
  identifierModel,
  identifierPrivacy,
  identifierValues,
} from './model-identifier-metadata-fixture.ts';

type List = {
  data: Array<Record<string, unknown>>;
  total_count: number;
  links: { next: string | null };
};
for (const field of identifierFields)
  for (const value of [
    identifierValues[field],
    'catalog-private-future/v2',
    '',
    ' \n\t ',
    ...(field === 'tokenizer' ? [] : [null]),
  ])
    test(`public identifier ${field} preserves exact ${JSON.stringify(value)}`, async () => {
      const f = discoveryFixture([identifierModel({ [field]: value })]);
      const response = await f.handler(f.request());
      assert.equal(response.status, 200);
      const row = ((await response.json()) as List).data[0];
      assert.ok(row);
      for (const key of identifierFields) {
        const container = identifierContainer(row, key);
        assert.equal(Object.hasOwn(container, key), key === field);
        if (key === field) assert.equal(container[key], value);
      }
      identifierPrivacy(f);
    });
for (const field of identifierFields)
  for (const value of ['x'.repeat(256), '😀'.repeat(128)])
    test(`identifier ${field} accepts exact UTF-16 boundary ${value.charCodeAt(0)}`, async () => {
      const f = discoveryFixture([identifierModel({ [field]: value })]);
      const response = await f.handler(f.request());
      assert.equal(response.status, 200);
      const row = ((await response.json()) as List).data[0];
      assert.ok(row);
      assert.equal(identifierContainer(row, field)[field], value);
      identifierPrivacy(f);
    });
for (const field of identifierFields)
  for (const [index, value] of [
    undefined,
    1,
    false,
    {},
    [],
    'x'.repeat(257),
    `${'😀'.repeat(128)}x`,
    ...(field === 'tokenizer' ? [null] : []),
  ].entries())
    test(`invalid identifier ${field} case${index} rejects entire hidden catalog`, async () => {
      const bad = { ...identifierModel({ [field]: value }, 'private-denied'), enabled: false };
      const f = discoveryFixture([discoveryModel('visible'), bad]);
      const response = await f.handler(f.request('?limit=1'));
      assert.equal(response.status, 503);
      assert.doesNotMatch(
        await response.text(),
        /catalog-private|hugging_face_id|tokenizer|instruct_type|visible/u,
      );
      identifierPrivacy(f);
    });
for (const resource of ['model:one', 'provider:provider', '*'])
  test(`identifier metadata preserves explicit Deny ${resource}`, async () => {
    const f = discoveryFixture([identifierModel()], {
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
    identifierPrivacy(f);
  });
test('identifier metadata preserves implicit Deny and authentication before catalog access', async () => {
  const f = discoveryFixture([identifierModel()], { statements: [] });
  const response = await f.handler(f.request());
  assert.equal(response.status, 200);
  assert.deepEqual(((await response.json()) as List).data, []);
  identifierPrivacy(f);
  const unauthenticated = discoveryFixture([identifierModel()], { authenticated: false });
  assert.equal((await unauthenticated.handler(unauthenticated.request())).status, 401);
  assert.equal(unauthenticated.reads(), 0);
  identifierPrivacy(unauthenticated);
});
for (const options of [{ catalogFailure: true }, { auditFailure: true }])
  test(`identifier metadata stays private on required failure ${JSON.stringify(options)}`, async () => {
    const f = discoveryFixture([identifierModel()], options);
    const response = await f.handler(f.request());
    assert.equal(response.status, 503);
    assert.doesNotMatch(
      await response.text(),
      /catalog-private|hugging_face_id|tokenizer|instruct_type/u,
    );
    identifierPrivacy(f);
  });
test('identifier omission and legacy/basic payloads remain unchanged', async () => {
  const f = discoveryFixture([identifierModel({}), discoveryModel('basic', { basic: true })]);
  const response = await f.handler(f.request());
  assert.equal(response.status, 200);
  const rows = ((await response.json()) as List).data;
  assert.ok(rows[0]);
  for (const field of identifierFields)
    assert.equal(Object.hasOwn(identifierContainer(rows[0], field), field), false);
  assert.deepEqual(Object.keys(rows[1] ?? {}).sort(), ['created', 'id', 'object', 'owned_by']);
  const legacy = discoveryFixture([identifierModel()]);
  const old = await legacy.handler(legacy.request('', '/v1'));
  assert.equal(old.status, 200);
  assert.deepEqual(Object.keys(((await old.json()) as List).data[0] ?? {}).sort(), [
    'created',
    'id',
    'object',
    'owned_by',
  ]);
  identifierPrivacy(f);
  identifierPrivacy(legacy);
});
test('identifiers neither expand search nor establish an input capability', async () => {
  const f = discoveryFixture([identifierModel()]);
  for (const query of ['?q=catalog-private', '?q=GPT', '?q=chatml', '?input_modalities=image']) {
    const response = await f.handler(f.request(query));
    assert.equal(response.status, 200);
    assert.deepEqual(((await response.json()) as List).data, []);
  }
  identifierPrivacy(f);
});
test('root and architecture identifiers survive mutation during required audit', async () => {
  const model = identifierModel();
  assert.ok(model.openRouterMetadata);
  const metadata = model.openRouterMetadata;
  const f = discoveryFixture([model], {
    audit: () => {
      Object.assign(metadata, { hugging_face_id: null });
      Object.assign(metadata.architecture, { tokenizer: 'changed', instruct_type: null });
    },
  });
  const response = await f.handler(f.request());
  assert.equal(response.status, 200);
  const row = ((await response.json()) as List).data[0];
  assert.ok(row);
  for (const field of identifierFields)
    assert.equal(identifierContainer(row, field)[field], identifierValues[field]);
  identifierPrivacy(f);
});
for (const field of identifierFields) {
  test(`identifier ${field} reads its own getter once`, async () => {
    const model = identifierModel({});
    assert.ok(model.openRouterMetadata);
    const container =
      field === 'hugging_face_id'
        ? model.openRouterMetadata
        : model.openRouterMetadata.architecture;
    let reads = 0;
    Object.defineProperty(container, field, {
      enumerable: true,
      get: () => (++reads === 1 ? identifierValues[field] : {}),
    });
    const f = discoveryFixture([model]);
    const response = await f.handler(f.request());
    assert.equal(response.status, 200);
    assert.equal(reads, 1);
    const row = ((await response.json()) as List).data[0];
    assert.ok(row);
    assert.equal(identifierContainer(row, field)[field], identifierValues[field]);
    identifierPrivacy(f);
  });
  test(`identifier ${field} throwing getter fails privately`, async () => {
    const model = identifierModel({});
    assert.ok(model.openRouterMetadata);
    Object.defineProperty(
      field === 'hugging_face_id'
        ? model.openRouterMetadata
        : model.openRouterMetadata.architecture,
      field,
      {
        enumerable: true,
        get: () => {
          throw Error('catalog-private-getter');
        },
      },
    );
    const f = discoveryFixture([model]);
    const response = await f.handler(f.request());
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /catalog-private-getter/u);
    identifierPrivacy(f);
  });
}
test('inherited root and nested optional identifiers are neither read nor projected', async () => {
  const model = identifierModel({});
  assert.ok(model.openRouterMetadata);
  const inherited = Object.fromEntries(
    identifierFields.map((field) => [
      field,
      {
        get: () => {
          throw Error('catalog-private-inherited');
        },
      },
    ]),
  );
  Object.setPrototypeOf(model.openRouterMetadata, Object.defineProperties({}, inherited));
  Object.setPrototypeOf(
    model.openRouterMetadata.architecture,
    Object.defineProperties({}, inherited),
  );
  const f = discoveryFixture([model]);
  const response = await f.handler(f.request());
  assert.equal(response.status, 200);
  const row = ((await response.json()) as List).data[0];
  assert.ok(row);
  for (const field of identifierFields)
    assert.equal(Object.hasOwn(identifierContainer(row, field), field), false);
  identifierPrivacy(f);
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
test('PostgreSQL reader captures identifiers without changing approved routes and rejects malformed storage', async () => {
  const model = identifierModel();
  const row = storedRow(model.openRouterMetadata);
  const reader = createPostgresModelCatalogReader({ query: async () => ({ rows: [row] }) });
  const result = await reader.listPublishedModels();
  assert.deepEqual(await reader.resolveRoute('one'), {
    kind: 'managed',
    version: 'v1',
    candidates: row.candidates,
  });
  assert.ok(model.openRouterMetadata);
  Object.assign(model.openRouterMetadata, { hugging_face_id: null });
  Object.assign(model.openRouterMetadata.architecture, {
    tokenizer: 'changed',
    instruct_type: null,
  });
  const captured = result[0]?.openRouterMetadata as unknown as Record<string, unknown>;
  for (const field of identifierFields)
    assert.equal(identifierContainer(captured, field)[field], identifierValues[field]);
  assert.ok(Object.isFrozen(captured));
  assert.ok(Object.isFrozen(captured.architecture));
  row.openrouter_metadata = {
    ...model.openRouterMetadata,
    architecture: { ...model.openRouterMetadata.architecture, tokenizer: null },
  };
  for (const call of [() => reader.listPublishedModels(), () => reader.resolveRoute('one')])
    await assert.rejects(call, {
      name: 'ModelCatalogUnavailable',
      message: 'Model catalog unavailable',
    });
});
test('migrated JSONB preserves identifier values, no backfill and existing 64 KiB cap', async () => {
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
    const metadata = identifierModel({
      ...identifierValues,
      hugging_face_id: null,
      instruct_type: null,
    }).openRouterMetadata;
    await db.query('UPDATE catalog_models SET openrouter_metadata=$1::jsonb WHERE alias=$2', [
      JSON.stringify(metadata),
      'one',
    ]);
    assert.deepEqual((await reader.listPublishedModels())[0]?.openRouterMetadata, metadata);
    await assert.rejects(
      db.query('UPDATE catalog_models SET openrouter_metadata=$1::jsonb WHERE alias=$2', [
        JSON.stringify({ ...metadata, hugging_face_id: 'x'.repeat(65536) }),
        'one',
      ]),
    );
    assert.deepEqual((await reader.listPublishedModels())[0]?.openRouterMetadata, metadata);
  } finally {
    await db.close();
  }
});
