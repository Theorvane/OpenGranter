import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresModelCatalogReader } from '../src/gateway/postgres-model-catalog.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import {
  benchmarkData,
  benchmarkModel,
  benchmarkPrivacy,
  benchmarkRow,
} from './model-benchmark-metadata-fixture.ts';
import { discoveryFixture, discoveryModel } from './model-discovery-filters-fixture.ts';

type List = {
  data: Array<Record<string, unknown>>;
  total_count: number;
  links: { next: string | null };
};
const valid = [
  { benchmarks: benchmarkData },
  { benchmarks: { design_arena: [] } },
  {
    benchmarks: {
      design_arena: [{ arena: '', category: ' \n\t ', elo: 0, win_rate: -0.5, rank: 0 }],
      artificial_analysis: { intelligence_index: null, coding_index: null, agentic_index: null },
    },
  },
  {
    benchmarks: {
      design_arena: [],
      artificial_analysis: {
        intelligence_index: Number.MAX_VALUE,
        coding_index: -Number.MAX_VALUE,
        agentic_index: Number.MIN_VALUE,
      },
    },
  },
  {
    benchmarks: {
      design_arena: [
        { ...benchmarkRow, rank: Number.MAX_SAFE_INTEGER },
        { ...benchmarkRow, rank: Number.MIN_SAFE_INTEGER },
      ],
    },
  },
  {},
];
for (const [index, extra] of valid.entries())
  test(`public benchmark values preserve exact/null/omission/duplicate/order case${index}`, async () => {
    const f = discoveryFixture([benchmarkModel(extra)]);
    const r = await f.handler(f.request());
    assert.equal(r.status, 200);
    const row = ((await r.json()) as List).data[0];
    assert.ok(row);
    assert.equal(row.id, 'one');
    assert.equal(Object.hasOwn(row, 'benchmarks'), Object.hasOwn(extra, 'benchmarks'));
    if (Object.hasOwn(extra, 'benchmarks'))
      assert.deepEqual(row.benchmarks, (extra as Record<string, unknown>).benchmarks);
    benchmarkPrivacy(f);
  });
for (const text of ['x'.repeat(256), '😀'.repeat(128)])
  test(`benchmark label UTF-16 boundary ${text.charCodeAt(0)}`, async () => {
    const extra = {
      benchmarks: { design_arena: [{ ...benchmarkRow, arena: text, category: text }] },
    };
    const f = discoveryFixture([benchmarkModel(extra)]);
    const r = await f.handler(f.request());
    assert.equal(r.status, 200);
    assert.deepEqual(((await r.json()) as List).data[0]?.benchmarks, extra.benchmarks);
    benchmarkPrivacy(f);
  });
test('benchmark arrays retain 64 duplicate rows in supplied order', async () => {
  const extra = {
    benchmarks: {
      design_arena: Array.from({ length: 64 }, (_, index) => ({
        ...benchmarkRow,
        rank: index % 3,
      })),
    },
  };
  const f = discoveryFixture([benchmarkModel(extra)]);
  const r = await f.handler(f.request());
  assert.equal(r.status, 200);
  assert.deepEqual(((await r.json()) as List).data[0]?.benchmarks, extra.benchmarks);
  benchmarkPrivacy(f);
});
const invalid: unknown[] = [
  undefined,
  null,
  1,
  '',
  [],
  {},
  { design_arena: undefined },
  { design_arena: null },
  { design_arena: {} },
  { design_arena: [null] },
  { design_arena: [undefined] },
  { design_arena: new Array(1) },
  { design_arena: Array.from({ length: 65 }, () => benchmarkRow) },
  { design_arena: [], unknown: true },
  ...[undefined, null, 1, [], {}, { intelligence_index: null, coding_index: null }].map(
    (artificial_analysis) => ({ design_arena: [], artificial_analysis }),
  ),
  ...['intelligence_index', 'coding_index', 'agentic_index'].flatMap((field) =>
    [undefined, NaN, Infinity, -Infinity, '1', false, {}].map((value) => ({
      design_arena: [],
      artificial_analysis: {
        intelligence_index: null,
        coding_index: null,
        agentic_index: null,
        [field]: value,
      },
    })),
  ),
  ...['elo', 'win_rate'].flatMap((field) =>
    [undefined, null, NaN, Infinity, -Infinity, '1', false].map((value) => ({
      design_arena: [{ ...benchmarkRow, [field]: value }],
    })),
  ),
  ...[
    undefined,
    null,
    1.25,
    Number.MAX_SAFE_INTEGER + 1,
    Number.MIN_SAFE_INTEGER - 1,
    NaN,
    Infinity,
    '1',
  ].map((rank) => ({ design_arena: [{ ...benchmarkRow, rank }] })),
  ...[
    {},
    { ...benchmarkRow, arena: undefined },
    { ...benchmarkRow, category: null },
    { ...benchmarkRow, arena: 1 },
    { ...benchmarkRow, category: 'x'.repeat(257) },
    { ...benchmarkRow, arena: `${'😀'.repeat(128)}x` },
    { ...benchmarkRow, unknown: 1 },
  ].map((row) => ({ design_arena: [row] })),
  {
    design_arena: [],
    artificial_analysis: {
      intelligence_index: null,
      coding_index: null,
      agentic_index: null,
      unknown: 1,
    },
  },
];
for (const [index, value] of invalid.entries())
  test(`malformed benchmark case${index} fails entire hidden catalog privately`, async () => {
    const bad = { ...benchmarkModel({ benchmarks: value }, 'private-denied'), enabled: false };
    const f = discoveryFixture([discoveryModel('visible'), bad]);
    const r = await f.handler(f.request('?limit=1'));
    assert.equal(r.status, 503);
    assert.doesNotMatch(await r.text(), /benchmark-private|benchmarks|visible/u);
    benchmarkPrivacy(f);
  });
for (const resource of ['model:one', 'provider:provider', '*'])
  test(`benchmark metadata preserves explicit Deny ${resource}`, async () => {
    const f = discoveryFixture([benchmarkModel()], {
      statements: [
        { effect: 'Allow', actions: ['*'], resources: ['*'] },
        { effect: 'Deny', actions: ['*'], resources: [resource] },
      ],
    });
    const r = await f.handler(f.request());
    assert.equal(r.status, 200);
    assert.deepEqual(((await r.json()) as List).data, []);
    benchmarkPrivacy(f);
  });
test('benchmark metadata preserves implicit Deny and authentication before catalog', async () => {
  const denied = discoveryFixture([benchmarkModel()], { statements: [] });
  const r = await denied.handler(denied.request());
  assert.equal(r.status, 200);
  assert.deepEqual(((await r.json()) as List).data, []);
  benchmarkPrivacy(denied);
  const f = discoveryFixture([benchmarkModel()], { authenticated: false });
  assert.equal((await f.handler(f.request())).status, 401);
  assert.equal(f.reads(), 0);
  benchmarkPrivacy(f);
});
for (const options of [{ catalogFailure: true }, { auditFailure: true }])
  test(`benchmark required failure stays private ${JSON.stringify(options)}`, async () => {
    const f = discoveryFixture([benchmarkModel()], options);
    const r = await f.handler(f.request());
    assert.equal(r.status, 503);
    assert.doesNotMatch(await r.text(), /benchmark-private|benchmarks/u);
    benchmarkPrivacy(f);
  });
test('benchmarks do not expand query predicates, reorder models or change legacy/basic rows', async () => {
  const f = discoveryFixture([benchmarkModel(), discoveryModel('basic', { basic: true })]);
  for (const query of [
    '?q=benchmark-private',
    '?supported_parameters=benchmarks',
    '?input_modalities=image',
  ]) {
    const r = await f.handler(f.request(query));
    assert.equal(r.status, 200);
    assert.deepEqual(((await r.json()) as List).data, []);
  }
  const r = await f.handler(f.request('?sort=newest'));
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
      (row) => Object.keys(row).length === 4 && !Object.hasOwn(row, 'benchmarks'),
    ),
  );
  benchmarkPrivacy(f);
});
test('benchmark nested objects and rows survive source mutation during required audit', async () => {
  const model = benchmarkModel();
  assert.ok(model.openRouterMetadata);
  const source = model.openRouterMetadata as unknown as { benchmarks: typeof benchmarkData };
  const f = discoveryFixture([model], {
    audit: () => {
      source.benchmarks.artificial_analysis.intelligence_index = 999;
      const first = source.benchmarks.design_arena[0];
      assert.ok(first);
      first.arena = 'changed';
      source.benchmarks.design_arena.splice(1);
    },
  });
  const r = await f.handler(f.request());
  assert.equal(r.status, 200);
  assert.deepEqual(((await r.json()) as List).data[0]?.benchmarks, benchmarkData);
  benchmarkPrivacy(f);
});
test('root/nested/row/array getters capture one bounded snapshot', async () => {
  const model = benchmarkModel({});
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
  const aa = Object.defineProperties(
    {},
    Object.fromEntries(
      Object.entries(benchmarkData.artificial_analysis).map(([key, value]) => [
        key,
        once(key, value),
      ]),
    ),
  );
  const row = Object.defineProperties(
    {},
    Object.fromEntries(Object.entries(benchmarkRow).map(([key, value]) => [key, once(key, value)])),
  );
  const rows: unknown[] = [];
  Object.defineProperty(rows, 0, once('item', row));
  const capturedRows = new Proxy(rows, {
    get: (target, key, receiver) => {
      if (key === 'length') reads.set('length', (reads.get('length') ?? 0) + 1);
      return Reflect.get(target, key, receiver);
    },
  });
  const benchmarks = Object.defineProperties(
    {},
    { artificial_analysis: once('aa', aa), design_arena: once('rows', capturedRows) },
  );
  Object.defineProperty(model.openRouterMetadata, 'benchmarks', once('root', benchmarks));
  const f = discoveryFixture([model]);
  const r = await f.handler(f.request());
  assert.equal(r.status, 200);
  assert.equal(reads.size, 13);
  assert.ok([...reads.values()].every((count) => count === 1));
  assert.deepEqual(((await r.json()) as List).data[0]?.benchmarks, {
    artificial_analysis: benchmarkData.artificial_analysis,
    design_arena: [benchmarkRow],
  });
  benchmarkPrivacy(f);
});
test('inherited optional benchmarks/AA are omitted and required inherited fields cannot satisfy shape', async () => {
  const model = benchmarkModel({});
  assert.ok(model.openRouterMetadata);
  Object.setPrototypeOf(
    model.openRouterMetadata,
    Object.defineProperty({}, 'benchmarks', {
      get: () => {
        throw Error('benchmark-private-inherited');
      },
    }),
  );
  const f = discoveryFixture([model]);
  const r = await f.handler(f.request());
  assert.equal(r.status, 200);
  assert.equal(Object.hasOwn(((await r.json()) as List).data[0] ?? {}, 'benchmarks'), false);
  benchmarkPrivacy(f);
  const valid = benchmarkModel({});
  assert.ok(valid.openRouterMetadata);
  const benchmarks = Object.setPrototypeOf(
    { design_arena: [] },
    Object.defineProperty({}, 'artificial_analysis', {
      get: () => {
        throw Error('benchmark-private-inherited');
      },
    }),
  );
  Object.assign(valid.openRouterMetadata, { benchmarks });
  const good = discoveryFixture([valid]);
  const ok = await good.handler(good.request());
  assert.equal(ok.status, 200);
  assert.deepEqual(((await ok.json()) as List).data[0]?.benchmarks, { design_arena: [] });
  benchmarkPrivacy(good);
  for (const value of [
    Object.create({ design_arena: [] }),
    { design_arena: [], artificial_analysis: Object.create(benchmarkData.artificial_analysis) },
    { design_arena: [Object.create(benchmarkRow)] },
  ]) {
    const bad = benchmarkModel({});
    assert.ok(bad.openRouterMetadata);
    Object.assign(bad.openRouterMetadata, { benchmarks: value });
    const broken = discoveryFixture([bad]);
    assert.equal((await broken.handler(broken.request())).status, 503);
    benchmarkPrivacy(broken);
  }
});
test('benchmark own array indices reject inherited hole fillers and never invoke supplied iterators', async () => {
  const model = benchmarkModel({});
  assert.ok(model.openRouterMetadata);
  const rows = [benchmarkRow];
  let iterations = 0;
  Object.defineProperty(rows, Symbol.iterator, {
    value: () => {
      iterations++;
      throw Error('benchmark-private-iterator');
    },
  });
  Object.assign(model.openRouterMetadata, { benchmarks: { design_arena: rows } });
  const f = discoveryFixture([model]);
  const r = await f.handler(f.request());
  assert.equal(r.status, 200);
  assert.equal(iterations, 0);
  assert.deepEqual(((await r.json()) as List).data[0]?.benchmarks, {
    design_arena: [benchmarkRow],
  });
  benchmarkPrivacy(f);
  const holes = new Array(1);
  Object.setPrototypeOf(holes, Object.assign(Object.create(Array.prototype), { 0: benchmarkRow }));
  Object.assign(model.openRouterMetadata, { benchmarks: { design_arena: holes } });
  const broken = await f.handler(f.request());
  assert.equal(broken.status, 503);
  benchmarkPrivacy(f);
});
for (const level of ['root', 'row', 'score'])
  test(`throwing benchmark ${level} getter fails privately`, async () => {
    const model = benchmarkModel({});
    assert.ok(model.openRouterMetadata);
    const fail = {
      enumerable: true,
      get: () => {
        throw Error('benchmark-private-getter');
      },
    };
    if (level === 'root') Object.defineProperty(model.openRouterMetadata, 'benchmarks', fail);
    else {
      const row = { ...benchmarkRow };
      const rows: unknown[] = [row];
      if (level === 'row') Object.defineProperty(rows, 0, fail);
      else Object.defineProperty(row, 'elo', fail);
      Object.assign(model.openRouterMetadata, { benchmarks: { design_arena: rows } });
    }
    const f = discoveryFixture([model]);
    const r = await f.handler(f.request());
    assert.equal(r.status, 503);
    assert.doesNotMatch(await r.text(), /benchmark-private-getter/u);
    benchmarkPrivacy(f);
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
test('PostgreSQL benchmark capture freezes nested rows and retains approved routes', async () => {
  const model = benchmarkModel();
  const row = storedRow(model.openRouterMetadata);
  const reader = createPostgresModelCatalogReader({ query: async () => ({ rows: [row] }) });
  const captured = (await reader.listPublishedModels())[0]?.openRouterMetadata as unknown as {
    benchmarks: typeof benchmarkData;
  };
  assert.deepEqual(await reader.resolveRoute('one'), {
    kind: 'managed',
    version: 'v1',
    candidates: row.candidates,
  });
  for (const value of [
    captured,
    captured.benchmarks,
    captured.benchmarks.artificial_analysis,
    captured.benchmarks.design_arena,
    ...captured.benchmarks.design_arena,
  ])
    assert.ok(Object.isFrozen(value));
  assert.ok(model.openRouterMetadata);
  const source = model.openRouterMetadata as unknown as { benchmarks: typeof benchmarkData };
  const first = source.benchmarks.design_arena[0];
  assert.ok(first);
  first.rank = 9;
  assert.deepEqual(captured.benchmarks, benchmarkData);
  row.openrouter_metadata = {
    ...model.openRouterMetadata,
    benchmarks: { design_arena: [{ ...benchmarkRow, elo: Infinity }] },
  };
  for (const call of [() => reader.listPublishedModels(), () => reader.resolveRoute('one')])
    await assert.rejects(call, {
      name: 'ModelCatalogUnavailable',
      message: 'Model catalog unavailable',
    });
});
test('migrated benchmark JSONB keeps nullable scores/duplicates, no backfill and cap', async () => {
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
    const metadata = benchmarkModel().openRouterMetadata;
    await db.query('UPDATE catalog_models SET openrouter_metadata=$1::jsonb WHERE alias=$2', [
      JSON.stringify(metadata),
      'one',
    ]);
    assert.deepEqual((await reader.listPublishedModels())[0]?.openRouterMetadata, metadata);
    const huge = {
      ...metadata,
      benchmarks: {
        design_arena: Array.from({ length: 64 }, () => ({
          ...benchmarkRow,
          arena: '😀'.repeat(128),
          category: '😀'.repeat(128),
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
