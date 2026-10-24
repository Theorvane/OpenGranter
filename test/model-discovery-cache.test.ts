import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { countCatalog } from './model-count-fixture.ts';
import { discoveryFixture, discoveryPrivacy } from './model-discovery-filters-fixture.ts';

const paths = [
  '/v1/models',
  '/api/v1/models',
  '/api/v1/models/count',
  '/api/v1/model/fixture/chat',
];
function request(path: string, method = 'GET', authenticated = true) {
  return new Request(`http://fixture.example${path}`, {
    method,
    headers: {
      ...(authenticated ? { authorization: 'Bearer fixture' } : {}),
      'if-none-match': '"old-catalog"',
      'if-modified-since': 'Wed, 01 Jan 2025 00:00:00 GMT',
    },
  });
}
function noStore(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-request-id'), 'request');
  assert.equal(response.headers.get('etag'), null);
}
for (const kind of ['managed', 'delegated'] as const)
  for (const base of ['/v1', '/api/v1'])
    test(`${kind} ${base} listing never stores successful, paged or freshly denied discovery`, async () => {
      const f = discoveryFixture(countCatalog(kind));
      noStore(await f.handler(f.request('', base)), 200);
      if (base === '/api/v1') {
        const page = await f.handler(f.request('?limit=1&output_modalities=text', base));
        noStore(page, 200);
        const body = (await page.json()) as { data: { id: string }[]; links: { next: string } };
        assert.equal(body.data.length, 1);
        f.statements.push({ effect: 'Deny', actions: ['*'], resources: ['provider:provider'] });
        const next = await f.handler(request(body.links.next));
        noStore(next, 200);
        const empty: unknown = await next.json();
        assert.deepEqual(empty, {
          object: 'list',
          data: [],
          total_count: 0,
          links: { next: null },
        });
      } else {
        f.statements.splice(0);
        const denied = await f.handler(request('/v1/models'));
        noStore(denied, 200);
        assert.deepEqual(await denied.json(), { object: 'list', data: [] });
      }
      assert.equal(f.reads(), base === '/api/v1' ? 3 : 2);
      discoveryPrivacy(f);
    });
for (const path of paths) {
  test(`${path} no-store covers auth, invalid query, catalog and required-audit failure`, async () => {
    for (const options of [
      { authenticated: false },
      { catalogFailure: true },
      { auditFailure: true },
    ]) {
      const f = discoveryFixture(countCatalog(), options);
      const response = await f.handler(request(path));
      noStore(response, options.authenticated === false ? 401 : 503);
      assert.doesNotMatch(await response.text(), /private|fixture|Bearer/u);
      assert.equal(f.reads(), options.authenticated === false ? 0 : 1);
      discoveryPrivacy(f);
    }
    for (const auditFailure of [false, true]) {
      const f = discoveryFixture(countCatalog(), { auditFailure });
      const response = await f.handler(request(`${path}?unsupported=private-query`));
      noStore(response, auditFailure ? 503 : 400);
      assert.equal(f.reads(), 0);
      assert.doesNotMatch(await response.text(), /private|fixture/u);
    }
    const missing = discoveryFixture();
    noStore(await missing.handler(request(path, 'GET', false)), 401);
    assert.equal(missing.reads(), 0);
  });
  test(`${path} unsupported methods still prohibit storage`, async () => {
    const f = discoveryFixture();
    for (const method of ['HEAD', 'POST', 'OPTIONS']) {
      noStore(await f.handler(request(path, method)), 404);
    }
    assert.equal(f.reads(), 0);
    assert.deepEqual(f.events, []);
  });
  test(`${path} unavailable/inactive authentication and audit failures stay no-store`, async () => {
    for (const failure of ['inactive', 'unavailable', 'audit'] as const) {
      const unused = async () => assert.fail('authentication reached a protected port');
      const events: unknown[] = [];
      const handler = createChatHandler({
        newRequestId: () => 'request',
        authenticate: async () => {
          if (failure !== 'inactive') throw Error('private-auth');
          return {
            id: 'user',
            credentialId: 'credential',
            active: false,
            policyVersions: [],
            statements: [],
          };
        },
        listPublishedModels: unused,
        resolveRoute: unused,
        resolveSecret: unused,
        checkLimit: unused,
        invokeDirect: unused,
        invokeOpenRouter: unused,
        writeUsage: unused,
        writeAudit: async (event) => {
          if (failure === 'audit') throw Error('private-audit');
          events.push(event);
        },
      });
      const response = await handler(request(path));
      noStore(response, failure === 'inactive' ? 401 : 503);
      assert.doesNotMatch(await response.text(), /private|fixture/u);
      assert.deepEqual(
        events,
        failure === 'audit'
          ? []
          : [
              {
                kind: failure === 'inactive' ? 'auth-denied' : 'auth-unavailable',
                requestId: 'request',
              },
            ],
      );
    }
  });
}
test('malformed hidden catalogs fail closed without emitting cacheable discovery', async () => {
  for (const path of paths) {
    const f = discoveryFixture();
    Object.assign(f.models.at(-1) ?? {}, { created: -1 });
    const response = await f.handler(request(path));
    noStore(response, 503);
    assert.equal(f.reads(), 1);
    assert.equal(
      (f.events.at(-1) as { kind: string }).kind,
      path.includes('/model/') ? 'model-read-unavailable' : 'model-list-unavailable',
    );
    assert.doesNotMatch(await response.text(), /private|fixture/u);
  }
});
test('neighbors are not discovery and retain existing error caching behavior', async () => {
  const f = discoveryFixture();
  for (const path of [
    '/api/v1/models-extra',
    '/api/v1/model',
    '/v1/models/count/extra',
    '/api/v1/models/count/',
  ]) {
    const response = await f.handler(request(path));
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), null);
  }
  assert.deepEqual(f.events, []);
});
