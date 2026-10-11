import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresModelCatalogReader } from '../src/gateway/postgres-model-catalog.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import {
  capabilityFields,
  capabilityModel,
  capabilityPrivacy,
} from './model-capability-metadata-fixture.ts';
import { discoveryFixture, discoveryModel } from './model-discovery-filters-fixture.ts';

type List = {
  data: Array<Record<string, unknown>>;
  total_count: number;
  links: { next: string | null };
};
const valid = [
  capabilityFields,
  { reasoning: { mandatory: false } },
  { reasoning: { mandatory: true, default_effort: null, supported_efforts: null } },
  { reasoning: { mandatory: false, supported_efforts: [] } },
  {
    reasoning: {
      mandatory: true,
      default_enabled: false,
      default_effort: 'none',
      supported_efforts: ['none', null, 'none'],
      supports_max_tokens: false,
    },
  },
  {
    reasoning: {
      mandatory: false,
      default_effort: 'catalog-private-new',
      supported_efforts: [
        'max',
        'xhigh',
        'high',
        'medium',
        'low',
        'minimal',
        'none',
        'catalog-private-new',
        null,
      ],
    },
  },
  { reasoning: { mandatory: false, default_effort: '', supported_efforts: ['', ' \n ', '😀'] } },
  { alias_target: { slug: '', name: ' \n\t ' } },
  {},
];
for (const [index, fields] of valid.entries())
  test(`public reasoning/alias metadata exact null/omission/open shape case${index}`, async () => {
    const f = discoveryFixture([capabilityModel(fields)]);
    const response = await f.handler(f.request());
    assert.equal(response.status, 200);
    const row = ((await response.json()) as List).data[0];
    assert.ok(row);
    assert.equal(row.id, 'one');
    for (const key of ['reasoning', 'alias_target']) {
      assert.equal(Object.hasOwn(row, key), Object.hasOwn(fields, key));
      if (Object.hasOwn(fields, key))
        assert.deepEqual(row[key], (fields as Record<string, unknown>)[key]);
    }
    capabilityPrivacy(f);
  });
for (const text of ['x'.repeat(256), '😀'.repeat(128)])
  test(`capability exact UTF-16 bounds ${text.charCodeAt(0)}`, async () => {
    const extra = {
      reasoning: {
        mandatory: false,
        default_effort: text,
        supported_efforts: Array.from({ length: 64 }, () => text),
      },
      alias_target: { slug: text, name: text },
    };
    const f = discoveryFixture([capabilityModel(extra)]);
    const response = await f.handler(f.request());
    assert.equal(response.status, 200);
    const row = ((await response.json()) as List).data[0];
    assert.deepEqual(row?.reasoning, extra.reasoning);
    assert.deepEqual(row?.alias_target, extra.alias_target);
    capabilityPrivacy(f);
  });
const invalid: Record<string, unknown>[] = [
  ...[undefined, null, 1, '', []].map((reasoning) => ({ reasoning })),
  ...[undefined, null, 1, '', []].map((alias_target) => ({ alias_target })),
  ...[
    {},
    { mandatory: undefined },
    { mandatory: null },
    { mandatory: 1 },
    { mandatory: false, extra: 1 },
    { mandatory: false, default_enabled: null },
    { mandatory: false, default_enabled: 0 },
    { mandatory: false, supports_max_tokens: undefined },
    { mandatory: false, supports_max_tokens: 'true' },
    { mandatory: false, default_effort: undefined },
    { mandatory: false, default_effort: 1 },
    { mandatory: false, default_effort: 'x'.repeat(257) },
    { mandatory: false, supported_efforts: undefined },
    { mandatory: false, supported_efforts: 'high' },
    { mandatory: false, supported_efforts: [false] },
    { mandatory: false, supported_efforts: [undefined] },
    { mandatory: false, supported_efforts: new Array(1) },
    { mandatory: false, supported_efforts: [`${'😀'.repeat(128)}x`] },
    { mandatory: false, supported_efforts: Array.from({ length: 65 }, () => null) },
  ].map((reasoning) => ({ reasoning })),
  ...[
    {},
    { slug: 'source' },
    { name: 'name' },
    { slug: undefined, name: 'name' },
    { slug: 'source', name: null },
    { slug: 1, name: 'name' },
    { slug: 'source', name: 'x'.repeat(257) },
    { slug: `${'😀'.repeat(128)}x`, name: 'name' },
    { slug: 'source', name: 'name', extra: true },
  ].map((alias_target) => ({ alias_target })),
];
for (const [index, extra] of invalid.entries())
  test(`malformed reasoning/alias case${index} fails complete hidden catalog privately`, async () => {
    const bad = { ...capabilityModel(extra, 'private-denied'), enabled: false };
    const f = discoveryFixture([discoveryModel('visible'), bad]);
    const response = await f.handler(f.request('?limit=1'));
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /catalog-private|reasoning|alias_target|visible/u);
    capabilityPrivacy(f);
  });
for (const resource of ['model:one', 'provider:provider', '*'])
  test(`reasoning/alias metadata preserves explicit Deny ${resource}`, async () => {
    const f = discoveryFixture([capabilityModel()], {
      statements: [
        { effect: 'Allow', actions: ['*'], resources: ['*'] },
        { effect: 'Deny', actions: ['*'], resources: [resource] },
      ],
    });
    const response = await f.handler(f.request());
    assert.equal(response.status, 200);
    assert.deepEqual(((await response.json()) as List).data, []);
    capabilityPrivacy(f);
  });
test('reasoning/alias metadata retains implicit Deny and authentication before catalog', async () => {
  const denied = discoveryFixture([capabilityModel()], { statements: [] });
  const r = await denied.handler(denied.request());
  assert.equal(r.status, 200);
  assert.deepEqual(((await r.json()) as List).data, []);
  capabilityPrivacy(denied);
  const f = discoveryFixture([capabilityModel()], { authenticated: false });
  assert.equal((await f.handler(f.request())).status, 401);
  assert.equal(f.reads(), 0);
  capabilityPrivacy(f);
});
for (const options of [{ auditFailure: true }, { catalogFailure: true }])
  test(`capability metadata stays private on required failure ${JSON.stringify(options)}`, async () => {
    const f = discoveryFixture([capabilityModel()], options);
    const r = await f.handler(f.request());
    assert.equal(r.status, 503);
    assert.doesNotMatch(await r.text(), /catalog-private|reasoning|alias_target/u);
    capabilityPrivacy(f);
  });
test('reasoning/alias shapes do not expand search, capability filtering, alias identity or basic/legacy rows', async () => {
  const f = discoveryFixture([capabilityModel(), discoveryModel('basic', { basic: true })]);
  for (const query of [
    '?q=catalog-private',
    '?supported_parameters=reasoning',
    '?input_modalities=image',
  ]) {
    const r = await f.handler(f.request(query));
    assert.equal(r.status, 200);
    assert.deepEqual(((await r.json()) as List).data, []);
  }
  const r = await f.handler(f.request());
  const rows = ((await r.json()) as List).data;
  assert.equal(rows[0]?.id, 'one');
  assert.deepEqual(Object.keys(rows[1] ?? {}).sort(), ['created', 'id', 'object', 'owned_by']);
  const old = await f.handler(f.request('', '/v1'));
  assert.equal(old.status, 200);
  assert.deepEqual(
    ((await old.json()) as List).data.map((row) => Object.keys(row).sort()),
    [
      ['created', 'id', 'object', 'owned_by'],
      ['created', 'id', 'object', 'owned_by'],
    ],
  );
  capabilityPrivacy(f);
});
test('nested objects and effort arrays survive source mutation during required audit', async () => {
  const model = capabilityModel();
  assert.ok(model.openRouterMetadata);
  const metadata = model.openRouterMetadata as unknown as typeof capabilityFields;
  const f = discoveryFixture([model], {
    audit: () => {
      metadata.reasoning.mandatory = false;
      metadata.reasoning.default_effort = 'changed';
      metadata.reasoning.supported_efforts.splice(0, 4, 'changed');
      metadata.alias_target.slug = 'changed';
    },
  });
  const r = await f.handler(f.request());
  assert.equal(r.status, 200);
  const row = ((await r.json()) as List).data[0];
  assert.deepEqual(row?.reasoning, capabilityFields.reasoning);
  assert.deepEqual(row?.alias_target, capabilityFields.alias_target);
  capabilityPrivacy(f);
});
test('root, nested and effort item getters are captured once', async () => {
  const model = capabilityModel({});
  assert.ok(model.openRouterMetadata);
  const reads = new Map<string, number>();
  const once = (key: string, value: unknown) => ({
    enumerable: true,
    get: () => {
      const count = (reads.get(key) ?? 0) + 1;
      reads.set(key, count);
      return count === 1 ? value : {};
    },
  });
  const efforts: unknown[] = [];
  Object.defineProperty(efforts, 0, once('item', 'high'));
  const reasoning = Object.defineProperties(
    {},
    {
      mandatory: once('mandatory', true),
      default_enabled: once('enabled', false),
      default_effort: once('default', null),
      supported_efforts: once('efforts', efforts),
      supports_max_tokens: once('max', true),
    },
  );
  const alias = Object.defineProperties(
    {},
    { slug: once('slug', 'source'), name: once('name', 'Source') },
  );
  Object.defineProperties(model.openRouterMetadata, {
    reasoning: once('reasoning', reasoning),
    alias_target: once('alias', alias),
  });
  const f = discoveryFixture([model]);
  const r = await f.handler(f.request());
  assert.equal(r.status, 200);
  assert.equal(reads.size, 10);
  assert.ok([...reads.values()].every((count) => count === 1));
  const row = ((await r.json()) as List).data[0];
  assert.deepEqual(row?.reasoning, {
    mandatory: true,
    default_enabled: false,
    default_effort: null,
    supported_efforts: ['high'],
    supports_max_tokens: true,
  });
  assert.deepEqual(row?.alias_target, { slug: 'source', name: 'Source' });
  capabilityPrivacy(f);
});
test('inherited optional root/nested fields are never read and own required fields are mandatory', async () => {
  const inherited = Object.defineProperties(
    {},
    {
      default_effort: {
        get: () => {
          throw Error('catalog-private-inherited');
        },
      },
      alias_target: {
        get: () => {
          throw Error('catalog-private-inherited');
        },
      },
    },
  );
  const model = capabilityModel({ reasoning: { mandatory: false } });
  assert.ok(model.openRouterMetadata);
  Object.setPrototypeOf(model.openRouterMetadata, inherited);
  Object.setPrototypeOf(
    (model.openRouterMetadata as unknown as { reasoning: object }).reasoning,
    inherited,
  );
  const f = discoveryFixture([model]);
  const r = await f.handler(f.request());
  assert.equal(r.status, 200);
  const row = ((await r.json()) as List).data[0];
  assert.deepEqual(row?.reasoning, { mandatory: false });
  assert.equal(Object.hasOwn(row ?? {}, 'alias_target'), false);
  capabilityPrivacy(f);
  for (const [key, value] of [
    ['reasoning', Object.create({ mandatory: false })],
    ['alias_target', Object.create({ slug: 'source', name: 'Source' })],
  ] as const) {
    const bad = capabilityModel({});
    assert.ok(bad.openRouterMetadata);
    Object.assign(bad.openRouterMetadata, { [key]: value });
    const broken = discoveryFixture([bad]);
    assert.equal((await broken.handler(broken.request())).status, 503);
    capabilityPrivacy(broken);
  }
});
for (const kind of ['root', 'nested', 'item'])
  test(`throwing ${kind} capability getter fails safely`, async () => {
    const model = capabilityModel({});
    assert.ok(model.openRouterMetadata);
    const fail = {
      enumerable: true,
      get: () => {
        throw Error('catalog-private-getter');
      },
    };
    if (kind === 'root') Object.defineProperty(model.openRouterMetadata, 'reasoning', fail);
    else {
      const efforts: unknown[] = [];
      const reasoning = { mandatory: true, supported_efforts: efforts };
      if (kind === 'nested') Object.defineProperty(reasoning, 'mandatory', fail);
      else Object.defineProperty(efforts, 0, fail);
      Object.assign(model.openRouterMetadata, { reasoning });
    }
    const f = discoveryFixture([model]);
    const r = await f.handler(f.request());
    assert.equal(r.status, 503);
    assert.doesNotMatch(await r.text(), /catalog-private-getter/u);
    capabilityPrivacy(f);
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
test('PostgreSQL freezes reasoning/alias metadata without resolving targets or changing routes', async () => {
  const model = capabilityModel();
  const row = storedRow(model.openRouterMetadata);
  const reader = createPostgresModelCatalogReader({ query: async () => ({ rows: [row] }) });
  const captured = (await reader.listPublishedModels())[0]
    ?.openRouterMetadata as unknown as typeof capabilityFields;
  assert.deepEqual(await reader.resolveRoute('one'), {
    kind: 'managed',
    version: 'v1',
    candidates: row.candidates,
  });
  assert.ok(Object.isFrozen(captured.reasoning));
  assert.ok(Object.isFrozen(captured.reasoning.supported_efforts));
  assert.ok(Object.isFrozen(captured.alias_target));
  assert.ok(model.openRouterMetadata);
  const source = model.openRouterMetadata as unknown as typeof capabilityFields;
  source.reasoning.supported_efforts[0] = 'changed';
  source.alias_target.name = 'changed';
  assert.deepEqual(captured, { ...model.openRouterMetadata, ...capabilityFields });
  row.openrouter_metadata = { ...model.openRouterMetadata, reasoning: { mandatory: null } };
  for (const call of [() => reader.listPublishedModels(), () => reader.resolveRoute('one')])
    await assert.rejects(call, {
      name: 'ModelCatalogUnavailable',
      message: 'Model catalog unavailable',
    });
});
test('migrated JSONB retains capability null/array data with no backfill and existing cap', async () => {
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
    const metadata = capabilityModel().openRouterMetadata;
    await db.query('UPDATE catalog_models SET openrouter_metadata=$1::jsonb WHERE alias=$2', [
      JSON.stringify(metadata),
      'one',
    ]);
    assert.deepEqual((await reader.listPublishedModels())[0]?.openRouterMetadata, metadata);
    await assert.rejects(
      db.query('UPDATE catalog_models SET openrouter_metadata=$1::jsonb WHERE alias=$2', [
        JSON.stringify({ ...metadata, alias_target: { slug: 'x'.repeat(65536), name: 'name' } }),
        'one',
      ]),
    );
    assert.deepEqual((await reader.listPublishedModels())[0]?.openRouterMetadata, metadata);
  } finally {
    await db.close();
  }
});
test('effort array holes reject even when an inherited element could fill the hole', async () => {
  const model = capabilityModel({});
  assert.ok(model.openRouterMetadata);
  const efforts = new Array(1);
  Object.setPrototypeOf(efforts, Object.assign(Object.create(Array.prototype), { 0: 'high' }));
  Object.assign(model.openRouterMetadata, {
    reasoning: { mandatory: false, supported_efforts: efforts },
  });
  const f = discoveryFixture([model]);
  const response = await f.handler(f.request());
  assert.equal(response.status, 503);
  capabilityPrivacy(f);
});
test('effort snapshot captures bounded own indices without executing a supplied iterator', async () => {
  const model = capabilityModel({});
  assert.ok(model.openRouterMetadata);
  const efforts = ['high'];
  let iterations = 0;
  Object.defineProperty(efforts, Symbol.iterator, {
    value: () => {
      iterations++;
      throw Error('catalog-private-iterator');
    },
  });
  Object.assign(model.openRouterMetadata, {
    reasoning: { mandatory: false, supported_efforts: efforts },
  });
  const f = discoveryFixture([model]);
  const response = await f.handler(f.request());
  assert.equal(response.status, 200);
  assert.equal(iterations, 0);
  assert.deepEqual(((await response.json()) as List).data[0]?.reasoning, {
    mandatory: false,
    supported_efforts: ['high'],
  });
  capabilityPrivacy(f);
});
