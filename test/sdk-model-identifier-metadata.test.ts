import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { discoveryFixture } from './model-discovery-filters-fixture.ts';
import {
  type IdentifierField,
  identifierContainer,
  identifierFields,
  identifierModel,
  identifierPrivacy,
  identifierValues,
} from './model-identifier-metadata-fixture.ts';

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
const mappings = {
  hugging_face_id: 'huggingFaceId',
  tokenizer: 'tokenizer',
  instruct_type: 'instructType',
} as const;
const sets: Array<Partial<Record<IdentifierField, unknown>>> = [
  identifierValues,
  {
    hugging_face_id: 'catalog-private/future',
    tokenizer: 'FutureTokenizer',
    instruct_type: 'future-format',
  },
  { hugging_face_id: null, tokenizer: '', instruct_type: null },
  { hugging_face_id: ' \n ', tokenizer: ' \n ', instruct_type: ' \n ' },
  {},
];
for (const [index, values] of sets.entries())
  test(`installed SDKs preserve model identifiers, open enums and null/omission case${index}`, async () => {
    const f = discoveryFixture([identifierModel(values)]);
    await socket(f, async (sdk, openai) => {
      const router = (await sdk.models.list()).result.data[0];
      assert.ok(router);
      const raw = (await openai.models.list()).data[0] as unknown as Record<string, unknown>;
      for (const field of identifierFields) {
        const container = identifierContainer(raw, field);
        assert.equal(Object.hasOwn(container, field), Object.hasOwn(values, field));
        assert.equal(container[field], values[field]);
        const sdkContainer: unknown = field === 'hugging_face_id' ? router : router.architecture;
        assert.equal(
          (sdkContainer as unknown as Record<string, unknown>)[mappings[field]],
          values[field],
        );
      }
    });
    identifierPrivacy(f);
  });
test('installed SDK pagination retains identifiers and applies fresh model/provider Deny', async () => {
  const f = discoveryFixture([
    identifierModel(identifierValues, 'first'),
    identifierModel({ hugging_face_id: null, tokenizer: 'Llama3', instruct_type: null }, 'second'),
  ]);
  await socket(f, async (sdk, openai) => {
    const first = await sdk.models.list({ limit: 1 });
    assert.equal(first.result.data[0]?.huggingFaceId, identifierValues.hugging_face_id);
    const next = await first.next();
    assert.ok(next);
    assert.equal(next.result.data[0]?.huggingFaceId, null);
    assert.equal(next.result.data[0]?.architecture.tokenizer, 'Llama3');
    assert.equal(next.result.data[0]?.architecture.instructType, null);
    const raw = (await openai.models.list({ query: { limit: 1, offset: 1 } }))
      .data[0] as unknown as Record<string, unknown>;
    assert.equal(raw.hugging_face_id, null);
    assert.equal(identifierContainer(raw, 'tokenizer').tokenizer, 'Llama3');
    for (const resource of ['model:second', 'provider:provider']) {
      f.statements.splice(
        0,
        f.statements.length,
        { effect: 'Allow', actions: ['*'], resources: ['*'] },
        { effect: 'Deny', actions: ['*'], resources: [resource] },
      );
      const denied = await first.next();
      assert.ok(denied);
      assert.deepEqual(denied.result.data, []);
      assert.equal(denied.result.totalCount, resource === 'model:second' ? 1 : 0);
      assert.deepEqual((await openai.models.list({ query: { offset: 1 } })).data, []);
    }
  });
  identifierPrivacy(f);
});
test('installed SDKs retain sanitized malformed identifier catalog failure', async () => {
  const f = discoveryFixture([identifierModel({ tokenizer: null })]);
  await socket(f, async (sdk, openai) => {
    await assert.rejects(
      () => sdk.models.list(),
      (error) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(
          error.message,
          /catalog-private|hugging_face_id|tokenizer|instruct_type/u,
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
          /catalog-private|hugging_face_id|tokenizer|instruct_type/u,
        );
        return true;
      },
    );
  });
  identifierPrivacy(f);
});
