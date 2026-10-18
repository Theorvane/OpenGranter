import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { detailsModel, detailsPrivacy, relativeDetails } from './model-details-links-fixture.ts';
import { discoveryFixture } from './model-discovery-filters-fixture.ts';

for (const kind of ['managed', 'delegated'] as const)
  for (const filtered of [false, true])
    test(`installed SDKs preserve relative details and fresh page IAM on ${kind} discovery, ranges=${filtered}`, async () => {
      const secondDetails = `${relativeDetails}?version=2#details`;
      const models = [
        detailsModel(relativeDetails, 'first', kind),
        detailsModel(secondDetails, 'second', kind),
      ];
      if (filtered) {
        for (const model of models)
          Object.assign(model.openRouterMetadata ?? {}, {
            benchmarks: {
              artificial_analysis: { intelligence_index: 5, coding_index: 5, agentic_index: 5 },
              design_arena: [],
            },
          });
        const outside = detailsModel(relativeDetails, 'outside', kind);
        Object.assign(outside.openRouterMetadata ?? {}, {
          benchmarks: {
            artificial_analysis: { intelligence_index: 4, coding_index: 6, agentic_index: 5 },
            design_arena: [],
          },
        });
        models.unshift(outside);
      }
      const f = discoveryFixture(models);
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
        const first = await router.models.list({
          limit: 1,
          ...(filtered ? { minIntelligenceIndex: 5, maxCodingIndex: 5 } : {}),
        });
        assert.equal(first.result.totalCount, 2);
        assert.equal(first.result.data[0]?.links.details, relativeDetails);
        const next = await first.next();
        assert.ok(next);
        assert.equal(next.result.data[0]?.links.details, secondDetails);
        const raw = (
          await openai.models.list(
            filtered
              ? { query: { min_intelligence_index: '5', max_coding_index: '5' } }
              : undefined,
          )
        ).data as unknown as { links: { details: string } }[];
        assert.deepEqual(
          raw.map((row) => row.links.details),
          [relativeDetails, secondDetails],
        );
        f.statements.push({ effect: 'Deny', actions: ['*'], resources: ['provider:provider'] });
        const denied = await first.next();
        assert.ok(denied);
        assert.deepEqual(denied.result.data, []);
        assert.equal(denied.result.totalCount, 0);
        if (filtered)
          for (const query of queries) {
            assert.equal(query.get('min_intelligence_index'), '5');
            assert.equal(query.get('max_coding_index'), '5');
          }
        detailsPrivacy(f);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    });
