import assert from 'node:assert/strict';
import test from 'node:test';
import { countCatalog, countRequest } from './model-count-fixture.ts';
import { discoveryFixture, discoveryPrivacy } from './model-discovery-filters-fixture.ts';

async function counted(f: ReturnType<typeof discoveryFixture>, query = '') {
  const response = await f.handler(countRequest(f, query));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-request-id'), 'request');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  discoveryPrivacy(f);
  const body: unknown = await response.json();
  assert.deepEqual(Object.keys(body as object), ['data']);
  return body;
}
for (const kind of ['managed', 'delegated'] as const)
  for (const [query, count] of [
    ['', 4],
    ['?output_modalities=text', 4],
    ['?output_modalities=image', 3],
    ['?output_modalities=text,image', 5],
    ['?output_modalities=all', 6],
    ['?output_modalities=audio', 0],
  ] as const)
    test(`${kind} model count ${query || 'default'} includes only authorized matching aliases`, async () => {
      const f = discoveryFixture(countCatalog(kind));
      assert.deepEqual(await counted(f, query), { data: { count } });
      assert.deepEqual(f.events.at(-1), {
        kind: 'models-counted',
        requestId: 'request',
        count,
        principalId: 'user',
        credentialId: 'credential',
        policyVersions: [],
      });
    });
test('count aliases once despite multiple approved candidates and preserve existing list defaults', async () => {
  const models = countCatalog();
  const route = models[0]?.routes[0];
  assert.ok(route);
  Object.assign(route, {
    candidates: [...route.candidates, { ...route.candidates[0], id: 'second' }],
  });
  const f = discoveryFixture(models);
  assert.deepEqual(await counted(f), { data: { count: 4 } });
  const list = await f.handler(f.request());
  assert.equal(((await list.json()) as { total_count: number }).total_count, 6);
});
test('count reevaluates model/provider/implicit Deny and current catalog on each request', async () => {
  for (const resource of ['model:small', 'provider:provider', '*']) {
    const f = discoveryFixture(countCatalog());
    assert.deepEqual(await counted(f), { data: { count: 4 } });
    f.statements.push({ effect: 'Deny', actions: ['*'], resources: [resource] });
    assert.deepEqual(await counted(f), { data: { count: resource === 'model:small' ? 3 : 0 } });
    assert.equal(f.reads(), 2);
  }
  const implicit = discoveryFixture(countCatalog(), { statements: [] });
  assert.deepEqual(await counted(implicit, '?output_modalities=all'), { data: { count: 0 } });
  const models = countCatalog();
  const f = discoveryFixture(models);
  assert.deepEqual(await counted(f), { data: { count: 4 } });
  Object.assign(models[0] ?? {}, { enabled: false });
  assert.deepEqual(await counted(f), { data: { count: 3 } });
});
test('count query rejects unsupported, malformed and duplicate fields before catalog access after auth', async () => {
  for (const query of [
    '?limit=1',
    '?offset=0',
    '?q=private',
    '?min_coding_index=0',
    '?sort=newest',
    '?output_modalities=',
    '?output_modalities=all,text',
    '?output_modalities=text,text',
    '?output_modalities=Text',
    '?output_modalities=%20text',
    '?output_modalities=text&output_modalities=text',
    '?output_modalities=private',
    '?unknown=1',
  ] as const) {
    const f = discoveryFixture(countCatalog());
    const response = await f.handler(countRequest(f, query));
    assert.equal(response.status, 400, query);
    assert.equal(f.reads(), 0);
    discoveryPrivacy(f);
  }
  const denied = discoveryFixture(countCatalog(), { authenticated: false });
  const request = countRequest(denied, '?output_modalities=bad');
  Object.defineProperty(request, 'body', { get: () => assert.fail('count read request body') });
  assert.equal((await denied.handler(request)).status, 401);
  assert.equal(denied.reads(), 0);
});
test('unsupported count paths and methods remain unavailable without catalog reads', async () => {
  const f = discoveryFixture(countCatalog());
  for (const [method, path] of [
    ['GET', '/v1/models/count/extra'],
    ['POST', '/api/v1/models/count'],
    ['HEAD', '/api/v1/models/count'],
    ['GET', '/api/v1/models/count/'],
  ] as const) {
    const response = await f.handler(
      new Request(`http://gateway.example${path}`, {
        method,
        headers: { authorization: 'Bearer fixture' },
      }),
    );
    assert.equal(response.status, 404);
  }
  assert.equal(f.reads(), 0);
});
test('hidden malformed metadata and required catalog/audit failures suppress counts privately', async () => {
  const models = countCatalog();
  const hidden = models.at(-1);
  assert.ok(hidden?.openRouterMetadata);
  Object.assign(hidden.openRouterMetadata.pricing, { prompt: 'private-invalid' });
  for (const f of [
    discoveryFixture(models),
    discoveryFixture(countCatalog(), { catalogFailure: true }),
    discoveryFixture(countCatalog(), { auditFailure: true }),
  ]) {
    const response = await f.handler(countRequest(f));
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private-invalid|private-provider|"count"/u);
    discoveryPrivacy(f);
  }
});
test('required audit mutation cannot rewrite the captured count', async () => {
  const models = countCatalog();
  const f = discoveryFixture(models, {
    audit: () => {
      for (const model of models) Object.assign(model, { enabled: false });
    },
  });
  assert.deepEqual(await counted(f), { data: { count: 4 } });
  assert.deepEqual(await counted(f), { data: { count: 0 } });
});
