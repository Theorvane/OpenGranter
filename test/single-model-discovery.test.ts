import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import {
  discoveryFixture,
  discoveryModel,
  discoveryPrivacy,
} from './model-discovery-filters-fixture.ts';
import { singleModelCatalog, singleModelRequest } from './single-model-discovery-fixture.ts';

async function lookup(
  f: ReturnType<typeof discoveryFixture>,
  alias = 'fixture/chat',
  status = 200,
) {
  const request = singleModelRequest(alias);
  Object.defineProperty(request, 'body', { get: () => assert.fail('lookup read request body') });
  const response = await f.handler(request);
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-request-id'), 'request');
  discoveryPrivacy(f);
  assert.doesNotMatch(
    JSON.stringify(f.events),
    /fixture\/|模型|endpoints|canonical_slug|alias_target|unpublished-target/u,
  );
  return response;
}
for (const kind of ['managed', 'delegated'] as const)
  test(`${kind} exact model reads preserve captured rich discovery fields and require private audit`, async () => {
    const f = discoveryFixture(singleModelCatalog(kind));
    const list = await f.handler(f.request());
    const row = ((await list.json()) as { data: { id: string }[] }).data.find(
      (row) => row.id === 'fixture/chat',
    );
    const response = await lookup(f);
    const body: unknown = await response.json();
    assert.deepEqual(body, { data: row });
    assert.deepEqual(f.events.at(-1), {
      kind: 'model-read',
      requestId: 'request',
      principalId: 'user',
      credentialId: 'credential',
      policyVersions: [],
      count: 1,
    });
    assert.equal(f.reads(), 2);
  });
test('explicit variants and safe Unicode decode once without canonical or alias-target resolution', async () => {
  const f = discoveryFixture(singleModelCatalog());
  for (const [encoded, id] of [
    ['fixture/chat%3Afree', 'fixture/chat:free'],
    ['fixture/%E6%A8%A1%E5%9E%8B', 'fixture/模型'],
  ]) {
    const response = await lookup(f, encoded);
    assert.equal(((await response.json()) as { data: { id: string } }).data.id, id);
  }
  for (const alias of [
    'private/canonical',
    'fixture/unpublished-target',
    'fixture/chat:unpublished',
  ])
    await lookup(f, alias, 404);
});
test('decoded segment limits are inclusive and author Unicode is an exact published identifier', async () => {
  const alias = `${'a'.repeat(128)}/${'b'.repeat(256)}`;
  const models = [...singleModelCatalog(), discoveryModel(alias), discoveryModel('조직/모델')];
  const f = discoveryFixture(models);
  await lookup(f, alias);
  const encoded = `${encodeURIComponent('조직')}/${encodeURIComponent('모델')}`;
  const response = await lookup(f, encoded);
  assert.equal(((await response.json()) as { data: { id: string } }).data.id, '조직/모델');
});
test('unknown, disabled, model/provider denied and implicit Deny reads are indistinguishable', async () => {
  const bodies: unknown[] = [];
  for (const alias of ['fixture/missing', 'fixture/disabled', 'fixture/private-provider']) {
    const f = discoveryFixture(singleModelCatalog());
    bodies.push(await (await lookup(f, alias, 404)).json());
    assert.deepEqual(f.events.at(-1), {
      kind: 'model-read',
      requestId: 'request',
      principalId: 'user',
      credentialId: 'credential',
      policyVersions: [],
      count: 0,
    });
  }
  for (const resource of ['model:fixture/chat', 'provider:provider']) {
    const f = discoveryFixture(singleModelCatalog());
    f.statements.push({ effect: 'Deny', actions: ['*'], resources: [resource] });
    bodies.push(await (await lookup(f, 'fixture/chat', 404)).json());
  }
  const implicit = discoveryFixture(singleModelCatalog(), { statements: [] });
  bodies.push(await (await lookup(implicit, 'fixture/chat', 404)).json());
  bodies.push(await (await lookup(implicit, 'fixture/basic', 404)).json());
  for (const body of bodies) assert.deepEqual(body, bodies[0]);
  assert.doesNotMatch(JSON.stringify(bodies), /fixture\/|private|provider|disabled|modelAlias/u);
});
test('authentication dependency and audit failures remain private no-store errors before catalog access', async () => {
  for (const auditFailure of [false, true]) {
    const events: unknown[] = [];
    const unused = async () => assert.fail('authentication failure reached a protected port');
    const handler = createChatHandler({
      newRequestId: () => 'request',
      authenticate: async () => {
        throw Error('private-authentication');
      },
      listPublishedModels: unused,
      resolveRoute: unused,
      resolveSecret: unused,
      checkLimit: unused,
      invokeDirect: unused,
      invokeOpenRouter: unused,
      writeUsage: unused,
      writeAudit: async (event) => {
        if (auditFailure) throw Error('private-audit');
        events.push(event);
      },
    });
    const response = await handler(singleModelRequest('fixture/a%2Fb?private=1'));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await response.text(), /private|fixture|%2F/u);
    assert.deepEqual(
      events,
      auditFailure ? [] : [{ kind: 'auth-unavailable', requestId: 'request' }],
    );
  }
});
test('each read reloads current catalog and IAM; multiple approved candidates do not duplicate a result', async () => {
  const models = singleModelCatalog();
  const route = models[0]?.routes[0];
  assert.ok(route);
  Object.assign(route, {
    candidates: [...route.candidates, { ...route.candidates[0], id: 'second' }],
  });
  const f = discoveryFixture(models);
  await lookup(f);
  Object.assign(models[0]?.openRouterMetadata ?? {}, { name: 'updated name' });
  assert.equal(
    ((await (await lookup(f)).json()) as { data: { name: string } }).data.name,
    'updated name',
  );
  f.statements.push({ effect: 'Deny', actions: ['*'], resources: ['provider:provider'] });
  await lookup(f, 'fixture/chat', 404);
  assert.equal(f.reads(), 3);
});
test('recognized invalid paths and queries reject after authentication before catalog access', async () => {
  for (const path of [
    'fixture',
    'fixture/',
    'fixture/chat/extra',
    'fixture/chat/',
    'fixture/a%2Fb',
    'fixture/a%5Cb',
    'fixture/a%252Fb',
    'fixture/a%3Fb',
    'fixture/a%23b',
    'fixture/a%00b',
    'fixture/a%7Fb',
    'fixture/a%C2%80b',
    'fixture/a%20b',
    'fixture/%E0%A4%A',
    `${'a'.repeat(129)}/chat`,
    `fixture/${'a'.repeat(257)}`,
    'fixture/chat?q=x',
    'fixture/chat?limit=1',
  ] as const) {
    const f = discoveryFixture(singleModelCatalog());
    await lookup(f, path, 400);
    assert.equal(f.reads(), 0, path);
  }
  const f = discoveryFixture(singleModelCatalog(), { authenticated: false });
  await lookup(f, 'fixture/a%2Fb?private=1', 401);
  assert.equal(f.reads(), 0);
});
test('unsupported methods, legacy bases and plural paths stay unavailable without catalog reads', async () => {
  const f = discoveryFixture(singleModelCatalog());
  for (const [method, path] of [
    ['POST', '/api/v1/model/fixture/chat'],
    ['HEAD', '/api/v1/model/fixture/chat'],
    ['GET', '/v1/model/fixture/chat'],
    ['GET', '/api/v1/models/fixture/chat'],
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
test('hidden malformed catalog, missing rich target and required dependency failures suppress all details', async () => {
  const models = singleModelCatalog();
  Object.assign(models.at(-1)?.openRouterMetadata?.pricing ?? {}, { prompt: 'private-invalid' });
  for (const [f, alias] of [
    [discoveryFixture(models), 'fixture/chat'],
    [discoveryFixture(singleModelCatalog()), 'fixture/basic'],
    [discoveryFixture(singleModelCatalog(), { catalogFailure: true }), 'fixture/chat'],
    [discoveryFixture(singleModelCatalog(), { auditFailure: true }), 'fixture/chat'],
    [discoveryFixture(singleModelCatalog(), { auditFailure: true }), 'fixture/missing'],
  ] as const) {
    const response = await lookup(f, alias, 503);
    assert.doesNotMatch(await response.text(), /private|fixture\/|canonical|pricing|endpoints/u);
    if (f.events.length)
      assert.equal((f.events.at(-1) as { kind: string }).kind, 'model-read-unavailable');
  }
});
test('required unavailable and invalid-request audits fail closed when their own handoff fails', async () => {
  const f = discoveryFixture(singleModelCatalog(), { catalogFailure: true, auditFailure: true });
  await lookup(f, 'fixture/chat', 503);
  assert.equal(f.reads(), 1);
  const invalid = discoveryFixture(singleModelCatalog(), { auditFailure: true });
  await lookup(invalid, 'fixture/a%2Fb', 503);
  assert.equal(invalid.reads(), 0);
});
test('audit-time source mutation cannot rewrite captured lookup identity or metadata', async () => {
  const models = singleModelCatalog();
  const f = discoveryFixture(models, {
    audit: () => {
      Object.assign(models[0] ?? {}, { alias: 'fixture/changed', created: 99, enabled: false });
      Object.assign(models[0]?.openRouterMetadata ?? {}, { name: 'changed' });
      Object.assign(models[0]?.openRouterMetadata?.pricing ?? {}, { prompt: '9' });
    },
  });
  const body = (await (await lookup(f)).json()) as {
    data: { id: string; created: number; name: string; pricing: { prompt: string } };
  };
  assert.equal(body.data.id, 'fixture/chat');
  assert.equal(body.data.created, 42);
  assert.equal(body.data.name, 'private published name');
  assert.equal(body.data.pricing.prompt, '0.000001');
});
