import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { discoveryFixture } from './model-discovery-filters-fixture.ts';
import { priceBounds, priceRangeCatalog, priceRangePrivacy } from './model-price-ranges-fixture.ts';

for (const kind of ['managed', 'delegated'] as const)
  test(`installed SDKs serialize four price bounds and paginate ${kind} discovery with fresh IAM`, async () => {
    const f = discoveryFixture(priceRangeCatalog(kind).filter((model) => model.alias !== 'basic'));
    const queries: URLSearchParams[] = [];
    const server = createNodeRequestServer((request) => {
      queries.push(new URL(request.url).searchParams);
      return f.handler(request);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
      const router = new OpenRouter({
        apiKey: 'fixture-proxy-key',
        serverURL: baseURL,
        retryConfig: { strategy: 'none' },
        timeoutMs: 3000,
      });
      const openai = new OpenAI({
        apiKey: 'fixture-proxy-key',
        baseURL,
        maxRetries: 0,
        timeout: 3000,
      });
      const options = {
        minPrice: 2,
        maxPrice: 4,
        minOutputPrice: 3,
        maxOutputPrice: 5,
        sort: 'pricing-low-to-high' as const,
        limit: 1,
      };
      const ids: string[] = [];
      for await (const page of await router.models.list(options)) {
        assert.equal(page.result.totalCount, 2);
        ids.push(...page.result.data.map((row) => row.id));
      }
      assert.deepEqual(ids, ['middle', 'tie']);
      const all = await openai.models.list({ query: priceBounds });
      assert.deepEqual(
        all.data.map((row) => row.id),
        ['middle', 'tie'],
      );
      for (const query of queries)
        for (const [name, value] of Object.entries(priceBounds))
          assert.equal(query.get(name), value);
      const first = await router.models.list(options);
      f.statements.push({ effect: 'Deny', actions: ['*'], resources: ['provider:provider'] });
      const next = await first.next();
      assert.ok(next);
      assert.equal(next.result.totalCount, 0);
      assert.deepEqual(next.result.data, []);
      priceRangePrivacy(f);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
