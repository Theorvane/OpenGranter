import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';

const request = {
  model: 'chat',
  messages: [
    { role: 'system' as const, content: 'Be brief' },
    { role: 'user' as const, content: 'Hello' },
  ],
};
const candidate = {
  id: 'one',
  kind: 'managed' as const,
  providerId: 'provider-1',
  upstreamModelId: 'upstream-model',
};

function setup(kind: 'openai' | 'anthropic' | 'google', response: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const invoker = createDirectChatInvoker({
    registrations: [
      { providerId: 'provider-1', kind, credentialRef: 'secret/provider', maxOutputTokens: 256 },
    ],
    resolveSecret: async (ref) => {
      assert.equal(ref, 'secret/provider');
      return 'sensitive-key';
    },
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(response), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  return { invoker, calls };
}

test('OpenAI direct chat uses fixed endpoint and normalizes completion', async () => {
  const { invoker, calls } = setup('openai', {
    id: 'up-1',
    created: 123,
    choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
  const result = await invoker(candidate, request);
  assert.equal(calls[0]?.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0]?.init.redirect, 'error');
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    model: 'upstream-model',
    messages: request.messages,
    stream: false,
  });
  assert.equal(new Headers(calls[0]?.init.headers).get('authorization'), 'Bearer sensitive-key');
  assert.equal(result.model, 'chat');
  assert.equal(result.choices[0]?.message.content, 'Hi');
  assert.deepEqual(result.usage, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
  assert.equal(JSON.stringify(result).includes('sensitive-key'), false);
});

test('Anthropic direct chat translates system and usage', async () => {
  const { invoker, calls } = setup('anthropic', {
    id: 'msg-1',
    content: [{ type: 'text', text: 'Hi' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 3, output_tokens: 2 },
  });
  const result = await invoker(candidate, request);
  assert.equal(calls[0]?.url, 'https://api.anthropic.com/v1/messages');
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    model: 'upstream-model',
    max_tokens: 256,
    system: 'Be brief',
    messages: [{ role: 'user', content: 'Hello' }],
  });
  assert.equal(new Headers(calls[0]?.init.headers).get('x-api-key'), 'sensitive-key');
  assert.equal(new Headers(calls[0]?.init.headers).get('anthropic-version'), '2023-06-01');
  assert.equal(result.choices[0]?.finish_reason, 'stop');
  assert.deepEqual(result.usage, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
});

test('Gemini direct chat translates roles and usage', async () => {
  const { invoker, calls } = setup('google', {
    candidates: [{ content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
  });
  const result = await invoker(candidate, request);
  assert.equal(
    calls[0]?.url,
    'https://generativelanguage.googleapis.com/v1beta/models/upstream-model:generateContent',
  );
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    systemInstruction: { parts: [{ text: 'Be brief' }] },
    contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
  });
  assert.equal(new Headers(calls[0]?.init.headers).get('x-goog-api-key'), 'sensitive-key');
  assert.deepEqual(result.usage, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
});

test('missing usage stays unknown and malformed success is not retryable', async () => {
  const good = setup('google', {
    candidates: [{ content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' }],
  });
  assert.equal((await good.invoker(candidate, request)).usage, undefined);
  const bad = setup('google', { candidates: [] });
  await assert.rejects(
    bad.invoker(candidate, request),
    (error: unknown) => error instanceof DirectProviderFailure && error.category === 'other',
  );
});

test('HTTP failures expose only safe category and never provider error body', async () => {
  for (const [status, category] of [
    [429, 'rate-limit'],
    [503, 'server-error'],
    [401, 'other'],
  ] as const) {
    const { invoker } = setup(
      'openai',
      { error: { message: 'sensitive-key upstream secret' } },
      status,
    );
    await assert.rejects(invoker(candidate, request), (error: unknown) => {
      assert.ok(error instanceof DirectProviderFailure);
      assert.equal(error.category, category);
      assert.equal(error.message.includes('sensitive-key'), false);
      return true;
    });
  }
});

test('network timeout and missing credential have safe classifications', async () => {
  const timeout = createDirectChatInvoker({
    registrations: [{ providerId: 'provider-1', kind: 'openai', credentialRef: 'secret/provider' }],
    resolveSecret: async () => 'key',
    fetcher: async () => {
      throw new DOMException('timed out', 'TimeoutError');
    },
  });
  await assert.rejects(
    timeout(candidate, request),
    (error: unknown) =>
      error instanceof DirectProviderFailure &&
      error.category === 'timeout' &&
      error.possiblyBilled,
  );
  const noSecret = createDirectChatInvoker({
    registrations: [{ providerId: 'provider-1', kind: 'openai', credentialRef: 'secret/provider' }],
    resolveSecret: async () => undefined,
  });
  await assert.rejects(
    noSecret(candidate, request),
    (error: unknown) => error instanceof DirectProviderFailure && error.category === 'other',
  );
});
