import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { discoveryFixture } from './model-discovery-filters-fixture.ts';
import {
  priceOrderCatalog,
  priceOrderPrivacy,
  priceOrders,
  priceSorts,
} from './model-price-order-fixture.ts';

async function socket(
  f: ReturnType<typeof discoveryFixture>,
  run: (router: OpenRouter, openai: OpenAI, queries: URLSearchParams[]) => Promise<void>,
) {
  const queries: URLSearchParams[] = [];
  const server = createNodeRequestServer((request) => {
    queries.push(new URL(request.url).searchParams);
    return f.handler(request);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
    await run(
      new OpenRouter({
        apiKey: 'fixture-proxy-key',
        serverURL: baseURL,
        retryConfig: { strategy: 'none' },
        timeoutMs: 3000,
      }),
      new OpenAI({ apiKey: 'fixture-proxy-key', baseURL, maxRetries: 0, timeout: 3000 }),
      queries,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

for (const kind of ['managed', 'delegated'] as const)
  for (const sort of priceSorts)
    test(`installed SDKs consume exact ${sort} order on ${kind} discovery and subsequent pages`, async () => {
      const f = discoveryFixture(
        priceOrderCatalog(kind).filter((model) => model.alias !== 'basic'),
      );
      const expected = priceOrders[sort].filter((id) => id !== 'basic');
      await socket(f, async (router, openai, queries) => {
        const ids: string[] = [];
        for await (const page of await router.models.list({ sort, limit: 2 })) {
          assert.equal(page.result.totalCount, 8);
          ids.push(...page.result.data.map((row) => row.id));
        }
        assert.deepEqual(ids, expected);
        const all = await openai.models.list({ query: { sort } });
        assert.deepEqual(
          all.data.map((row) => row.id),
          expected,
        );
        assert.ok(queries.length > 2);
        assert.ok(queries.every((query) => query.get('sort') === sort));
      });
      priceOrderPrivacy(f);
    });

test('installed OpenRouter price continuation reloads current model/provider policy', async () => {
  const f = discoveryFixture(priceOrderCatalog().filter((model) => model.alias !== 'basic'));
  await socket(f, async (router) => {
    const first = await router.models.list({ sort: 'pricing-low-to-high', limit: 1 });
    assert.equal(first.result.data[0]?.id, 'free');
    f.statements.push({ effect: 'Deny', actions: ['*'], resources: ['provider:provider'] });
    const second = await first.next();
    assert.ok(second);
    assert.deepEqual(second.result.data, []);
    assert.equal(second.result.totalCount, 0);
  });
  priceOrderPrivacy(f);
});
