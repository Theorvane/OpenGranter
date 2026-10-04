import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatRequest } from '../src/gateway/chat-handler.ts';
import { createDirectAnthropicFunctionStreamInvoker } from '../src/providers/direct-anthropic-function-stream.ts';
import type { DirectChatPorts } from '../src/providers/direct-chat.ts';
import { createRegisteredDirectFunctionStreamInvoker } from '../src/providers/direct-function-stream.ts';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';
import { frames, native } from './anthropic-function-stream-fixture.ts';

const registration = {
  providerId: 'anthropic',
  kind: 'anthropic' as const,
  credentialRef: 'secret/anthropic',
  maxOutputTokens: 50,
};
const candidate = () => ({
  id: 'candidate',
  kind: 'managed' as const,
  providerId: 'anthropic',
  upstreamModelId: 'claude-exact',
});
const request = () => ({
  model: 'chat',
  messages: [{ role: 'user' as const, content: 'private prompt' }],
  max_tokens: 100,
});
const frame = (delta: object, finish: string | null = null, extra = {}) => {
  const model = 'model' in extra ? extra.model : 'claude-exact';
  return (
    'data: ' +
    JSON.stringify({
      type: 'message_start',
      message: {
        id: 'msg',
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 2, output_tokens: 1 },
      },
    }) +
    '\n\n' +
    'data: ' +
    JSON.stringify({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }) +
    '\n\n' +
    'data: ' +
    JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'content' in delta ? delta.content : 'private answer' },
    }) +
    '\n\n' +
    'data: ' +
    JSON.stringify({ type: 'content_block_stop', index: 0 }) +
    '\n\n'
  );
};
const ending = (usage: unknown = { output_tokens: 3 }) =>
  'data: ' +
  JSON.stringify({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage,
  }) +
  '\n\n' +
  'data: {"type":"message_stop"}\n\n';
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
  const invoke = createDirectAnthropicFunctionStreamInvoker(
    ports({
      resolveSecret: async (ref) => {
        assert.equal(ref, 'secret/anthropic');
        c.upstreamModelId = 'unapproved';
        r.model = 'changed';
        const first = r.messages[0];
        assert.ok(first);
        first.content = 'changed';
        return 'private-key';
      },
      fetcher: async (url, init) => {
        assert.equal(String(url), 'https://api.anthropic.com/v1/messages');
        assert.equal(init?.redirect, 'error');
        assert.equal(new Headers(init?.headers).get('x-api-key'), 'private-key');
        assert.equal(new Headers(init?.headers).get('anthropic-version'), '2023-06-01');
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
  assert.equal(body?.model, 'claude-exact');
  assert.equal(body?.max_tokens, 50);
  assert.equal(body?.stream, true);
  assert.equal(body?.stream_options, undefined);
  assert.ok(JSON.stringify(body).includes('private prompt'));
  assert.ok(JSON.stringify(deltas).includes('private answer'));
  assert.ok(!JSON.stringify(result).includes('private'));
});
for (const kind of ['openai', 'google'] as const)
  test(`native invoker rejects ${kind} before credentials`, async () => {
    let secrets = 0;
    const invoke = createDirectAnthropicFunctionStreamInvoker(
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
  { tools: [{ type: 'function', function: { name: 'read', parameters: { type: 'array' } } }] },
  { tool_choice: { type: 'function', function: { name: 'bad.name' } } },
  { reasoning: { effort: 'low' } },
])
  test(`unsupported ${Object.keys(extra)[0]} fails before key lookup`, async () => {
    let secrets = 0;
    const invoke = createDirectAnthropicFunctionStreamInvoker(
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
    const invoke = createDirectAnthropicFunctionStreamInvoker(
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
    const invoke = createDirectAnthropicFunctionStreamInvoker(
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
  const invoke = createDirectAnthropicFunctionStreamInvoker(
    ports({ fetcher: async () => response(frame({ content: 'answer' }) + ending(null)) }),
  );
  assert.deepEqual((await invoke(candidate(), request(), () => {})).usage, { prompt_tokens: 2 });
});
test('native invoker awaits backpressure and reports callback cancellation safely', async () => {
  let release!: () => void,
    calls = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const invoke = createDirectAnthropicFunctionStreamInvoker(ports());
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
    const invoke = createDirectAnthropicFunctionStreamInvoker(
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
  const invoke = createDirectAnthropicFunctionStreamInvoker(
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
  const invoke = createDirectAnthropicFunctionStreamInvoker(
    ports({
      fetcher: async () =>
        response(frame({ content: 'private answer' }, null, { model: 'claude-other' }) + ending()),
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

test('registered Anthropic function dispatcher snapshots controls scope and registration before secrets', async () => {
  const c = candidate(),
    registrations = [{ ...registration }],
    schema = { type: 'object', properties: { q: { type: 'string' } } };
  const r = {
    ...request(),
    tools: [{ type: 'function' as const, function: { name: 'lookup', parameters: schema } }],
    tool_choice: 'required' as const,
    parallel_tool_calls: true,
  };
  const invoker = createRegisteredDirectFunctionStreamInvoker({
    registrations,
    resolveSecret: async (ref) => {
      assert.equal(ref, 'secret/anthropic');
      c.upstreamModelId = 'changed';
      r.model = 'changed';
      schema.type = 'array';
      registrations[0]!.credentialRef = 'changed';
      return 'fixture-key';
    },
    fetcher: async (url, init) => {
      assert.equal(String(url), 'https://api.anthropic.com/v1/messages');
      assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).get('x-api-key'), 'fixture-key');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, 'claude-exact');
      assert.equal(body.stream, true);
      assert.equal(body.max_tokens, 50);
      assert.deepEqual(body.tool_choice, { type: 'any', disable_parallel_tool_use: false });
      assert.equal(body.tools[0].input_schema.type, 'object');
      return new Response(frames(native()), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  registrations[0]!.credentialRef = 'changed-before-call';
  const result = await invoker(c, r, () => {});
  assert.equal(result.model, 'chat');
  assert.equal(result.toolCalls?.length, 2);
});
for (const kind of ['google', 'unknown'] as const)
  test(`generic function dispatcher rejects ${kind} unsupported inputs without credentials`, async () => {
    let keys = 0;
    const invoker = createRegisteredDirectFunctionStreamInvoker({
      registrations: kind === 'unknown' ? [] : [{ ...registration, kind: 'google' }],
      resolveSecret: async () => {
        keys++;
        return 'fixture';
      },
      fetcher: async () => {
        assert.fail('unexpected inference');
      },
    });
    await assert.rejects(
      invoker(
        candidate(),
        kind === 'google'
          ? {
              ...request(),
              tools: [{ type: 'function', function: { name: 'lookup', strict: true } }],
            }
          : request(),
        () => {},
      ),
      (error) =>
        error instanceof DirectProviderFailure && !error.possiblyBilled && !error.responseStarted,
    );
    assert.equal(keys, 0);
  });
