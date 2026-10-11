import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresModelCatalogReader } from '../src/gateway/postgres-model-catalog.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { discoveryFixture, discoveryModel } from './model-discovery-filters-fixture.ts';
import {
  allPrices,
  basePrices,
  overrideData,
  overrideNumbers,
  overridePrices,
  pricingData,
  pricingModel,
  pricingPrivacy,
} from './model-pricing-adjustments-fixture.ts';

type List = {
  data: Array<Record<string, unknown>>;
  total_count: number;
  links: { next: string | null };
};
const valid = [
  allPrices,
  pricingData,
  basePrices,
  { ...basePrices, discount: 1.5, overrides: [] },
  { ...basePrices, overrides: [{}, {}] },
  {
    ...basePrices,
    discount: Number.MAX_VALUE,
    overrides: [
      {
        min_prompt_tokens: -Number.MAX_VALUE,
        utc_start: Number.MIN_VALUE,
        utc_end: Number.MAX_VALUE,
        utc_days: ['', ' \n\t ', '😀', 'future'],
      },
    ],
  },
  { ...basePrices, discount: 0, overrides: [{ prompt: '0', utc_days: ['sunday', 'sunday'] }] },
];
for (const [index, pricing] of valid.entries())
  test(`public pricing adjustment exact values/omission/empty/duplicates case${index}`, async () => {
    const f = discoveryFixture([pricingModel(pricing)]);
    const r = await f.handler(f.request());
    assert.equal(r.status, 200);
    assert.deepEqual(((await r.json()) as List).data[0]?.pricing, pricing);
    pricingPrivacy(f);
  });
for (const label of ['x'.repeat(256), '😀'.repeat(128)])
  test(`pricing UTC day UTF-16 boundary ${label.charCodeAt(0)}`, async () => {
    const pricing = { ...basePrices, overrides: [{ utc_days: [label] }] };
    const f = discoveryFixture([pricingModel(pricing)]);
    const r = await f.handler(f.request());
    assert.equal(r.status, 200);
    assert.deepEqual(((await r.json()) as List).data[0]?.pricing, pricing);
    pricingPrivacy(f);
  });
test('pricing retains 64 duplicate overrides/days and 128-unit exact decimal spellings', async () => {
  const price = `0.${'1'.repeat(126)}`;
  const pricing = {
    prompt: price,
    completion: price,
    overrides: Array.from({ length: 64 }, () => ({
      prompt: price,
      utc_days: Array.from({ length: 64 }, () => 'future'),
    })),
  };
  const f = discoveryFixture([pricingModel(pricing)]);
  const r = await f.handler(f.request());
  assert.equal(r.status, 200);
  assert.deepEqual(((await r.json()) as List).data[0]?.pricing, pricing);
  pricingPrivacy(f);
});
const invalid: unknown[] = [
  { ...basePrices, discount: undefined },
  { ...basePrices, discount: null },
  { ...basePrices, discount: NaN },
  { ...basePrices, discount: Infinity },
  { ...basePrices, discount: -Infinity },
  { ...basePrices, discount: '0.5' },
  { ...basePrices, discount: false },
  ...[
    undefined,
    null,
    1,
    {},
    new Array(1),
    [null],
    [undefined],
    Array.from({ length: 65 }, () => ({})),
  ].map((overrides) => ({ ...basePrices, overrides })),
  ...overridePrices.flatMap((field) =>
    [
      undefined,
      null,
      1,
      '',
      '-1',
      'NaN',
      'Infinity',
      '01',
      '0x1',
      '1e999',
      `0.${'1'.repeat(127)}`,
    ].map((value) => ({ ...basePrices, overrides: [{ [field]: value }] })),
  ),
  ...overrideNumbers.flatMap((field) =>
    [undefined, null, NaN, Infinity, -Infinity, '1', false, {}].map((value) => ({
      ...basePrices,
      overrides: [{ [field]: value }],
    })),
  ),
  ...[
    undefined,
    null,
    1,
    'monday',
    [],
    new Array(1),
    [null],
    [1],
    [undefined],
    Array.from({ length: 65 }, () => 'monday'),
    ['x'.repeat(257)],
    [`${'😀'.repeat(128)}x`],
  ].map((utc_days) => ({ ...basePrices, overrides: [{ utc_days }] })),
  { ...basePrices, unknown: 1 },
  { ...basePrices, overrides: [{ model: 'pricing-private' }] },
  { ...basePrices, overrides: [{ provider: 'pricing-private' }] },
  { completion: '0' },
  { prompt: '0' },
];
for (const [index, pricing] of invalid.entries())
  test(`malformed pricing adjustment case${index} rejects complete hidden catalog privately`, async () => {
    const f = discoveryFixture([
      discoveryModel('visible'),
      { ...pricingModel(pricing, 'private-denied'), enabled: false },
    ]);
    const r = await f.handler(f.request('?limit=1'));
    assert.equal(r.status, 503);
    assert.doesNotMatch(await r.text(), /pricing-private|overrides|discount|visible/u);
    pricingPrivacy(f);
  });
for (const resource of ['model:one', 'provider:provider', '*'])
  test(`pricing adjustments preserve explicit Deny ${resource}`, async () => {
    const f = discoveryFixture([pricingModel()], {
      statements: [
        { effect: 'Allow', actions: ['*'], resources: ['*'] },
        { effect: 'Deny', actions: ['*'], resources: [resource] },
      ],
    });
    const r = await f.handler(f.request());
    assert.equal(r.status, 200);
    assert.deepEqual(((await r.json()) as List).data, []);
    pricingPrivacy(f);
  });
test('pricing adjustments preserve implicit Deny and authenticate before catalog', async () => {
  const denied = discoveryFixture([pricingModel()], { statements: [] });
  const r = await denied.handler(denied.request());
  assert.equal(r.status, 200);
  assert.deepEqual(((await r.json()) as List).data, []);
  pricingPrivacy(denied);
  const f = discoveryFixture([pricingModel()], { authenticated: false });
  assert.equal((await f.handler(f.request())).status, 401);
  assert.equal(f.reads(), 0);
  pricingPrivacy(f);
});
for (const options of [{ catalogFailure: true }, { auditFailure: true }])
  test(`pricing required failure stays private ${JSON.stringify(options)}`, async () => {
    const f = discoveryFixture([pricingModel()], options);
    const r = await f.handler(f.request());
    assert.equal(r.status, 503);
    assert.doesNotMatch(await r.text(), /pricing-private|pricing|overrides|discount/u);
    pricingPrivacy(f);
  });
test('pricing adjustments do not expand predicates/order or change basic/legacy models', async () => {
  const f = discoveryFixture([pricingModel(), discoveryModel('basic', { basic: true })]);
  for (const query of [
    '?q=pricing-private',
    '?supported_parameters=overrides',
    '?input_modalities=image',
  ]) {
    const r = await f.handler(f.request(query));
    assert.equal(r.status, 200);
    assert.deepEqual(((await r.json()) as List).data, []);
  }
  const r = await f.handler(f.request('?sort=newest'));
  assert.equal(r.status, 200);
  const rows = ((await r.json()) as List).data;
  assert.deepEqual(
    rows.map((row) => row.id),
    ['one', 'basic'],
  );
  assert.deepEqual(Object.keys(rows[1] ?? {}).sort(), ['created', 'id', 'object', 'owned_by']);
  const legacy = await f.handler(f.request('', '/v1'));
  assert.equal(legacy.status, 200);
  assert.ok(
    ((await legacy.json()) as List).data.every(
      (row) => Object.keys(row).length === 4 && !Object.hasOwn(row, 'pricing'),
    ),
  );
  pricingPrivacy(f);
});
test('pricing snapshot survives nested price/condition/day/array mutation during audit', async () => {
  const model = pricingModel();
  assert.ok(model.openRouterMetadata);
  const source = model.openRouterMetadata as unknown as { pricing: typeof pricingData };
  const f = discoveryFixture([model], {
    audit: () => {
      source.pricing.discount = 9;
      source.pricing.prompt = '99';
      const row = source.pricing.overrides[0];
      assert.ok(row);
      row.prompt = '99';
      row.utc_start = 0;
      row.utc_days.splice(0);
      source.pricing.overrides.splice(1);
    },
  });
  const r = await f.handler(f.request());
  assert.equal(r.status, 200);
  assert.deepEqual(((await r.json()) as List).data[0]?.pricing, pricingData);
  pricingPrivacy(f);
});
test('pricing root/optional/row/day fields and array length/index getters are read once', async () => {
  const model = pricingModel(basePrices);
  assert.ok(model.openRouterMetadata);
  const reads = new Map<string, number>();
  const once = (key: string, value: unknown) => ({
    enumerable: true,
    get: () => {
      const n = (reads.get(key) ?? 0) + 1;
      reads.set(key, n);
      return n === 1 ? value : {};
    },
  });
  const days: string[] = [];
  Object.defineProperty(days, 0, once('day', 'future'));
  const dayProxy = new Proxy(days, {
    get: (target, key, receiver) => {
      if (key === 'length') reads.set('dayLength', (reads.get('dayLength') ?? 0) + 1);
      return Reflect.get(target, key, receiver);
    },
  });
  const row = Object.defineProperties(
    {},
    Object.fromEntries(
      Object.entries({ ...overrideData, utc_days: dayProxy }).map(([key, value]) => [
        key,
        once(key, value),
      ]),
    ),
  );
  const rows: unknown[] = [];
  Object.defineProperty(rows, 0, once('row', row));
  const rowsProxy = new Proxy(rows, {
    get: (target, key, receiver) => {
      if (key === 'length') reads.set('rowLength', (reads.get('rowLength') ?? 0) + 1);
      return Reflect.get(target, key, receiver);
    },
  });
  const pricing = Object.defineProperties(
    {},
    Object.fromEntries(
      Object.entries({ ...allPrices, discount: 0.5, overrides: rowsProxy }).map(([key, value]) => [
        key,
        once(`price-${key}`, value),
      ]),
    ),
  );
  Object.defineProperty(model.openRouterMetadata, 'pricing', once('root', pricing));
  const f = discoveryFixture([model]);
  const r = await f.handler(f.request());
  assert.equal(r.status, 200);
  assert.equal(reads.size, 32);
  assert.ok([...reads.values()].every((n) => n === 1));
  assert.deepEqual(((await r.json()) as List).data[0]?.pricing, {
    ...allPrices,
    discount: 0.5,
    overrides: [{ ...overrideData, utc_days: ['future'] }],
  });
  pricingPrivacy(f);
});
test('non-enumerable own base prices capture once instead of producing incomplete pricing', async () => {
  const model = pricingModel({});
  assert.ok(model.openRouterMetadata);
  let reads = 0;
  const pricing = Object.defineProperties(
    {},
    Object.fromEntries(
      Object.entries(basePrices).map(([key, value]) => [
        key,
        {
          get: () => {
            reads++;
            return value;
          },
        },
      ]),
    ),
  );
  Object.assign(model.openRouterMetadata, { pricing });
  const f = discoveryFixture([model]);
  const r = await f.handler(f.request());
  assert.equal(r.status, 200);
  assert.equal(reads, 2);
  assert.deepEqual(((await r.json()) as List).data[0]?.pricing, basePrices);
  pricingPrivacy(f);
});
test('inherited optional pricing/override values omitted and inherited base prices rejected', async () => {
  const model = pricingModel(basePrices);
  assert.ok(model.openRouterMetadata);
  const fail = {
    get: () => {
      throw Error('pricing-private-inherited');
    },
  };
  const pricing = Object.setPrototypeOf(
    { ...basePrices },
    Object.defineProperties({}, { discount: fail, overrides: fail, audio: fail }),
  );
  Object.assign(model.openRouterMetadata, { pricing });
  const f = discoveryFixture([model]);
  let r = await f.handler(f.request());
  assert.equal(r.status, 200);
  assert.deepEqual(((await r.json()) as List).data[0]?.pricing, basePrices);
  const row = Object.create(
    Object.defineProperties({}, { prompt: fail, utc_days: fail, utc_start: fail }),
  );
  Object.assign(model.openRouterMetadata, { pricing: { ...basePrices, overrides: [row] } });
  r = await f.handler(f.request());
  assert.equal(r.status, 200);
  assert.deepEqual(((await r.json()) as List).data[0]?.pricing, { ...basePrices, overrides: [{}] });
  Object.assign(model.openRouterMetadata, { pricing: Object.create(basePrices) });
  assert.equal((await f.handler(f.request())).status, 503);
  pricingPrivacy(f);
});
for (const field of ['overrides', 'utc_days'])
  test(`pricing ${field} ignores custom iterator and rejects inherited holes`, async () => {
    const model = pricingModel(basePrices);
    assert.ok(model.openRouterMetadata);
    let iterations = 0;
    const values: unknown[] = field === 'overrides' ? [{}] : ['future'];
    Object.defineProperty(values, Symbol.iterator, {
      value: () => {
        iterations++;
        throw Error('pricing-private-iterator');
      },
    });
    const pricing = {
      ...basePrices,
      ...(field === 'overrides' ? { overrides: values } : { overrides: [{ utc_days: values }] }),
    };
    Object.assign(model.openRouterMetadata, { pricing });
    const f = discoveryFixture([model]);
    const r = await f.handler(f.request());
    assert.equal(r.status, 200);
    assert.equal(iterations, 0);
    assert.deepEqual(
      ((await r.json()) as List).data[0]?.pricing,
      field === 'overrides'
        ? { ...basePrices, overrides: [{}] }
        : { ...basePrices, overrides: [{ utc_days: ['future'] }] },
    );
    const holes = new Array(1);
    Object.setPrototypeOf(
      holes,
      Object.assign(Object.create(Array.prototype), { 0: field === 'overrides' ? {} : 'monday' }),
    );
    Object.assign(model.openRouterMetadata, {
      pricing: {
        ...basePrices,
        ...(field === 'overrides' ? { overrides: holes } : { overrides: [{ utc_days: holes }] }),
      },
    });
    assert.equal((await f.handler(f.request())).status, 503);
    pricingPrivacy(f);
  });
for (const level of ['root', 'discount', 'row', 'condition', 'day'])
  test(`throwing pricing ${level} getter stays private`, async () => {
    const model = pricingModel(basePrices);
    assert.ok(model.openRouterMetadata);
    const fail = {
      enumerable: true,
      get: () => {
        throw Error('pricing-private-getter');
      },
    };
    const pricing = { ...basePrices };
    if (level === 'root') Object.defineProperty(model.openRouterMetadata, 'pricing', fail);
    else if (level === 'discount') Object.defineProperty(pricing, 'discount', fail);
    else {
      const row = { ...overrideData, utc_days: ['monday'] };
      const rows: unknown[] = [row];
      if (level === 'row') Object.defineProperty(rows, 0, fail);
      else if (level === 'condition') Object.defineProperty(row, 'utc_start', fail);
      else Object.defineProperty(row.utc_days, 0, fail);
      Object.assign(pricing, { overrides: rows });
    }
    if (level !== 'root') Object.assign(model.openRouterMetadata, { pricing });
    const f = discoveryFixture([model]);
    const r = await f.handler(f.request());
    assert.equal(r.status, 503);
    assert.doesNotMatch(await r.text(), /pricing-private-getter/u);
    pricingPrivacy(f);
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
test('PostgreSQL pricing snapshot deep freezes and retains approved route with private invalid failures', async () => {
  const model = pricingModel();
  const row = storedRow(model.openRouterMetadata);
  const reader = createPostgresModelCatalogReader({ query: async () => ({ rows: [row] }) });
  const captured = (await reader.listPublishedModels())[0]?.openRouterMetadata as unknown as {
    pricing: typeof pricingData;
  };
  assert.deepEqual(await reader.resolveRoute('one'), {
    kind: 'managed',
    version: 'v1',
    candidates: row.candidates,
  });
  for (const v of [
    captured,
    captured.pricing,
    captured.pricing.overrides,
    ...captured.pricing.overrides,
    ...captured.pricing.overrides.map((v) => v.utc_days),
  ])
    assert.ok(Object.isFrozen(v));
  assert.ok(model.openRouterMetadata);
  const source = model.openRouterMetadata as unknown as { pricing: typeof pricingData };
  const first = source.pricing.overrides[0];
  assert.ok(first);
  first.utc_days.splice(0);
  source.pricing.discount = 9;
  assert.deepEqual(captured.pricing, pricingData);
  row.openrouter_metadata = {
    ...model.openRouterMetadata,
    pricing: { ...basePrices, overrides: [{ utc_start: Infinity }] },
  };
  for (const call of [() => reader.listPublishedModels(), () => reader.resolveRoute('one')])
    await assert.rejects(call, {
      name: 'ModelCatalogUnavailable',
      message: 'Model catalog unavailable',
    });
});
test('migrated pricing JSONB retains exact spellings/duplicates, no backfill and aggregate cap', async () => {
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
    const metadata = pricingModel().openRouterMetadata;
    await db.query('UPDATE catalog_models SET openrouter_metadata=$1::jsonb WHERE alias=$2', [
      JSON.stringify(metadata),
      'one',
    ]);
    assert.deepEqual((await reader.listPublishedModels())[0]?.openRouterMetadata, metadata);
    const huge = {
      ...metadata,
      pricing: {
        ...basePrices,
        overrides: Array.from({ length: 64 }, () => ({
          utc_days: Array.from({ length: 64 }, () => '😀'.repeat(128)),
        })),
      },
    };
    await assert.rejects(
      db.query('UPDATE catalog_models SET openrouter_metadata=$1::jsonb WHERE alias=$2', [
        JSON.stringify(huge),
        'one',
      ]),
    );
    assert.deepEqual((await reader.listPublishedModels())[0]?.openRouterMetadata, metadata);
  } finally {
    await db.close();
  }
});
