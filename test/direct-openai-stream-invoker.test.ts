import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatRequest } from '../src/gateway/chat-handler.ts';
import type { DirectChatPorts } from '../src/providers/direct-chat.ts';
import { createDirectOpenAITextStreamInvoker } from '../src/providers/direct-openai-stream.ts';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';

const registration = {
  providerId: 'openai',
  kind: 'openai' as const,
  credentialRef: 'secret/openai',
  maxOutputTokens: 50,
};
const candidate = () => ({
  id: 'candidate',
  kind: 'managed' as const,
  providerId: 'openai',
  upstreamModelId: 'gpt-exact',
});
const request = () => ({
  model: 'chat',
  messages: [{ role: 'user' as const, content: 'private prompt' }],
  max_tokens: 100,
});
const frame = (delta: object, finish: string | null = null, extra = {}) =>
  `data: ${JSON.stringify({ id: 'gen', object: 'chat.completion.chunk', created: 42, model: 'gpt-exact', choices: [{ index: 0, delta, finish_reason: finish }], usage: null, ...extra })}\n\n`;
const ending = (usage: unknown = { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }) =>
  frame({}, 'stop') + frame({}, null, { choices: [], usage }) + 'data: [DONE]\n\n';
const response = (value = frame({ role: 'assistant', content: 'private answer' }) + ending()) =>
  new Response(value, { headers: { 'content-type': 'text/event-stream' } });
function ports(extra: Partial<DirectChatPorts> = {}): DirectChatPorts {
  return {
    registrations: [registration],
    resolveSecret: async () => 'private-key',
    fetcher: async () => response(),
    ...extra,
  };
}
const safe = (error: unknown) =>
  error instanceof DirectProviderFailure && error.message === 'Direct provider attempt failed';

test('direct native invoker composes fixed-host preparation, text/refusal delivery and scoped completion', async () => {
  const c = candidate(),
    r = request();
  let body: Record<string, unknown> | undefined;
  const deltas: unknown[] = [];
  const invoke = createDirectOpenAITextStreamInvoker(
    ports({
      resolveSecret: async (ref) => {
        assert.equal(ref, 'secret/openai');
        c.upstreamModelId = 'unapproved';
        r.model = 'changed';
        const first = r.messages[0];
        assert.ok(first);
        first.content = 'changed';
        return 'private-key';
      },
      fetcher: async (url, init) => {
        assert.equal(String(url), 'https://api.openai.com/v1/chat/completions');
        assert.equal(init?.redirect, 'error');
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer private-key');
        body = JSON.parse(String(init?.body));
        return response();
      },
    }),
  );
  const result = await invoke(c, r, (delta) => {
    deltas.push(delta);
  });
  assert.equal(result.model, 'chat');
  assert.equal(result.usage?.total_tokens, 5);
  assert.equal(body?.model, 'gpt-exact');
  assert.equal(body?.max_tokens, 50);
  assert.deepEqual(body?.stream_options, { include_usage: true });
  assert.ok(JSON.stringify(body).includes('private prompt'));
  assert.ok(JSON.stringify(deltas).includes('private answer'));
  assert.ok(!JSON.stringify(result).includes('private'));
});
for (const kind of ['anthropic', 'google'] as const)
  test(`native invoker rejects ${kind} before credentials`, async () => {
    let secrets = 0;
    const invoke = createDirectOpenAITextStreamInvoker(
      ports({
        registrations: [{ ...registration, kind }],
        resolveSecret: async () => {
          secrets++;
          return 'key';
        },
      }),
    );
    await assert.rejects(
      invoke(candidate(), request(), () => {}),
      safe,
    );
    assert.equal(secrets, 0);
  });
for (const extra of [
  { tools: [{ type: 'function', function: { name: 'read', parameters: { type: 'object' } } }] },
  { tool_choice: 'none' },
  { reasoning: { effort: 'low' } },
])
  test(`unsupported ${Object.keys(extra)[0]} fails before key lookup`, async () => {
    let secrets = 0;
    const invoke = createDirectOpenAITextStreamInvoker(
      ports({
        resolveSecret: async () => {
          secrets++;
          return 'key';
        },
      }),
    );
    await assert.rejects(
      invoke(candidate(), { ...request(), ...extra } as ChatRequest, () => {}),
      safe,
    );
    assert.equal(secrets, 0);
  });
for (const [status, category] of [
  [429, 'rate-limit'],
  [503, 'server-error'],
  [400, 'other'],
] as const)
  test(`native HTTP ${status} retains category and prevents replay`, async () => {
    let attempts = 0;
    const invoke = createDirectOpenAITextStreamInvoker(
      ports({
        fetcher: async () => {
          attempts++;
          return new Response('private failure', { status });
        },
      }),
    );
    await assert.rejects(
      invoke(candidate(), request(), () => {}),
      (error: unknown) =>
        safe(error) &&
        error instanceof DirectProviderFailure &&
        error.category === category &&
        error.responseStarted &&
        error.possiblyBilled,
    );
    assert.equal(attempts, 1);
  });
for (const suffix of ['data: {"error":{"message":"private upstream key"}}\n\n', ''])
  test('partial or incomplete native stream fails safely without terminal success', async () => {
    const seen: unknown[] = [];
    const invoke = createDirectOpenAITextStreamInvoker(
      ports({ fetcher: async () => response(frame({ content: 'private partial' }) + suffix) }),
    );
    await assert.rejects(
      invoke(candidate(), request(), (delta) => {
        seen.push(delta);
      }),
      (error: unknown) =>
        safe(error) &&
        error instanceof DirectProviderFailure &&
        error.responseStarted &&
        error.possiblyBilled,
    );
    assert.ok(JSON.stringify(seen).includes('private partial'));
  });
test('native invoker preserves unavailable final usage', async () => {
  const invoke = createDirectOpenAITextStreamInvoker(
    ports({ fetcher: async () => response(frame({ content: 'answer' }) + ending(null)) }),
  );
  assert.equal((await invoke(candidate(), request(), () => {})).usage, undefined);
});
test('native invoker awaits backpressure and reports callback cancellation safely', async () => {
  let release!: () => void,
    calls = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const invoke = createDirectOpenAITextStreamInvoker(ports());
  const operation = invoke(candidate(), request(), async () => {
    calls++;
    if (calls === 1) await gate;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls, 1);
  release();
  await operation;
  const controller = new AbortController();
  await assert.rejects(
    invoke(
      candidate(),
      request(),
      () => {
        controller.abort('private reason');
        return new Promise(() => {});
      },
      controller.signal,
    ),
    (error: unknown) =>
      safe(error) &&
      error instanceof DirectProviderFailure &&
      error.responseStarted &&
      error.possiblyBilled,
  );
});
test('native deadline interrupts an uncooperative body and cancels the reader', async () => {
  let cancelled = false;
  const keepalive = setTimeout(() => {}, 1000);
  try {
    const invoke = createDirectOpenAITextStreamInvoker(
      ports({
        timeoutMs: 20,
        fetcher: async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(frame({ content: 'partial' })));
              },
              cancel() {
                cancelled = true;
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      }),
    );
    await assert.rejects(
      invoke(candidate(), request(), () => {}),
      (error: unknown) =>
        safe(error) &&
        error instanceof DirectProviderFailure &&
        error.category === 'timeout' &&
        error.responseStarted &&
        error.possiblyBilled,
    );
    assert.equal(cancelled, true);
  } finally {
    clearTimeout(keepalive);
  }
});
test('pre-abort and secret failure remain unbilled before any inference', async () => {
  const controller = new AbortController();
  controller.abort();
  let secrets = 0,
    attempts = 0;
  const invoke = createDirectOpenAITextStreamInvoker(
    ports({
      resolveSecret: async () => {
        secrets++;
        throw Error('private secret');
      },
      fetcher: async () => {
        attempts++;
        return response();
      },
    }),
  );
  for (const signal of [controller.signal, undefined])
    await assert.rejects(
      invoke(candidate(), request(), () => {}, signal),
      (error: unknown) =>
        safe(error) &&
        error instanceof DirectProviderFailure &&
        !error.responseStarted &&
        !error.possiblyBilled,
    );
  assert.equal(secrets, 1);
  assert.equal(attempts, 0);
});
test('native scope mismatch rejects after response start without widened model authority', async () => {
  const invoke = createDirectOpenAITextStreamInvoker(
    ports({
      fetcher: async () =>
        response(frame({ content: 'private answer' }, null, { model: 'gpt-other' }) + ending()),
    }),
  );
  let delivered = 0;
  await assert.rejects(
    invoke(candidate(), request(), () => {
      delivered++;
    }),
    (error: unknown) =>
      safe(error) &&
      error instanceof DirectProviderFailure &&
      error.responseStarted &&
      error.possiblyBilled,
  );
  assert.equal(delivered, 0);
});
