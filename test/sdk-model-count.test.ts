import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { countCatalog } from './model-count-fixture.ts';
import { discoveryFixture, discoveryPrivacy } from './model-discovery-filters-fixture.ts';

for (const kind of ['managed', 'delegated'] as const)
  for (const relativeLinks of [false, true])
    test(`installed OpenRouter SDK counts ${kind} authorized models and applies fresh IAM, relativeLinks=${relativeLinks}`, async () => {
      const models = countCatalog(kind);
      if (relativeLinks)
        for (const model of models) {
          if (model.openRouterMetadata)
            Object.assign(model.openRouterMetadata.links, {
              details: '/api/v1/models/fixture/private-count/endpoints',
            });
        }
      const f = discoveryFixture(models);
      const server = createNodeRequestServer(f.handler);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const router = new OpenRouter({
          apiKey: 'fixture-proxy-key',
          serverURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`,
          retryConfig: { strategy: 'none' },
          timeoutMs: 3000,
        });
        assert.deepEqual(await router.models.count(), { data: { count: 4 } });
        assert.deepEqual(await router.models.count({ outputModalities: 'all' }), {
          data: { count: 6 },
        });
        assert.deepEqual(await router.models.count({ outputModalities: 'text,image' }), {
          data: { count: 5 },
        });
        f.statements.push({ effect: 'Deny', actions: ['*'], resources: ['provider:provider'] });
        assert.deepEqual(await router.models.count({ outputModalities: 'all' }), {
          data: { count: 0 },
        });
        discoveryPrivacy(f);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    });
