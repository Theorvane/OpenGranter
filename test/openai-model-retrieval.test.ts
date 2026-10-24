import assert from 'node:assert/strict';
import test from 'node:test';
import { projectGatewayAuditEvent } from '../src/audit/postgres-gateway-audit.ts';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import {
  discoveryFixture,
  discoveryModel,
  discoveryPrivacy,
} from './model-discovery-filters-fixture.ts';
import { singleModelCatalog } from './single-model-discovery-fixture.ts';

const bases = ['/v1', '/api/v1'];
function request(base: string, encoded: string, query = '') {
  const value = new Request(`http://fixture.example${base}/models/${encoded}${query}`, {
    headers: { authorization: 'Bearer fixture' },
  });
  Object.defineProperty(value, 'body', { get: () => assert.fail('retrieval read request body') });
  return value;
}
async function retrieve(
  f: ReturnType<typeof discoveryFixture>,
  base: string,
  id: string,
  status = 200,
) {
  const response = await f.handler(request(base, encodeURIComponent(id)));
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-request-id'), 'request');
  discoveryPrivacy(f);
  assert.doesNotMatch(JSON.stringify(f.events), /fixture\/|canonical|modelAlias|alias_target/u);
  return response;
}
for (const kind of ['managed', 'delegated'] as const)
  for (const base of bases)
    test(`${kind} ${base} OpenAI retrieval returns exact bare listing rows, including basic aliases`, async () => {
      const f = discoveryFixture([
        ...singleModelCatalog(kind),
        discoveryModel('simple', { kind, basic: true }),
      ]);
      const listed = (await (await f.handler(f.request('', base))).json()) as {
        data: { id: string }[];
      };
      for (const id of [
        'fixture/chat',
        'fixture/chat:free',
        'fixture/模型',
        'fixture/basic',
        'simple',
      ]) {
        const result: unknown = await (await retrieve(f, base, id)).json();
        assert.deepEqual(
          result,
          listed.data.find((row) => row.id === id),
        );
        assert.deepEqual(f.events.at(-1), {
          kind: 'model-read',
          requestId: 'request',
          principalId: 'user',
          credentialId: 'credential',
          policyVersions: [],
          count: 1,
        });
        const stored = projectGatewayAuditEvent(f.events.at(-1), 1000);
        assert.deepEqual(stored.details, { count: 1 });
      }
      assert.equal(f.reads(), 6);
    });
for (const base of bases) {
  test(`${base} model/provider/implicit Deny, disabled and unpublished aliases share private404`, async () => {
    const bodies: unknown[] = [];
    for (const id of [
      'fixture/missing',
      'fixture/disabled',
      'fixture/private-provider',
      'private/canonical',
      'fixture/unpublished-target',
    ]) {
      const f = discoveryFixture(singleModelCatalog());
      bodies.push(await (await retrieve(f, base, id, 404)).json());
      assert.deepEqual(projectGatewayAuditEvent(f.events.at(-1), 1000).details, { count: 0 });
    }
    for (const resource of ['model:fixture/chat', 'provider:provider']) {
      const f = discoveryFixture(singleModelCatalog());
      f.statements.push({ effect: 'Deny', actions: ['*'], resources: [resource] });
      bodies.push(await (await retrieve(f, base, 'fixture/chat', 404)).json());
    }
    const f = discoveryFixture(singleModelCatalog(), { statements: [] });
    bodies.push(await (await retrieve(f, base, 'fixture/chat', 404)).json());
    for (const body of bodies) assert.deepEqual(body, bodies[0]);
    assert.doesNotMatch(JSON.stringify(bodies), /private|fixture|provider|modelAlias/u);
  });
  test(`${base} path/query validation follows authentication and precedes catalog access`, async () => {
    for (const encoded of [
      'a%2F%2Fb',
      '%2Fa',
      'a%2F',
      'a%2F.%2Fb',
      'a%2F..%2Fb',
      'a%252Fb',
      'a%5Cb',
      'a%3Fb',
      'a%23b',
      'a%20b',
      'a%00b',
      'a%7Fb',
      'a%C2%80b',
      '%E0%A4%A',
      'a'.repeat(513),
      '%E3%84%B1'.repeat(513),
    ]) {
      const f = discoveryFixture();
      const response = await f.handler(request(base, encoded));
      assert.equal(response.status, 400, encoded.slice(0, 50));
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(f.reads(), 0);
      assert.doesNotMatch(await response.text(), /fixture|%2F|%E3/u);
      discoveryPrivacy(f);
    }
    for (const auditFailure of [false, true]) {
      const f = discoveryFixture(singleModelCatalog(), { auditFailure });
      const response = await f.handler(request(base, 'fixture%2Fchat', '?limit=1'));
      assert.equal(response.status, auditFailure ? 503 : 400);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(f.reads(), 0);
    }
    const denied = discoveryFixture(singleModelCatalog(), { authenticated: false });
    const response = await denied.handler(request(base, '%E0%A4%A', '?private=1'));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(denied.reads(), 0);
  });
  test(`${base} full catalog/audit faults suppress retrieval, including basic targets`, async () => {
    const hidden = singleModelCatalog();
    Object.assign(hidden.at(-1)?.openRouterMetadata?.pricing ?? {}, { prompt: 'private-invalid' });
    for (const f of [
      discoveryFixture(hidden),
      discoveryFixture(singleModelCatalog(), { catalogFailure: true }),
      discoveryFixture(singleModelCatalog(), { auditFailure: true }),
    ]) {
      for (const id of ['fixture/basic', 'fixture/missing']) {
        const response = await retrieve(f, base, id, 503);
        assert.doesNotMatch(await response.text(), /private|fixture/u);
      }
    }
  });
  test(`${base} captured output survives audit mutation and each later request reloads catalog/IAM`, async () => {
    const models = singleModelCatalog();
    let mutated = false;
    const f = discoveryFixture(models, {
      audit: () => {
        if (mutated) return;
        mutated = true;
        Object.assign(models[0] ?? {}, { alias: 'changed', created: 100 });
        Object.assign(models[0]?.openRouterMetadata ?? {}, { name: 'changed name' });
      },
    });
    const first = (await (await retrieve(f, base, 'fixture/chat')).json()) as {
      id: string;
      created: number;
      name?: string;
    };
    assert.equal(first.id, 'fixture/chat');
    assert.equal(first.created, 42);
    if (base === '/api/v1') assert.equal(first.name, 'private published name');
    await retrieve(f, base, 'fixture/chat', 404);
    await retrieve(f, base, 'changed');
    f.statements.push({ effect: 'Deny', actions: ['*'], resources: ['provider:provider'] });
    await retrieve(f, base, 'changed', 404);
    assert.equal(f.reads(), 4);
  });
}
test('decoded limits include512 Unicode units and exact count route retains precedence', async () => {
  const alias = 'ㄱ'.repeat(512);
  const f = discoveryFixture([
    discoveryModel(alias, { basic: true }),
    discoveryModel('count', { basic: true }),
  ]);
  for (const base of bases) await retrieve(f, base, alias);
  await retrieve(f, '/v1', 'count');
  const count = await f.handler(request('/api/v1', 'count', '?output_modalities=all'));
  assert.deepEqual(await count.json(), { data: { count: 2 } });
  assert.equal((f.events.at(-1) as { kind: string }).kind, 'models-counted');
  const reads = f.reads();
  const reserved = await f.handler(request('/api/v1', 'c%6funt'));
  assert.equal(reserved.status, 400);
  assert.equal(f.reads(), reads);
});
test('auth dependency/inactive/audit failures precede lookup and unsupported methods remain private404', async () => {
  for (const base of bases) {
    for (const failure of ['unavailable', 'inactive', 'audit'] as const) {
      const unused = async () => assert.fail('authentication reached protected port');
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
      const response = await handler(request(base, 'fixture%2Fchat'));
      assert.equal(response.status, failure === 'inactive' ? 401 : 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
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
    const f = discoveryFixture();
    for (const method of ['DELETE', 'HEAD', 'POST']) {
      const response = await f.handler(
        new Request(`http://fixture.example${base}/models/simple`, { method }),
      );
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    for (const id of ['fixture/chat', 'fixture/chat/endpoints', 'simple/']) {
      const response = await f.handler(request(base, id));
      assert.equal(response.status, 404);
    }
    assert.equal(f.reads(), 0);
    assert.deepEqual(f.events, []);
  }
});
