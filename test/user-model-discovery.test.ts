import assert from 'node:assert/strict';
import test from 'node:test';
import { projectGatewayAuditEvent } from '../src/audit/postgres-gateway-audit.ts';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { countCatalog } from './model-count-fixture.ts';
import {
  discoveryFixture,
  discoveryModel,
  discoveryPrivacy,
} from './model-discovery-filters-fixture.ts';

function request(query = '', path = '/api/v1/models/user') {
  const r = new Request(`http://untrusted.example${path}${query}`, {
    headers: { authorization: 'Bearer fixture' },
  });
  Object.defineProperty(r, 'body', { get: () => assert.fail('user list read body') });
  return r;
}
async function listed(f: ReturnType<typeof discoveryFixture>, query = '', status = 200) {
  const response = await f.handler(request(query));
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-request-id'), 'request');
  discoveryPrivacy(f);
  return response;
}
interface Page {
  data: { id: string; name?: string }[];
  total_count: number;
  links: { next: string | null };
}
for (const kind of ['managed', 'delegated'] as const)
  for (const [query, expected] of [
    ['', ['small', 'multi', 'unknown', 'large']],
    ['?output_modalities=all', ['small', 'multi', 'unknown', 'large', 'image', 'basic']],
    ['?output_modalities=image', ['multi', 'large', 'image']],
    ['?output_modalities=text,image', ['small', 'multi', 'unknown', 'large', 'image']],
    ['?output_modalities=audio', []],
  ] as const)
    test(`${kind} user list ${query || 'default'} returns only authorized aliases with private audit`, async () => {
      const f = discoveryFixture(countCatalog(kind));
      const body = (await (await listed(f, query)).json()) as Page;
      assert.deepEqual(
        body.data.map((m) => m.id),
        expected,
      );
      assert.equal(body.total_count, expected.length);
      assert.deepEqual(body.links, { next: null });
      assert.deepEqual(f.events.at(-1), {
        kind: 'models-listed',
        requestId: 'request',
        principalId: 'user',
        credentialId: 'credential',
        policyVersions: [],
        count: expected.length,
      });
      assert.deepEqual(projectGatewayAuditEvent(f.events.at(-1), 1000).details, {
        count: expected.length,
      });
      const regular = (await (await f.handler(f.request())).json()) as Page;
      assert.equal(regular.total_count, 6);
    });
test('user continuations preserve only validated filters/sort and the fixed relative route', async () => {
  const f = discoveryFixture(countCatalog());
  const first = (await (
    await listed(f, '?limit=2&sort=context-high-to-low&output_modalities=text')
  ).json()) as Page;
  assert.deepEqual(
    first.data.map((m) => m.id),
    ['large', 'multi'],
  );
  assert.equal(first.total_count, 4);
  assert.ok(first.links.next);
  assert.match(first.links.next, /^\/api\/v1\/models\/user\?/u);
  const next = new URL(first.links.next, 'http://untrusted.example');
  assert.equal(next.searchParams.get('offset'), '2');
  assert.equal(next.searchParams.get('output_modalities'), 'text');
  assert.equal(next.searchParams.get('sort'), 'context-high-to-low');
  const response = await f.handler(request(next.search, next.pathname));
  assert.equal(response.status, 200);
  assert.deepEqual(
    ((await response.json()) as Page).data.map((m) => m.id),
    ['small', 'unknown'],
  );
  const defaultPage = (await (await listed(f, '?limit=1')).json()) as Page;
  assert.ok(defaultPage.links.next);
  assert.equal(new URL(defaultPage.links.next, next).searchParams.get('output_modalities'), 'text');
});
test('each user page reloads current model/provider IAM and catalog without duplicate aliases', async () => {
  for (const resource of ['model:small', 'provider:provider', '*']) {
    const f = discoveryFixture(countCatalog());
    const route = f.models[0]?.routes[0];
    assert.ok(route);
    Object.assign(route, {
      candidates: [...route.candidates, { ...route.candidates[0], id: 'second' }],
    });
    const first = (await (await listed(f, '?limit=1')).json()) as Page;
    assert.equal(first.total_count, 4);
    f.statements.push({ effect: 'Deny', actions: ['*'], resources: [resource] });
    assert.ok(first.links.next);
    const response = await f.handler(request('', first.links.next));
    assert.equal(response.status, 200);
    const next = (await response.json()) as Page;
    assert.equal(next.total_count, resource === 'model:small' ? 3 : 0);
    assert.equal(f.reads(), 2);
    discoveryPrivacy(f);
  }
  const implicit = discoveryFixture(countCatalog(), { statements: [] });
  assert.equal(((await (await listed(implicit)).json()) as Page).total_count, 0);
  const f = discoveryFixture(countCatalog());
  await listed(f);
  Object.assign(f.models[0] ?? {}, { enabled: false });
  assert.equal(((await (await listed(f)).json()) as Page).total_count, 3);
});
test('user query validation follows auth and rejects unsupported, malformed and duplicate controls', async () => {
  for (const query of [
    '?q=private',
    '?context=1',
    '?principal_id=other',
    '?provider=private',
    '?sort=most-popular',
    '?sort=throughput-high-to-low',
    '?sort=unknown',
    '?sort=newest&sort=newest',
    '?offset=-1',
    '?offset=0.5',
    '?offset=null',
    '?limit=0',
    '?limit=1001',
    '?limit=1&limit=2',
    '?output_modalities=',
    '?output_modalities=all,text',
    '?output_modalities=text,text',
    '?output_modalities=private',
    '?output_modalities=text&output_modalities=image',
  ]) {
    const f = discoveryFixture();
    const response = await listed(f, query, 400);
    assert.equal(f.reads(), 0);
    assert.doesNotMatch(await response.text(), /private|other|principal_id/u);
  }
  const denied = discoveryFixture(countCatalog(), { authenticated: false });
  await listed(denied, '?principal_id=other', 401);
  assert.equal(denied.reads(), 0);
  const audit = discoveryFixture(countCatalog(), { auditFailure: true });
  await listed(audit, '?limit=0', 503);
  assert.equal(audit.reads(), 0);
});
test('whole hidden catalog and required audit faults suppress user lists privately', async () => {
  const hidden = countCatalog();
  Object.assign(hidden.at(-1)?.openRouterMetadata?.pricing ?? {}, { prompt: 'private-invalid' });
  for (const f of [
    discoveryFixture(hidden),
    discoveryFixture(countCatalog(), { catalogFailure: true }),
    discoveryFixture(countCatalog(), { auditFailure: true }),
  ]) {
    const response = await listed(f, '?limit=1', 503);
    assert.doesNotMatch(await response.text(), /private|pricing|provider/u);
  }
});
test('user result and continuation remain captured before audit mutation', async () => {
  const models = countCatalog();
  const f = discoveryFixture(models, {
    audit: () => {
      Object.assign(models[0] ?? {}, { alias: 'changed' });
      Object.assign(models[0]?.openRouterMetadata ?? {}, { name: 'changed name' });
      models.push(discoveryModel('extra'));
    },
  });
  const body = (await (await listed(f, '?limit=1')).json()) as Page;
  assert.equal(body.data[0]?.id, 'small');
  assert.equal(body.data[0]?.name, 'private published name');
  assert.equal(body.total_count, 4);
  assert.ok(body.links.next?.startsWith('/api/v1/models/user?'));
});
test('user collection precedence preserves legacy alias reads and compatible count semantics', async () => {
  const f = discoveryFixture([discoveryModel('user'), discoveryModel('count')]);
  const body = (await (await listed(f)).json()) as Page;
  assert.deepEqual(
    body.data.map((m) => m.id),
    ['user', 'count'],
  );
  const alias = await f.handler(request('', '/v1/models/user'));
  assert.equal(alias.status, 200);
  assert.equal(((await alias.json()) as { id: string }).id, 'user');
  const reads = f.reads();
  const encoded = await f.handler(request('', '/api/v1/models/u%73er'));
  assert.equal(encoded.status, 400);
  assert.equal(f.reads(), reads);
  const count = await f.handler(request('', '/api/v1/models/count'));
  assert.deepEqual(await count.json(), { data: { count: 2 } });
});
test('inactive/failed auth and required anonymous audit remain no-store before protected ports', async () => {
  for (const failure of ['inactive', 'unavailable', 'audit'] as const) {
    const unused = async () => assert.fail('auth reached a protected port');
    const events: unknown[] = [];
    const handler = createChatHandler({
      newRequestId: () => 'request',
      authenticate: async () => {
        if (failure !== 'inactive') throw Error('private-auth');
        return {
          id: 'user',
          active: false,
          credentialId: 'credential',
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
    const response = await handler(request('?q=private'));
    assert.equal(response.status, failure === 'inactive' ? 401 : 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await response.text(), /private/u);
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
  const f = discoveryFixture();
  for (const method of ['POST', 'HEAD', 'DELETE']) {
    const response = await f.handler(
      new Request('http://fixture.example/api/v1/models/user', { method }),
    );
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(f.reads(), 0);
});
