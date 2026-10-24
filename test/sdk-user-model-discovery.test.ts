import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { HTTPClient, OpenRouter } from '@openrouter/sdk';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { countCatalog } from './model-count-fixture.ts';
import {
  discoveryFixture,
  discoveryModel,
  discoveryPrivacy,
} from './model-discovery-filters-fixture.ts';

async function socket(
  handle: (request: Request) => Promise<Response>,
  run: (base: string) => Promise<void>,
) {
  const server = createNodeRequestServer(handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
for (const kind of ['managed', 'delegated'] as const)
  test(`installed OpenRouter user listing consumes ${kind} pages, explicit bearer and fresh IAM`, async () => {
    const f = discoveryFixture(countCatalog(kind).filter((m) => m.alias !== 'basic'));
    const paths: URL[] = [];
    const headers: string[] = [];
    const httpClient = new HTTPClient();
    httpClient.addHook('response', (response) => {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-request-id'), 'request');
    });
    await socket(
      async (request) => {
        paths.push(new URL(request.url));
        headers.push(request.headers.get('authorization') ?? '');
        return f.handler(request);
      },
      async (base) => {
        const sdk = new OpenRouter({
          apiKey: 'fixture-unused-global',
          serverURL: base,
          httpClient,
          retryConfig: { strategy: 'none' },
          timeoutMs: 3000,
        });
        const security = { bearer: 'fixture-operation-bearer' };
        const pages = await sdk.models.listForUser(security, { limit: 2 });
        const ids: string[] = [];
        for await (const page of pages) {
          assert.equal(page.result.totalCount, 4);
          ids.push(...page.result.data.map((m) => m.id));
        }
        assert.deepEqual(ids, ['small', 'multi', 'unknown', 'large']);
        assert.equal(paths.length, 3);
        assert.ok(paths.every((url) => url.pathname === '/api/v1/models/user'));
        assert.deepEqual(
          paths.map((url) => url.searchParams.get('offset')),
          ['0', '2', '4'],
        );
        const all = await sdk.models.listForUser(security, { outputModalities: 'all' });
        assert.equal(all.result.totalCount, 5);
        const first = await sdk.models.listForUser(security, {
          limit: 1,
          outputModalities: 'text',
        });
        f.statements.push({ effect: 'Deny', actions: ['*'], resources: ['provider:provider'] });
        const next = await first.next();
        assert.ok(next);
        assert.deepEqual(next.result.data, []);
        assert.equal(next.result.totalCount, 0);
        assert.ok(headers.every((value) => value === 'Bearer fixture-operation-bearer'));
        assert.equal(f.reads(), 6);
        discoveryPrivacy(f);
      },
    );
  });
test('operation bearer determines the proxy principal and cannot select another user through query', async () => {
  const models = [discoveryModel('alpha'), discoveryModel('beta')];
  const events: unknown[] = [];
  let reads = 0;
  const unused = async () => assert.fail('user listing reached invocation port');
  const handler = createChatHandler({
    newRequestId: () => 'request',
    authenticate: async (token) => {
      const id = token === 'fixture-alice' ? 'alice' : token === 'fixture-bob' ? 'bob' : undefined;
      if (!id) return undefined;
      return {
        id,
        credentialId: `credential-${id}`,
        active: true,
        policyVersions: [],
        statements: [
          {
            effect: 'Allow',
            actions: ['llm:InvokeModel'],
            resources: [`model:${id === 'alice' ? 'alpha' : 'beta'}`],
          },
          { effect: 'Allow', actions: ['llm:UseProvider'], resources: ['provider:provider'] },
        ],
      };
    },
    listPublishedModels: async () => {
      reads++;
      return models;
    },
    resolveRoute: unused,
    resolveSecret: unused,
    checkLimit: unused,
    invokeDirect: unused,
    invokeOpenRouter: unused,
    writeUsage: unused,
    writeAudit: async (event) => {
      events.push(event);
    },
  });
  await socket(handler, async (base) => {
    const sdk = new OpenRouter({
      apiKey: 'fixture-not-a-principal',
      serverURL: base,
      retryConfig: { strategy: 'none' },
      timeoutMs: 3000,
    });
    const alice = await sdk.models.listForUser({ bearer: 'fixture-alice' });
    assert.deepEqual(
      alice.result.data.map((m) => m.id),
      ['alpha'],
    );
    const bob = await sdk.models.listForUser({ bearer: 'fixture-bob' });
    assert.deepEqual(
      bob.result.data.map((m) => m.id),
      ['beta'],
    );
    await assert.rejects(
      sdk.models.listForUser({ bearer: 'fixture-invalid' }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(Reflect.get(error, 'statusCode'), 401);
        return true;
      },
    );
    const override = await fetch(`${base}/models/user?principal_id=bob`, {
      headers: { authorization: 'Bearer fixture-alice' },
    });
    assert.equal(override.status, 400);
    assert.equal(override.headers.get('cache-control'), 'no-store');
    await override.body?.cancel();
  });
  assert.equal(reads, 2);
  assert.deepEqual(
    events.slice(0, 2).map((event) => Reflect.get(event as object, 'principalId')),
    ['alice', 'bob'],
  );
  assert.doesNotMatch(JSON.stringify(events), /fixture-|alpha|beta|principal_id/u);
});
test('installed OpenRouter all-output listing still requires rich published rows', async () => {
  const f = discoveryFixture(countCatalog());
  await socket(f.handler, async (base) => {
    const sdk = new OpenRouter({
      serverURL: base,
      retryConfig: { strategy: 'none' },
      timeoutMs: 3000,
    });
    await assert.rejects(
      sdk.models.listForUser({ bearer: 'fixture-bearer' }, { outputModalities: 'all' }),
      { name: 'ResponseValidationError' },
    );
    assert.equal(f.reads(), 1);
    discoveryPrivacy(f);
  });
});
