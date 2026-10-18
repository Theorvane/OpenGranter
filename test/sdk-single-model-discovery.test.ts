import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { discoveryFixture, discoveryPrivacy } from './model-discovery-filters-fixture.ts';
import { singleModelCatalog } from './single-model-discovery-fixture.ts';

for (const kind of ['managed', 'delegated'] as const)
  test(`installed OpenRouter SDK reads ${kind} exact models, variants and Unicode with fresh IAM`, async () => {
    const f = discoveryFixture(singleModelCatalog(kind));
    const paths: string[] = [];
    const server = createNodeRequestServer((request) => {
      paths.push(new URL(request.url).pathname);
      return f.handler(request);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const router = new OpenRouter({
        apiKey: 'fixture-proxy-key',
        serverURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`,
        retryConfig: { strategy: 'none' },
        timeoutMs: 3000,
      });
      for (const slug of ['chat', 'chat:free', '模型']) {
        const result = await router.models.get({ author: 'fixture', slug });
        assert.equal(result.data.id, `fixture/${slug}`);
        assert.equal(result.data.canonicalSlug, 'private/canonical');
        assert.equal(result.data.contextLength, 8192);
        assert.equal(result.data.pricing.prompt, '0.000001');
        assert.equal(result.data.links.details, '/api/v1/models/fixture/chat/endpoints');
      }
      assert.deepEqual(paths, [
        '/api/v1/model/fixture/chat',
        '/api/v1/model/fixture/chat%3Afree',
        '/api/v1/model/fixture/%E6%A8%A1%E5%9E%8B',
      ]);
      f.statements.push({ effect: 'Deny', actions: ['*'], resources: ['provider:provider'] });
      await assert.rejects(
        router.models.get({ author: 'fixture', slug: 'chat' }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal((error as Error & { statusCode: number }).statusCode, 404);
          assert.doesNotMatch(error.message, /private\/canonical|endpoints/u);
          return true;
        },
      );
      discoveryPrivacy(f);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
