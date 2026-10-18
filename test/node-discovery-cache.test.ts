import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { HTTPClient, OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { countCatalog } from './model-count-fixture.ts';
import { discoveryFixture, discoveryPrivacy } from './model-discovery-filters-fixture.ts';

async function socket(
  handle: (request: Request) => Promise<Response>,
  run: (base: string) => Promise<void>,
  errorResponse?: () => Response,
) {
  const server = createNodeRequestServer(handle, errorResponse);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
const discovery = [
  '/v1/models',
  '/api/v1/models',
  '/api/v1/models/count',
  '/api/v1/model/fixture/chat',
];
for (const scenario of ['normal', 'throw', 'custom-error'] as const)
  test(`Node ${scenario} discovery responses override cacheable headers while preserving payloads`, async () => {
    const failure = () =>
      Response.json(
        { error: 'fixed fixture error' },
        {
          status: 503,
          headers: { 'cache-control': 'public, max-age=3600', 'x-request-id': 'fallback' },
        },
      );
    await socket(
      async () => {
        if (scenario !== 'normal') throw Error('private-exception');
        return Response.json(
          { data: 'fixture-data' },
          { headers: { 'cache-control': 'public, max-age=3600', 'x-request-id': 'custom' } },
        );
      },
      async (base) => {
        for (const path of [...discovery, '/api/v1/model/fixture/chat?invalid=1']) {
          const response = await fetch(`${base}${path}`);
          assert.equal(
            response.status,
            scenario === 'normal' ? 200 : scenario === 'throw' ? 500 : 503,
          );
          assert.equal(response.headers.get('cache-control'), 'no-store');
          assert.equal(
            response.headers.get('x-request-id'),
            scenario === 'normal' ? 'custom' : scenario === 'throw' ? null : 'fallback',
          );
          const body: unknown = await response.json();
          if (scenario === 'normal') assert.deepEqual(body, { data: 'fixture-data' });
          else if (scenario === 'custom-error')
            assert.deepEqual(body, { error: 'fixed fixture error' });
          else assert.doesNotMatch(JSON.stringify(body), /private|fixture/u);
        }
        for (const path of ['/api/v1/models-extra', '/api/v1/model', '/v1/chat/completions']) {
          const response = await fetch(`${base}${path}`);
          assert.equal(
            response.headers.get('cache-control'),
            scenario === 'throw' ? null : 'public, max-age=3600',
          );
          await response.body?.cancel();
        }
      },
      scenario === 'custom-error' ? failure : undefined,
    );
  });
for (const kind of ['managed', 'delegated'] as const)
  test(`installed SDKs consume ${kind} no-store discovery and fresh provider IAM over sockets`, async () => {
    const f = discoveryFixture(countCatalog(kind).filter((model) => model.alias !== 'basic'));
    const received: string[] = [];
    await socket(f.handler, async (base) => {
      const httpClient = new HTTPClient();
      httpClient.addHook('response', (response) => {
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        received.push(response.headers.get('x-request-id') ?? '');
      });
      const sdk = new OpenRouter({
        apiKey: 'fixture-proxy-key',
        serverURL: `${base}/api/v1`,
        httpClient,
        retryConfig: { strategy: 'none' },
        timeoutMs: 3000,
      });
      const first = await sdk.models.list({ limit: 1, outputModalities: 'text' });
      assert.equal(first.result.data.length, 1);
      f.statements.push({ effect: 'Deny', actions: ['*'], resources: ['provider:provider'] });
      const next = await first.next();
      assert.ok(next);
      assert.deepEqual(next.result.data, []);
      assert.equal(next.result.totalCount, 0);
      assert.deepEqual(await sdk.models.count({ outputModalities: 'all' }), { data: { count: 0 } });
      for (const prefix of ['/v1', '/api/v1']) {
        const openai = new OpenAI({
          apiKey: 'fixture-proxy-key',
          baseURL: `${base}${prefix}`,
          maxRetries: 0,
          timeout: 3000,
        });
        const { data, response } = await openai.models.list().withResponse();
        assert.deepEqual(data.data, []);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('x-request-id'), 'request');
      }
      assert.deepEqual(received, ['request', 'request', 'request']);
      assert.equal(f.reads(), 5);
      discoveryPrivacy(f);
    });
  });
