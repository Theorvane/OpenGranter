import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatRequest } from '../src/gateway/chat-handler.ts';
import { createDirectOpenAIFunctionStreamInvoker } from '../src/providers/direct-openai-function-stream.ts';
import { createDirectOpenAITextStreamInvoker } from '../src/providers/direct-openai-stream.ts';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';

const registration = {
  providerId: 'openai',
  kind: 'openai' as const,
  credentialRef: 'secret/openai',
  maxOutputTokens: 50,
};
const candidate = {
  id: 'one',
  kind: 'managed' as const,
  providerId: 'openai',
  upstreamModelId: 'native',
};
const tools = [
  { type: 'function' as const, function: { name: 'lookup', parameters: { type: 'object' } } },
];
const chat: ChatRequest = {
  model: 'alias',
  messages: [{ role: 'user', content: 'private prompt' }],
  tools,
  tool_choice: 'required',
  parallel_tool_calls: true,
  max_tokens: 100,
};
const frame = (delta: unknown, finish: string | null = null, extra = {}) =>
  `data: ${JSON.stringify({ id: 's', object: 'chat.completion.chunk', created: 4, model: 'native', choices: [{ index: 0, delta, finish_reason: finish }], usage: null, ...extra })}\n\n`;
const response = () =>
  new Response(
    frame({
      tool_calls: [
        {
          index: 0,
          id: 'call',
          type: 'function',
          function: { name: 'lookup', arguments: '{"q":"private"}' },
        },
      ],
    }) +
      frame({}, 'tool_calls') +
      frame({}, null, {
        choices: [],
        usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
      }) +
      'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  );

test('native function invoker prepares fixed-host tools and snapshots scope before secrets', async () => {
  const c = { ...candidate };
  const r = {
    ...chat,
    model: 'alias',
    messages: [{ role: 'user' as const, content: 'private prompt' }],
  };
  let calls = 0;
  const invoke = createDirectOpenAIFunctionStreamInvoker({
    registrations: [registration],
    resolveSecret: async () => {
      c.upstreamModelId = 'changed';
      r.model = 'changed';
      r.messages[0]!.content = 'changed';
      return 'fixture-key';
    },
    fetcher: async (url, init) => {
      calls++;
      assert.equal(String(url), 'https://api.openai.com/v1/chat/completions');
      assert.equal(init?.redirect, 'error');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, 'native');
      assert.equal(body.messages[0].content, 'private prompt');
      assert.deepEqual(body.tools, tools);
      assert.equal(body.tool_choice, 'required');
      assert.equal(body.parallel_tool_calls, true);
      assert.equal(body.max_tokens, 50);
      assert.equal(body.stream, true);
      assert.deepEqual(body.stream_options, { include_usage: true });
      return response();
    },
  });
  const result = await invoke(c, r, () => {});
  assert.equal(result.model, 'alias');
  assert.equal(result.toolCalls?.[0]?.id, 'call');
  assert.equal(calls, 1);
});
test('native function invoker forwards validated call/result history', async () => {
  const invoke = createDirectOpenAIFunctionStreamInvoker({
    registrations: [registration],
    resolveSecret: async () => 'fixture-key',
    fetcher: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.messages[1].tool_calls[0].id, 'call');
      assert.equal(body.messages[2].tool_call_id, 'call');
      return response();
    },
  });
  await invoke(
    candidate,
    {
      ...chat,
      messages: [
        ...chat.messages,
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'call', content: 'private result' },
      ],
    },
    () => {},
  );
});
for (const kind of ['anthropic', 'google'] as const)
  test(`native function invoker rejects ${kind} before secrets`, async () => {
    let secrets = 0;
    const invoke = createDirectOpenAIFunctionStreamInvoker({
      registrations: [{ ...registration, kind }],
      resolveSecret: async () => {
        secrets++;
        return 'fixture-key';
      },
    });
    await assert.rejects(
      invoke(candidate, chat, () => {}),
      DirectProviderFailure,
    );
    assert.equal(secrets, 0);
  });
test('existing native text invoker continues to reject function controls before secrets', async () => {
  let secrets = 0;
  const invoke = createDirectOpenAITextStreamInvoker({
    registrations: [registration],
    resolveSecret: async () => {
      secrets++;
      return 'fixture-key';
    },
  });
  await assert.rejects(
    invoke(candidate, chat, () => {}),
    DirectProviderFailure,
  );
  assert.equal(secrets, 0);
});
for (const [status, category] of [
  [429, 'rate-limit'],
  [503, 'server-error'],
  [401, 'other'],
] as const)
  test(`native function invoker classifies HTTP ${status}`, async () => {
    const invoke = createDirectOpenAIFunctionStreamInvoker({
      registrations: [registration],
      resolveSecret: async () => 'fixture-key',
      fetcher: async () => new Response('private failure', { status }),
    });
    await assert.rejects(
      invoke(candidate, chat, () => {}),
      (error) =>
        error instanceof DirectProviderFailure &&
        error.category === category &&
        error.possiblyBilled &&
        !String(error).includes('private'),
    );
  });
test('native function invoker marks missing credential as unbilled before upstream', async () => {
  const invoke = createDirectOpenAIFunctionStreamInvoker({
    registrations: [registration],
    resolveSecret: async () => undefined,
    fetcher: async () => {
      assert.fail('unexpected upstream');
    },
  });
  await assert.rejects(
    invoke(candidate, chat, () => {}),
    (error) =>
      error instanceof DirectProviderFailure && !error.possiblyBilled && !error.responseStarted,
  );
});
test('native function invoker rejects pre-abort before secret lookup', async () => {
  const cancellation = new AbortController();
  cancellation.abort();
  let secrets = 0;
  const invoke = createDirectOpenAIFunctionStreamInvoker({
    registrations: [registration],
    resolveSecret: async () => {
      secrets++;
      return 'fixture-key';
    },
  });
  await assert.rejects(
    invoke(candidate, chat, () => {}, cancellation.signal),
    DirectProviderFailure,
  );
  assert.equal(secrets, 0);
});
test('native function invoker times out a hanging opened stream without content exposure', {
  timeout: 3000,
}, async () => {
  const keepalive = setTimeout(() => {}, 3000);
  try {
    let cancelled = false;
    const invoke = createDirectOpenAIFunctionStreamInvoker({
      registrations: [registration],
      timeoutMs: 20,
      resolveSecret: async () => 'fixture-key',
      fetcher: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    });
    await assert.rejects(
      invoke(candidate, chat, () => {}),
      (error) =>
        error instanceof DirectProviderFailure &&
        error.category === 'timeout' &&
        error.possiblyBilled &&
        error.responseStarted,
    );
    assert.equal(cancelled, true);
  } finally {
    clearTimeout(keepalive);
  }
});
