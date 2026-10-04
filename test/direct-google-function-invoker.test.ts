import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatRequest } from '../src/gateway/chat-handler.ts';
import { createRegisteredDirectFunctionStreamInvoker } from '../src/providers/direct-function-stream.ts';
import { createDirectGoogleFunctionStreamInvoker } from '../src/providers/direct-google-function-stream.ts';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';
import { frames, native } from './google-function-stream-fixture.ts';

const registration = {
  providerId: 'google',
  kind: 'google' as const,
  credentialRef: 'secret/google',
  maxOutputTokens: 50,
};
const candidate = () => ({
  id: 'one',
  kind: 'managed' as const,
  providerId: 'google',
  upstreamModelId: 'gemini-exact',
});
const request = () => ({
  model: 'chat',
  messages: [{ role: 'user' as const, content: 'private prompt' }],
  tools: [
    { type: 'function' as const, function: { name: 'lookup', parameters: { type: 'object' } } },
  ],
  tool_choice: 'required' as const,
  max_tokens: 100,
});
const response = () =>
  new Response(frames(native()), { headers: { 'content-type': 'text/event-stream' } });
const safe = (e: unknown) =>
  e instanceof DirectProviderFailure && e.message === 'Direct provider attempt failed';
test('Gemini registered function dispatcher freezes registration, scope, schemas and history before secrets', async () => {
  const c = candidate(),
    r = request(),
    registrations = [{ ...registration }];
  const invoke = createRegisteredDirectFunctionStreamInvoker({
    registrations,
    resolveSecret: async (ref) => {
      assert.equal(ref, 'secret/google');
      c.upstreamModelId = 'unapproved';
      r.model = 'changed';
      const tool = r.tools[0],
        message = r.messages[0];
      assert.ok(tool);
      assert.ok(message);
      tool.function.parameters.type = 'array';
      message.content = 'changed';
      return 'fixture-key';
    },
    fetcher: async (url, init) => {
      assert.equal(
        String(url),
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-exact:streamGenerateContent?alt=sse',
      );
      assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'fixture-key');
      assert.equal(init?.redirect, 'error');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, undefined);
      assert.equal(body.stream, undefined);
      assert.equal(body.stream_options, undefined);
      assert.deepEqual(body.generationConfig, {
        maxOutputTokens: 50,
        thinkingConfig: { thinkingBudget: 0 },
      });
      assert.equal(body.tools[0].functionDeclarations[0].parametersJsonSchema.type, 'object');
      assert.equal(body.contents[0].parts[0].text, 'private prompt');
      return response();
    },
  });
  const firstRegistration = registrations[0];
  assert.ok(firstRegistration);
  firstRegistration.credentialRef = 'changed';
  const result = await invoke(c, r, () => {});
  assert.equal(result.model, 'chat');
  assert.equal(result.toolCalls?.length, 2);
  assert.equal(result.usage?.total_tokens, 7);
});
for (const extra of [
  { tools: [{ type: 'function', function: { name: 'lookup', strict: true } }] },
  { parallel_tool_calls: false },
  { reasoning_effort: 'low' },
  { tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'array' } } }] },
])
  test('Gemini unsupported function stream controls fail before credentials', async () => {
    let keys = 0;
    const invoke = createDirectGoogleFunctionStreamInvoker({
      registrations: [registration],
      resolveSecret: async () => {
        keys++;
        return 'key';
      },
      fetcher: async () => assert.fail('unexpected inference'),
    });
    await assert.rejects(
      invoke(candidate(), { ...request(), ...extra } as ChatRequest, () => {}),
      safe,
    );
    assert.equal(keys, 0);
  });
for (const kind of ['openai', 'anthropic'] as const)
  test(`Gemini explicit function mode rejects ${kind} registration before keys`, async () => {
    let keys = 0;
    const invoke = createDirectGoogleFunctionStreamInvoker({
      registrations: [{ ...registration, kind }],
      resolveSecret: async () => {
        keys++;
        return 'key';
      },
    });
    await assert.rejects(
      invoke(candidate(), request(), () => {}),
      safe,
    );
    assert.equal(keys, 0);
  });
for (const [status, category] of [
  [429, 'rate-limit'],
  [503, 'server-error'],
  [400, 'other'],
] as const)
  test(`Gemini function HTTP ${status} fails once possibly billed`, async () => {
    let calls = 0;
    const invoke = createDirectGoogleFunctionStreamInvoker({
      registrations: [registration],
      resolveSecret: async () => 'key',
      fetcher: async () => {
        calls++;
        return new Response('private failure', { status });
      },
    });
    await assert.rejects(
      invoke(candidate(), request(), () => {}),
      (e) =>
        safe(e) &&
        e instanceof DirectProviderFailure &&
        e.possiblyBilled &&
        e.responseStarted &&
        e.category === category,
    );
    assert.equal(calls, 1);
  });
test('Gemini function deadline interrupts uncooperative native body and cancels reader', async () => {
  let cancelled = false;
  const keepalive = setTimeout(() => {}, 1000);
  try {
    const invoke = createDirectGoogleFunctionStreamInvoker({
      registrations: [registration],
      timeoutMs: 20,
      resolveSecret: async () => 'key',
      fetcher: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(new TextEncoder().encode(frames(native().slice(0, 1))));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    });
    await assert.rejects(
      invoke(candidate(), request(), () => {}),
      (e) =>
        safe(e) &&
        e instanceof DirectProviderFailure &&
        e.category === 'timeout' &&
        e.possiblyBilled,
    );
    assert.equal(cancelled, true);
  } finally {
    clearTimeout(keepalive);
  }
});
test('Gemini pre-abort and secret failure remain unbilled without upstream inference', async () => {
  const controller = new AbortController();
  controller.abort();
  let keys = 0,
    calls = 0;
  const invoke = createDirectGoogleFunctionStreamInvoker({
    registrations: [registration],
    resolveSecret: async () => {
      keys++;
      throw Error('private secret');
    },
    fetcher: async () => {
      calls++;
      return response();
    },
  });
  for (const signal of [controller.signal, undefined])
    await assert.rejects(
      invoke(candidate(), request(), () => {}, signal),
      (e) =>
        safe(e) && e instanceof DirectProviderFailure && !e.possiblyBilled && !e.responseStarted,
    );
  assert.equal(keys, 1);
  assert.equal(calls, 0);
});
