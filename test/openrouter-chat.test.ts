import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createOpenRouterChatInvoker,
  OpenRouterChatFailure,
} from '../src/providers/openrouter-chat.ts';

const request = {
  model: 'approved-chat',
  messages: [{ role: 'user' as const, content: 'Hello' }],
};
const attempt = {
  upstreamModelId: 'openai/gpt-4o',
  authorizedProviderSlugs: ['OpenAI', 'Azure'],
};
const responseBody = {
  id: 'generation-1',
  object: 'chat.completion',
  created: 123,
  model: 'openai/gpt-4o',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
};

function setup(options: { body?: unknown; status?: number; secret?: string } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const refs: string[] = [];
  const invoker = createOpenRouterChatInvoker({
    credentialRef: 'secret/openrouter',
    resolveSecret: async (ref) => {
      refs.push(ref);
      return options.secret === undefined ? 'sensitive-upstream-key' : options.secret;
    },
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(options.body ?? responseBody), {
        status: options.status ?? 200,
      });
    },
  });
  return { invoker, calls, refs };
}

test('bounded OpenRouter chat uses the fixed endpoint and exact authorized providers', async () => {
  const { invoker, calls, refs } = setup();
  const completion = await invoker(attempt, request);
  assert.deepEqual(refs, ['secret/openrouter']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[0]?.init.redirect, 'error');
  assert.equal(calls[0]?.init.method, 'POST');
  assert.equal(
    new Headers(calls[0]?.init.headers).get('authorization'),
    'Bearer sensitive-upstream-key',
  );
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    model: 'openai/gpt-4o',
    messages: request.messages,
    stream: false,
    provider: { only: ['OpenAI', 'Azure'] },
  });
  assert.equal(completion.id, 'generation-1');
  assert.equal(completion.model, 'approved-chat');
  assert.equal(completion.choices[0].message.content, 'Hi');
  assert.deepEqual(completion.usage, { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 });
  assert.equal(JSON.stringify(completion).includes('sensitive-upstream-key'), false);
});

test('invalid bounds or model fail before secret resolution and network access', async () => {
  const { invoker, calls, refs } = setup();
  for (const invalid of [
    { ...attempt, authorizedProviderSlugs: [] },
    { ...attempt, authorizedProviderSlugs: ['OpenAI', 'OpenAI'] },
    { ...attempt, authorizedProviderSlugs: ['OpenAI', ''] },
    { ...attempt, authorizedProviderSlugs: ['OpenAI\nX-Unsafe: yes'] },
    { ...attempt, upstreamModelId: '' },
    { ...attempt, upstreamModelId: 'openai/gpt-4o\nunsafe' },
  ]) {
    await assert.rejects(invoker(invalid, request), (error: unknown) => {
      assert.ok(error instanceof OpenRouterChatFailure);
      assert.equal(error.category, 'configuration');
      assert.equal(error.possiblyBilled, false);
      return true;
    });
  }
  assert.deepEqual(refs, []);
  assert.deepEqual(calls, []);
});

test('missing upstream credential and secret-store failure are safe', async () => {
  const missing = setup({ secret: '' });
  await assert.rejects(
    missing.invoker(attempt, request),
    (error: unknown) =>
      error instanceof OpenRouterChatFailure &&
      error.category === 'credential' &&
      !error.possiblyBilled,
  );
  assert.equal(missing.calls.length, 0);
  const failed = createOpenRouterChatInvoker({
    credentialRef: 'secret/openrouter',
    resolveSecret: async () => {
      throw new Error('sensitive-upstream-key');
    },
    fetcher: async () => {
      throw new Error('unexpected network call');
    },
  });
  await assert.rejects(failed(attempt, request), (error: unknown) => {
    assert.ok(error instanceof OpenRouterChatFailure);
    assert.equal(error.category, 'credential');
    assert.equal(error.message.includes('sensitive'), false);
    return true;
  });
});

test('invalid timeout configuration fails before resolving the credential', async () => {
  let resolved = false;
  const invoker = createOpenRouterChatInvoker({
    credentialRef: 'secret/openrouter',
    timeoutMs: -1,
    resolveSecret: async () => {
      resolved = true;
      return 'sensitive-upstream-key';
    },
    fetcher: async () => {
      throw new Error('unexpected network call');
    },
  });
  await assert.rejects(
    invoker(attempt, request),
    (error: unknown) =>
      error instanceof OpenRouterChatFailure && error.category === 'configuration',
  );
  assert.equal(resolved, false);
});

test('upstream HTTP errors and malformed success never expose provider bodies', async () => {
  for (const [status, category] of [
    [429, 'rate-limit'],
    [503, 'server-error'],
    [401, 'upstream'],
  ] as const) {
    const { invoker } = setup({ status, body: { error: { message: 'sensitive-upstream-key' } } });
    await assert.rejects(invoker(attempt, request), (error: unknown) => {
      assert.ok(error instanceof OpenRouterChatFailure);
      assert.equal(error.category, category);
      assert.equal(error.responseStarted, true);
      assert.equal(error.possiblyBilled, true);
      assert.equal(error.message.includes('sensitive'), false);
      return true;
    });
  }
  const malformed = setup({ body: { choices: [], error: 'sensitive-upstream-key' } });
  await assert.rejects(
    malformed.invoker(attempt, request),
    (error: unknown) =>
      error instanceof OpenRouterChatFailure &&
      error.category === 'upstream' &&
      error.responseStarted,
  );
  const wrongModel = setup({ body: { ...responseBody, model: 'unapproved/model' } });
  await assert.rejects(
    wrongModel.invoker(attempt, request),
    (error: unknown) =>
      error instanceof OpenRouterChatFailure &&
      error.category === 'upstream' &&
      error.responseStarted,
  );
});

test('timeout and redirect failures retain safe possible-billing classification', async () => {
  for (const networkError of [
    new DOMException('sensitive timeout', 'TimeoutError'),
    new Error('sensitive redirect'),
  ]) {
    let observedRedirect: RequestInit['redirect'];
    const invoker = createOpenRouterChatInvoker({
      credentialRef: 'secret/openrouter',
      resolveSecret: async () => 'sensitive-upstream-key',
      fetcher: async (_url, init) => {
        observedRedirect = init?.redirect;
        throw networkError;
      },
    });
    await assert.rejects(invoker(attempt, request), (error: unknown) => {
      assert.ok(error instanceof OpenRouterChatFailure);
      assert.equal(error.category, networkError instanceof DOMException ? 'timeout' : 'upstream');
      assert.equal(error.responseStarted, false);
      assert.equal(error.possiblyBilled, true);
      assert.equal(error.message.includes('sensitive'), false);
      return true;
    });
    assert.equal(observedRedirect, 'error');
  }
});

test('missing token usage remains unknown in the normalized response', async () => {
  const { invoker } = setup({ body: { ...responseBody, usage: undefined } });
  assert.equal((await invoker(attempt, request)).usage, undefined);
});
