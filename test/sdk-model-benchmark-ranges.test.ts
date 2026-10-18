import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { allRanges, rangeCatalog } from './model-benchmark-ranges-fixture.ts';
import { discoveryFixture, discoveryPrivacy } from './model-discovery-filters-fixture.ts';

for (const kind of ['managed', 'delegated'] as const)
  test(`installed SDKs combine every benchmark bound and paginate ${kind} discovery with fresh IAM`, async () => {
    const f = discoveryFixture(rangeCatalog(kind).filter((model) => model.alias !== 'basic'));
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
        minIntelligenceIndex: 5,
        maxIntelligenceIndex: 5,
        minCodingIndex: 5,
        maxCodingIndex: 5,
        minAgenticIndex: 5,
        maxAgenticIndex: 5,
        sort: 'intelligence-high-to-low' as const,
        limit: 1,
      };
      const ids: string[] = [];
      for await (const page of await router.models.list(options)) {
        assert.equal(page.result.totalCount, 2);
        ids.push(...page.result.data.map((row) => row.id));
      }
      assert.deepEqual(ids, ['middle', 'tie']);
      const all = await openai.models.list({ query: allRanges });
      assert.deepEqual(
        all.data.map((row) => row.id),
        ['middle', 'tie'],
      );
      for (const query of queries)
        for (const [name, value] of Object.entries(allRanges)) assert.equal(query.get(name), value);
      const first = await router.models.list(options);
      f.statements.push({ effect: 'Deny', actions: ['*'], resources: ['provider:provider'] });
      const second = await first.next();
      assert.ok(second);
      assert.equal(second.result.totalCount, 0);
      assert.deepEqual(second.result.data, []);
      discoveryPrivacy(f);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
