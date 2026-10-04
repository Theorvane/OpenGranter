import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatRequest } from '../src/gateway/chat-handler.ts';
import type { DirectChatPorts } from '../src/providers/direct-chat.ts';
import { createDirectGoogleTextStreamInvoker } from '../src/providers/direct-google-stream.ts';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';

const registration = {
  providerId: 'google',
  kind: 'google' as const,
  credentialRef: 'secret/google',
  maxOutputTokens: 50,
};
const candidate = () => ({
  id: 'candidate',
  kind: 'managed' as const,
  providerId: 'google',
  upstreamModelId: 'gemini-exact',
});
const request = () => ({
  model: 'chat',
  messages: [{ role: 'user' as const, content: 'private prompt' }],
  max_tokens: 100,
});
const frame = (delta: object, _finish: string | null = null, extra = {}) =>
  'data: ' +
  JSON.stringify({
    responseId: 'response',
    modelVersion: 'model' in extra ? extra.model : 'gemini-exact',
    candidates: [
      {
        index: 0,
        content: {
          role: 'model',
          parts: [{ text: 'content' in delta ? delta.content : 'private answer' }],
        },
      },
    ],
  }) +
  '\n\n';
const ending = (
  usage: unknown = { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 },
) =>
  'data: ' +
  JSON.stringify({
    responseId: 'response',
    modelVersion: 'gemini-exact',
    candidates: [{ index: 0, finishReason: 'STOP' }],
    usageMetadata: usage,
  }) +
  '\n\n';
const response = (value = frame({ content: 'private answer' }) + ending()) =>
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
  const invoke = createDirectGoogleTextStreamInvoker(
    ports({
      resolveSecret: async (ref) => {
        assert.equal(ref, 'secret/google');
        c.upstreamModelId = 'unapproved';
        r.model = 'changed';
        const first = r.messages[0];
        assert.ok(first);
        first.content = 'changed';
        return 'private-key';
      },
      fetcher: async (url, init) => {
        assert.equal(
          String(url),
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-exact:streamGenerateContent?alt=sse',
        );
        assert.equal(init?.redirect, 'error');
        assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'private-key');
        assert.equal(new Headers(init?.headers).get('anthropic-version'), null);
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
  assert.equal(body?.model, undefined);
  assert.equal((body?.generationConfig as { maxOutputTokens: number })?.maxOutputTokens, 50);
  assert.equal(body?.stream, undefined);
  assert.equal(body?.stream_options, undefined);
  assert.ok(JSON.stringify(body).includes('private prompt'));
  assert.ok(JSON.stringify(deltas).includes('private answer'));
  assert.ok(!JSON.stringify(result).includes('private'));
});
for (const kind of ['openai', 'anthropic'] as const)
  test(`native invoker rejects ${kind} before credentials`, async () => {
    let secrets = 0;
    const invoke = createDirectGoogleTextStreamInvoker(
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
    const invoke = createDirectGoogleTextStreamInvoker(
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
    const invoke = createDirectGoogleTextStreamInvoker(
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
for (const suffix of ['data: {"type":"error","error":{"message":"private upstream key"}}\n\n', ''])
  test('partial or incomplete native stream fails safely without terminal success', async () => {
    const seen: unknown[] = [];
    const invoke = createDirectGoogleTextStreamInvoker(
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
  const invoke = createDirectGoogleTextStreamInvoker(
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
  const invoke = createDirectGoogleTextStreamInvoker(ports());
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
    const invoke = createDirectGoogleTextStreamInvoker(
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
  const invoke = createDirectGoogleTextStreamInvoker(
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
  const invoke = createDirectGoogleTextStreamInvoker(
    ports({
      fetcher: async () =>
        response(frame({ content: 'private answer' }, null, { model: 'gemini-other' }) + ending()),
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
