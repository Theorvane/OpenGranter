import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createOpenRouterChatInvoker,
  OpenRouterChatFailure,
  type OpenRouterChatPorts,
} from '../src/providers/openrouter-chat.ts';

const attempt = { upstreamModelId: 'openai/gpt', authorizedProviderSlugs: ['OpenAI'] };
const request = { model: 'chat', messages: [{ role: 'user' as const, content: 'Hello' }] };
const completion = {
  id: 'generation',
  created: 100,
  model: 'openai/gpt',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
};

for (const initial of [undefined, 30_000]) {
  test(`retains ${initial === undefined ? 'default' : 'supplied'} timeout across secret lookup`, async () => {
    let secrets = 0;
    let fetches = 0;
    const ports: OpenRouterChatPorts & { timeoutMs?: number } = {
      credentialRef: 'fixture-ref',
      ...(initial === undefined ? {} : { timeoutMs: initial }),
      resolveSecret: async () => {
        secrets++;
        await Promise.resolve();
        ports.timeoutMs = -1;
        return 'fixture-key';
      },
      fetcher: async (_url, init) => {
        fetches++;
        assert.ok(init?.signal instanceof AbortSignal);
        assert.equal(init.signal.aborted, false);
        return Response.json(completion);
      },
    };
    const invoke = createOpenRouterChatInvoker(ports);
    assert.equal((await invoke(attempt, request)).choices[0].message.content, 'Hi');
    assert.equal(secrets, 1);
    assert.equal(fetches, 1);
    await assert.rejects(invoke(attempt, request), (error: unknown) => {
      assert.ok(error instanceof OpenRouterChatFailure);
      assert.equal(error.category, 'configuration');
      assert.equal(error.responseStarted, false);
      assert.equal(error.possiblyBilled, false);
      assert.equal(error.message, 'OpenRouter chat attempt failed');
      return true;
    });
    assert.equal(secrets, 1);
    assert.equal(fetches, 1);
  });
}

test('initially invalid delegated timeout performs no credential or network work', async () => {
  let calls = 0;
  const invoke = createOpenRouterChatInvoker({
    credentialRef: 'fixture-ref',
    timeoutMs: -1,
    resolveSecret: async () => {
      calls++;
      return 'fixture-key';
    },
    fetcher: async () => {
      calls++;
      return Response.json(completion);
    },
  });
  await assert.rejects(
    invoke(attempt, request),
    (error: unknown) =>
      error instanceof OpenRouterChatFailure &&
      error.category === 'configuration' &&
      !error.possiblyBilled &&
      !error.responseStarted,
  );
  assert.equal(calls, 0);
});
