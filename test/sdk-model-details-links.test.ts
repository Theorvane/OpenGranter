import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { detailsModel, detailsPrivacy, relativeDetails } from './model-details-links-fixture.ts';
import { discoveryFixture } from './model-discovery-filters-fixture.ts';

for (const kind of ['managed', 'delegated'] as const)
  test(`installed SDKs preserve relative details and fresh page IAM on ${kind} discovery`, async () => {
    const secondDetails = `${relativeDetails}?version=2#details`;
    const f = discoveryFixture([
      detailsModel(relativeDetails, 'first', kind),
      detailsModel(secondDetails, 'second', kind),
    ]);
    const server = createNodeRequestServer(f.handler);
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
      const first = await router.models.list({ limit: 1 });
      assert.equal(first.result.data[0]?.links.details, relativeDetails);
      const next = await first.next();
      assert.ok(next);
      assert.equal(next.result.data[0]?.links.details, secondDetails);
      const raw = (await openai.models.list()).data as unknown as { links: { details: string } }[];
      assert.deepEqual(
        raw.map((row) => row.links.details),
        [relativeDetails, secondDetails],
      );
      f.statements.push({ effect: 'Deny', actions: ['*'], resources: ['provider:provider'] });
      const denied = await first.next();
      assert.ok(denied);
      assert.deepEqual(denied.result.data, []);
      assert.equal(denied.result.totalCount, 0);
      detailsPrivacy(f);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
