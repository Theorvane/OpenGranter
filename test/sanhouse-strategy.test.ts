import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJevStrategy } from '../src/routing/owned-strategy.ts';
import {
  createSanhouseTransport,
  decodeSanhouseResearchChoice,
} from '../src/routing/sanhouse-choice.ts';

// Infra's historical, nonidentifying observation; this is a consumer contract, not server OpenAPI.
const observed = {
  model: 'dhtocks/malkuth-2b',
  revision: '37ae1672eebcf9ee5417418bd0be49f2e53d9087',
  index: 0,
  choice: 'a',
  probabilities: [0.9977489113807678, 0.002251051366329193],
  inference_ms: 85.34099599637557,
  server_ms: 86.99600599356927,
  queue_ms: 0.0007320049917325377,
  input_tokens: [32],
  state_tokens: 11,
  temperature: 1.1755479062836087,
  truncated: false,
  gpu_allocated_bytes: 3784908800,
  gpu_reserved_bytes: 4116709376,
  license: 'CC-BY-NC-4.0',
  commercial_use_authorized: false,
  action_authorization: false,
  probabilities_calibrated: false,
};
const candidates = ['a', 'b'].map((id) => ({
  id,
  priority: 1,
  providerId: 'openai',
  upstreamModelId: 'gpt',
}));
test('disabled and production-gated composed transport never resolves credentials or calls HTTP', async () => {
  let secrets = 0;
  let network = 0;
  const fetchDecision = createSanhouseTransport({
    credentialRef: 'secret/jev',
    resolveSecret: async () => {
      secrets++;
      return 'fixture-key';
    },
    fetcher: async () => {
      network++;
      return new Response('{}');
    },
  });
  for (const config of [
    {},
    { enabled: false, environment: 'research' as const },
    { enabled: true, environment: 'production' as const },
  ]) {
    assert.equal(
      await createJevStrategy({ ...config, fetchDecision }).select(candidates),
      undefined,
    );
  }
  assert.equal(secrets, 0);
  assert.equal(network, 0);
});
test('observed Sanhouse response is decoded only with consistent index choice and probabilities', () => {
  assert.equal(decodeSanhouseResearchChoice(observed, ['a', 'b']), 'a');
  for (const patch of [
    { index: 1 },
    { index: -1 },
    { index: 0.5 },
    { choice: 'forbidden' },
    { probabilities: [1] },
    { probabilities: [NaN, 0] },
    { probabilities: [1.1, -0.1] },
    { probabilities: [0.5, 0.5] },
    { probabilities: [0.9, 0.9] },
    { truncated: true },
    { commercial_use_authorized: true },
    { probabilities_calibrated: true },
    { action_authorization: true },
    { license: 'unknown' },
  ])
    assert.equal(decodeSanhouseResearchChoice({ ...observed, ...patch }, ['a', 'b']), undefined);
  assert.equal(decodeSanhouseResearchChoice({ response: observed }, ['a', 'b']), undefined);
});
test('Jev default shares no prompt and explicit research decoder can select an eligible ID', async () => {
  let calls = 0;
  const strategy = createJevStrategy({
    enabled: true,
    environment: 'research',
    promptText: 'private',
    decode: decodeSanhouseResearchChoice,
    fetchDecision: async (request) => {
      calls++;
      assert.deepEqual(Object.keys(request).sort(), ['instruction', 'options', 'state']);
      assert.equal(JSON.stringify(request).includes('private'), false);
      assert.deepEqual(request.options, ['a', 'b']);
      return observed;
    },
  });
  assert.deepEqual(await strategy.select(candidates), { candidateId: 'a' });
  assert.equal(calls, 1);
  const shared = createJevStrategy({
    enabled: true,
    environment: 'research',
    sharePrompt: true,
    promptText: 'explicit',
    fetchDecision: async (request) => {
      assert.equal(request.state.prompt, 'explicit');
      return observed;
    },
    decode: decodeSanhouseResearchChoice,
  });
  assert.deepEqual(await shared.select(candidates), { candidateId: 'a' });
});
test('Jev malformed failure uncertainty and noncooperative timeout produce deterministic fallback signal', async () => {
  for (const fetchDecision of [
    async () => null,
    async () => {
      throw new Error('secret');
    },
    async () => ({ ...observed, probabilities: [0.51, 0.49] }),
  ]) {
    assert.equal(
      await createJevStrategy({
        enabled: true,
        environment: 'research',
        fetchDecision,
        decode: decodeSanhouseResearchChoice,
      }).select(candidates),
      undefined,
    );
  }
  let signal: AbortSignal | undefined;
  assert.equal(
    await createJevStrategy({
      enabled: true,
      environment: 'research',
      timeoutMs: 5,
      fetchDecision: async (_request, current) => {
        signal = current;
        return new Promise(() => {});
      },
    }).select(candidates),
    undefined,
  );
  assert.equal(signal?.aborted, true);
});
test('Sanhouse transport fixes endpoint rejects redirects and sanitizes failed responses', async () => {
  let calls = 0;
  const transport = createSanhouseTransport({
    credentialRef: 'secret/jev',
    resolveSecret: async (ref) => {
      assert.equal(ref, 'secret/jev');
      return 'fixture-key';
    },
    fetcher: async (url, init) => {
      calls++;
      assert.equal(url, 'https://jev.sanhouse.kr/v1/decisions');
      assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-key');
      return new Response(JSON.stringify(observed));
    },
  });
  const request = { state: { candidates }, instruction: 'Choose', options: ['a', 'b'] };
  assert.deepEqual(await transport(request, new AbortController().signal), observed);
  assert.equal(calls, 1);
  const failure = createSanhouseTransport({
    credentialRef: 'secret/jev',
    resolveSecret: async () => undefined,
    fetcher: async () => {
      throw new Error('unexpected');
    },
  });
  await assert.rejects(failure(request, new AbortController().signal), {
    message: 'Jev decision unavailable',
  });
});
