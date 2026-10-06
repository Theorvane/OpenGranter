import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import {
  descriptiveFields,
  descriptiveModel,
  descriptivePrivacy,
} from './model-descriptive-metadata-fixture.ts';
import { discoveryFixture } from './model-discovery-filters-fixture.ts';

async function socket(
  f: ReturnType<typeof discoveryFixture>,
  run: (sdk: OpenRouter, openai: OpenAI) => Promise<void>,
) {
  const server = createNodeRequestServer(f.handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
    await run(
      new OpenRouter({
        apiKey: 'fixture-proxy-key',
        serverURL: url,
        retryConfig: { strategy: 'none' },
        timeoutMs: 3000,
      }),
      new OpenAI({ apiKey: 'fixture-proxy-key', baseURL: url, maxRetries: 0, timeout: 3000 }),
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
const names = {
  description: 'description',
  expiration_date: 'expirationDate',
  knowledge_cutoff: 'knowledgeCutoff',
} as const;
for (const extra of [
  descriptiveFields,
  { description: '', expiration_date: null, knowledge_cutoff: null },
  { description: ' \n\t ', expiration_date: '2026-02-30', knowledge_cutoff: 'not-a-date' },
  {},
])
  test(`installed SDKs preserve exact descriptive strings/null/omission: ${JSON.stringify(extra)}`, async () => {
    const f = discoveryFixture([descriptiveModel(extra)]);
    await socket(f, async (sdk, openai) => {
      const router = (await sdk.models.list()).result.data[0];
      const raw = (await openai.models.list()).data[0] as unknown as Record<string, unknown>;
      assert.ok(router);
      for (const [key, camel] of Object.entries(names)) {
        const expected = (extra as Record<string, unknown>)[key];
        assert.equal((router as unknown as Record<string, unknown>)[camel], expected);
        assert.equal(raw[key], expected);
        assert.equal(Object.hasOwn(raw, key), Object.hasOwn(extra, key));
      }
    });
    descriptivePrivacy(f);
  });
test('installed SDK pagination retains descriptive fields and reevaluates Deny', async () => {
  const f = discoveryFixture([
    descriptiveModel(descriptiveFields, 'first'),
    descriptiveModel({ description: 'second', expiration_date: null }, 'second'),
  ]);
  await socket(f, async (sdk, openai) => {
    const first = await sdk.models.list({ limit: 1 });
    assert.equal(first.result.data[0]?.description, descriptiveFields.description);
    const next = await first.next();
    assert.ok(next);
    assert.equal(next.result.data[0]?.description, 'second');
    assert.equal(next.result.data[0]?.expirationDate, null);
    const raw = await openai.models.list({ query: { limit: 1, offset: 1 } });
    assert.equal((raw.data[0] as unknown as Record<string, unknown>).description, 'second');
    f.statements.splice(0, f.statements.length, {
      effect: 'Deny',
      actions: ['*'],
      resources: ['*'],
    });
    const denied = await first.next();
    assert.ok(denied);
    assert.equal(denied.result.totalCount, 0);
    assert.deepEqual(denied.result.data, []);
    assert.deepEqual((await openai.models.list({ query: { offset: 1 } })).data, []);
  });
  descriptivePrivacy(f);
});
test('installed SDKs receive sanitized catalog failures for malformed descriptive snapshots', async () => {
  const f = discoveryFixture([descriptiveModel({ description: null })]);
  await socket(f, async (sdk, openai) => {
    await assert.rejects(
      () => sdk.models.list(),
      (error) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(
          error.message,
          /descriptive-private|description|expiration_date|knowledge_cutoff/u,
        );
        return true;
      },
    );
    await assert.rejects(
      () => openai.models.list(),
      (error) => {
        assert.ok(error instanceof OpenAI.APIError);
        assert.equal(error.status, 503);
        assert.doesNotMatch(
          error.message,
          /descriptive-private|description|expiration_date|knowledge_cutoff/u,
        );
        return true;
      },
    );
  });
  descriptivePrivacy(f);
});
