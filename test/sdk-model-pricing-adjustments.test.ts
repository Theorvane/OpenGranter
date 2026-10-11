import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { discoveryFixture } from './model-discovery-filters-fixture.ts';
import {
  allPrices,
  basePrices,
  overrideData,
  pricingData,
  pricingModel,
  pricingPrivacy,
} from './model-pricing-adjustments-fixture.ts';

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
const sdkOverride = {
  prompt: '3e-7',
  completion: '0.0000040',
  audio: '0',
  inputAudioCache: '2E-8',
  inputCacheRead: '5e-9',
  inputCacheWrite: '6e+1',
  inputCacheWrite1h: '7.00',
  minPromptTokens: -0.5,
  utcStart: 25.125,
  utcEnd: -1.25,
  utcDays: ['monday', 'pricing-private-future', 'monday'],
};
const cases = [
  [
    allPrices,
    {
      ...basePrices,
      request: '0',
      image: '1.00',
      imageOutput: '2e-4',
      imageToken: '3e-5',
      audio: '4e-6',
      audioOutput: '5e-7',
      inputAudioCache: '6e-8',
      inputCacheRead: '7e-9',
      inputCacheWrite: '8e+1',
      inputCacheWrite1h: '9.00',
      internalReasoning: '10',
      webSearch: '11',
    },
  ],
  [pricingData, { ...basePrices, discount: -0.5, overrides: [sdkOverride, sdkOverride] }],
  [basePrices, basePrices],
  [
    { ...basePrices, discount: 1.5, overrides: [] },
    { ...basePrices, discount: 1.5, overrides: [] },
  ],
  [
    { ...basePrices, overrides: [{}, {}] },
    { ...basePrices, overrides: [{}, {}] },
  ],
  [
    {
      ...basePrices,
      discount: Number.MAX_VALUE,
      overrides: [
        {
          min_prompt_tokens: -Number.MAX_VALUE,
          utc_start: Number.MIN_VALUE,
          utc_end: Number.MAX_VALUE,
          utc_days: ['', ' \n ', '😀', 'future'],
        },
      ],
    },
    {
      ...basePrices,
      discount: Number.MAX_VALUE,
      overrides: [
        {
          minPromptTokens: -Number.MAX_VALUE,
          utcStart: Number.MIN_VALUE,
          utcEnd: Number.MAX_VALUE,
          utcDays: ['', ' \n ', '😀', 'future'],
        },
      ],
    },
  ],
];
for (const [index, pair] of cases.entries())
  test(`installed SDK pricing raw/camelCase exact optional fields case${index}`, async () => {
    const [pricing, expected] = pair;
    assert.ok(pricing);
    const f = discoveryFixture([pricingModel(pricing)]);
    await socket(f, async (sdk, openai) => {
      const row = (await sdk.models.list()).result.data[0];
      assert.ok(row);
      assert.deepEqual(row.pricing, expected);
      const raw = (await openai.models.list()).data[0] as unknown as Record<string, unknown>;
      assert.deepEqual(raw.pricing, pricing);
    });
    pricingPrivacy(f);
  });
test('installed SDK pricing pages retain order/empty rows and fresh provider Deny', async () => {
  const f = discoveryFixture([
    pricingModel(pricingData, 'first'),
    pricingModel({ ...basePrices, overrides: [{}] }, 'second'),
  ]);
  await socket(f, async (sdk, openai) => {
    const first = await sdk.models.list({ limit: 1 });
    assert.deepEqual(first.result.data[0]?.pricing.overrides, [sdkOverride, sdkOverride]);
    const next = await first.next();
    assert.ok(next);
    assert.deepEqual(next.result.data[0]?.pricing.overrides, [{}]);
    const raw = (await openai.models.list({ query: { offset: 1, limit: 1 } }))
      .data[0] as unknown as Record<string, unknown>;
    assert.deepEqual(raw.pricing, { ...basePrices, overrides: [{}] });
    f.statements.splice(0, f.statements.length, {
      effect: 'Deny',
      actions: ['*'],
      resources: ['provider:provider'],
    });
    const denied = await first.next();
    assert.ok(denied);
    assert.equal(denied.result.totalCount, 0);
    assert.deepEqual(denied.result.data, []);
    assert.deepEqual((await openai.models.list()).data, []);
  });
  pricingPrivacy(f);
});
for (const [index, pricing] of [
  { ...basePrices, discount: NaN },
  { ...basePrices, overrides: [{ ...overrideData, utc_days: [] }] },
].entries())
  test(`installed SDK invalid pricing remains sanitized case${index}`, async () => {
    const f = discoveryFixture([pricingModel(pricing)]);
    await socket(f, async (sdk, openai) => {
      await assert.rejects(
        () => sdk.models.list(),
        (error) => {
          assert.ok(error instanceof Error);
          assert.doesNotMatch(error.message, /pricing-private|discount|overrides|utc_days/u);
          return true;
        },
      );
      await assert.rejects(
        () => openai.models.list(),
        (error) => {
          assert.ok(error instanceof OpenAI.APIError);
          assert.equal(error.status, 503);
          assert.doesNotMatch(error.message, /pricing-private|discount|overrides|utc_days/u);
          return true;
        },
      );
    });
    pricingPrivacy(f);
  });
