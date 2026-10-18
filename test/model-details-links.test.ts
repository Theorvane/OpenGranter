import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresModelCatalogReader } from '../src/gateway/postgres-model-catalog.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { detailsModel, detailsPrivacy, relativeDetails } from './model-details-links-fixture.ts';
import { discoveryFixture, discoveryModel } from './model-discovery-filters-fixture.ts';

type Page = { data: { id: string; links?: { details: string } }[]; total_count: number };
for (const [index, details] of [
  relativeDetails,
  '/',
  '/api/v1/models/name%2Fv1/endpoints?q=x%20y#section',
  '/catalog/../model-link-private',
  `/${'x'.repeat(2047)}`,
  'https://catalog.example/model-link-private?q=x#fragment',
].entries())
  test(`model details link case${index} retains exact text on both route kinds`, async () => {
    for (const kind of ['managed', 'delegated'] as const) {
      const f = discoveryFixture([detailsModel(details, 'one', kind)]);
      const response = await f.handler(f.request());
      assert.equal(response.status, 200);
      const row = ((await response.json()) as Page).data[0];
      assert.equal(row?.links?.details, details);
      detailsPrivacy(f);
    }
  });
for (const [index, details] of [
  '//model-link-private.example/path',
  '///model-link-private.example',
  '/\\model-link-private.example',
  '/path\\model-link-private',
  '/\tmodel-link-private',
  '/path\n//model-link-private',
  '/path\r',
  '/ model-link-private',
  '/\u0000path',
  '/\u007fpath',
  '/\u0085path',
  ' model-link-private',
  'model-link-private/path',
  '../model-link-private',
  '?model-link-private',
  '#model-link-private',
  'http://model-link-private.example',
  'javascript:model-link-private',
  'https://model-link-private@catalog.example/path',
  `/${'x'.repeat(2048)}`,
  '',
  null,
  undefined,
  1,
].entries())
  test(`invalid details case${index} fails even when disabled and outside the requested page`, async () => {
    const hidden = detailsModel(details, 'private-denied');
    Object.assign(hidden.openRouterMetadata?.links ?? {}, { details });
    Object.assign(hidden, { enabled: false });
    const f = discoveryFixture([discoveryModel('visible'), hidden]);
    const response = await f.handler(f.request('?limit=1'));
    assert.equal(response.status, 503);
    assert.doesNotMatch(
      await response.text(),
      /model-link-private|catalog\.example|details|visible/u,
    );
    detailsPrivacy(f);
  });
test('links retain model/provider Deny, implicit Deny and authentication before reads', async () => {
  for (const resource of ['model:one', 'provider:provider', '*']) {
    const f = discoveryFixture([detailsModel()], {
      statements: [
        { effect: 'Allow', actions: ['*'], resources: ['*'] },
        { effect: 'Deny', actions: ['*'], resources: [resource] },
      ],
    });
    const response = await f.handler(f.request());
    assert.equal(response.status, 200);
    assert.deepEqual(((await response.json()) as Page).data, []);
    detailsPrivacy(f);
  }
  const implicit = discoveryFixture([detailsModel()], { statements: [] });
  assert.equal(
    ((await (await implicit.handler(implicit.request())).json()) as Page).total_count,
    0,
  );
  const unauthenticated = discoveryFixture([detailsModel('//bad')], { authenticated: false });
  assert.equal((await unauthenticated.handler(unauthenticated.request())).status, 401);
  assert.equal(unauthenticated.reads(), 0);
});
test('required catalog/audit faults withhold links and legacy/basic rows remain unchanged', async () => {
  for (const options of [{ catalogFailure: true }, { auditFailure: true }]) {
    const f = discoveryFixture([detailsModel()], options);
    const response = await f.handler(f.request());
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /model-link-private|details/u);
    detailsPrivacy(f);
  }
  const f = discoveryFixture([detailsModel(), discoveryModel('basic', { basic: true })]);
  const legacy = await f.handler(f.request('', '/v1'));
  const rows = ((await legacy.json()) as Page).data;
  assert.ok(rows.every((row) => !Object.hasOwn(row, 'links')));
  const compatible = await f.handler(f.request());
  assert.equal(((await compatible.json()) as Page).data[1]?.links, undefined);
  detailsPrivacy(f);
});
test('details getters are captured once before audit and request host is not a resolution base', async () => {
  const model = detailsModel();
  assert.ok(model.openRouterMetadata);
  let reads = 0;
  const links = model.openRouterMetadata.links;
  Object.defineProperty(links, 'details', {
    enumerable: true,
    configurable: true,
    get: () => (++reads === 1 ? relativeDetails : '//model-link-private.example'),
  });
  const f = discoveryFixture([model], {
    audit: () =>
      Object.assign(model.openRouterMetadata ?? {}, { links: { details: '//changed.example' } }),
  });
  const request = new Request('https://caller-controlled.example/api/v1/models', {
    headers: {
      authorization: 'Bearer fixture',
      host: 'model-link-private.example',
      forwarded: 'host=model-link-private.example',
      'x-forwarded-host': 'model-link-private.example',
    },
  });
  const response = await f.handler(request);
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as Page).data[0]?.links?.details, relativeDetails);
  assert.equal(reads, 1);
  detailsPrivacy(f);
});
function storedRow() {
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
    openrouter_metadata: detailsModel().openRouterMetadata,
  };
}
test('PostgreSQL list/route boundaries capture relative links and reject corrupt links safely', async () => {
  const row = storedRow();
  const reader = createPostgresModelCatalogReader({ query: async () => ({ rows: [row] }) });
  const models = await reader.listPublishedModels();
  assert.deepEqual(await reader.resolveRoute('one'), {
    kind: 'managed',
    version: 'v1',
    candidates: row.candidates,
  });
  assert.ok(Object.isFrozen(models[0]?.openRouterMetadata?.links));
  Object.assign(row.openrouter_metadata?.links ?? {}, { details: '//model-link-private.example' });
  assert.equal(models[0]?.openRouterMetadata?.links.details, relativeDetails);
  for (const call of [() => reader.listPublishedModels(), () => reader.resolveRoute('one')])
    await assert.rejects(call, {
      name: 'ModelCatalogUnavailable',
      message: 'Model catalog unavailable',
    });
});
test('migrated JSONB retains exact relative details and malformed stored links remain unreadable', async () => {
  const db = new PGlite();
  try {
    for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
    await db.exec(
      "INSERT INTO catalog_models (alias,created_at_seconds,enabled) VALUES ('one',42,false)",
    );
    const reader = createPostgresModelCatalogReader({
      query: (sql, params) => db.query(sql, [...params]),
    });
    const metadata = detailsModel().openRouterMetadata;
    await db.query('UPDATE catalog_models SET openrouter_metadata=$1::jsonb WHERE alias=$2', [
      JSON.stringify(metadata),
      'one',
    ]);
    assert.deepEqual((await reader.listPublishedModels())[0]?.openRouterMetadata, metadata);
    await db.query('UPDATE catalog_models SET openrouter_metadata=$1::jsonb WHERE alias=$2', [
      JSON.stringify({ ...metadata, links: { details: '//model-link-private.example' } }),
      'one',
    ]);
    await assert.rejects(reader.listPublishedModels(), {
      name: 'ModelCatalogUnavailable',
      message: 'Model catalog unavailable',
    });
  } finally {
    await db.close();
  }
});
