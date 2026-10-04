import assert from 'node:assert/strict';
import test from 'node:test';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';
import {
  consumeDirectOpenAITextResponse,
  decodeDirectOpenAITextPayload,
} from '../src/streaming/direct-openai-text-response.ts';

const scope = () => ({ upstreamModelId: 'gpt-exact', clientModelAlias: 'chat' });
const chunk = (delta: object, finish: string | null = null, usage: unknown = null) => ({
  id: 'gen',
  object: 'chat.completion.chunk',
  created: 42,
  model: 'gpt-exact',
  choices: [{ index: 0, delta, finish_reason: finish, logprobs: null }],
  usage,
});
const usage = (value: unknown = { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }) => ({
  ...chunk({}),
  choices: [],
  usage: value,
});
const frame = (value: object) => `data: ${JSON.stringify(value)}\n\n`;
const complete = () =>
  frame(chunk({ role: 'assistant', content: 'private text' })) +
  frame(chunk({}, 'stop')) +
  frame(usage()) +
  'data: [DONE]\n\n';
const response = (text = complete()) =>
  new Response(text, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
const safe = (error: unknown) =>
  error instanceof DirectProviderFailure &&
  error.responseStarted &&
  error.possiblyBilled &&
  error.message === 'Direct provider attempt failed';

test('native ordinary usage:null stays a delta and projects only the approved alias', () => {
  const decoded = decodeDirectOpenAITextPayload(
    JSON.stringify({
      ...chunk({ role: 'assistant', content: 'private text' }),
      obfuscation: 'padding',
    }),
    scope(),
  );
  assert.equal(decoded.kind, 'delta');
  assert.ok(decoded.kind === 'delta');
  assert.equal(decoded.content, 'private text');
  assert.equal(decoded.model, 'chat');
  assert.ok(!JSON.stringify(decoded).includes('padding'));
});
test('native terminal then empty-choice usage and DONE produces a content-free completion', async () => {
  const deltas: unknown[] = [];
  const result = await consumeDirectOpenAITextResponse(response(), scope(), (delta) => {
    deltas.push(delta);
  });
  assert.equal(deltas.length, 2);
  assert.equal(result.model, 'chat');
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.usage?.total_tokens, 5);
  assert.ok(!JSON.stringify(result).includes('private text'));
  assert.ok(Object.isFrozen(result));
});
for (const [value, expected] of [
  [null, undefined],
  [{}, undefined],
  [{ prompt_tokens: 2 }, { prompt_tokens: 2 }],
  [
    { prompt_tokens: -1, completion_tokens: 3, total_tokens: 2 },
    { prompt_tokens: null, completion_tokens: 3, total_tokens: 2 },
  ],
] as const)
  test('present final usage preserves known counters and unavailable/invalid values without fabrication', async () => {
    const result = await consumeDirectOpenAITextResponse(
      response(
        frame(chunk({ content: 'text' })) +
          frame(chunk({}, 'stop')) +
          frame(usage(value)) +
          'data: [DONE]\n\n',
      ),
      scope(),
      () => {},
    );
    assert.deepEqual(result.usage, expected);
  });
for (const delta of [
  { tool_calls: [] },
  { function_call: null },
  { reasoning: null },
  { reasoning_details: [] },
  { audio: null },
])
  test(`native text decoder rejects unsupported ${Object.keys(delta)[0]}`, () => {
    assert.throws(() => decodeDirectOpenAITextPayload(JSON.stringify(chunk(delta)), scope()), {
      message: 'Invalid direct OpenAI stream chunk',
    });
  });
for (const variant of [
  { ...chunk({ content: 'text' }), model: 'gpt-other' },
  {
    ...chunk({}),
    choices: [{ index: 0, delta: {}, finish_reason: null, native_finish_reason: 'stop' }],
  },
  chunk({ content: 'text' }, null, { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }),
  {
    ...chunk({}),
    choices: [
      { index: 0, delta: {}, finish_reason: 'stop' },
      { index: 1, delta: {}, finish_reason: 'stop' },
    ],
  },
])
  test('malformed or outside-subset native chunks reject safely', () => {
    assert.throws(() => decodeDirectOpenAITextPayload(JSON.stringify(variant), scope()), {
      message: 'Invalid direct OpenAI stream chunk',
    });
  });
for (const text of [
  frame(chunk({})) + frame(chunk({}, 'stop')) + 'data: [DONE]\n\n',
  frame(chunk({})) + frame(usage()) + 'data: [DONE]\n\n',
  frame(chunk({})) + frame(chunk({}, 'stop')) + frame(usage()),
  frame(chunk({})) +
    frame(chunk({}, 'stop')) +
    frame(usage()) +
    frame(usage()) +
    'data: [DONE]\n\n',
  frame(chunk({ content: 'partial' })) + frame({ error: { message: 'private key' } }),
])
  test('incomplete, misordered, duplicate or error sequences fail without response content', async () => {
    await assert.rejects(
      consumeDirectOpenAITextResponse(response(text), scope(), () => {}),
      safe,
    );
  });
for (const [status, category] of [
  [429, 'rate-limit'],
  [503, 'server-error'],
  [400, 'other'],
] as const)
  test(`native HTTP ${status} rejects without reading failure content`, async () => {
    let pulled = 0,
      cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull() {
        pulled++;
      },
      cancel() {
        cancelled = true;
      },
    });
    await assert.rejects(
      consumeDirectOpenAITextResponse(new Response(body, { status }), scope(), () => {}),
      (error: unknown) =>
        safe(error) && error instanceof DirectProviderFailure && error.category === category,
    );
    assert.equal(pulled, 0);
    assert.equal(cancelled, true);
  });
test('native body/media type and malformed UTF-8 failures remain fixed', async () => {
  for (const value of [
    new Response('private key'),
    new Response(null, { headers: { 'content-type': 'text/event-stream' } }),
    new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'text/event-stream' } }),
  ])
    await assert.rejects(
      consumeDirectOpenAITextResponse(value, scope(), () => {}),
      safe,
    );
});
test('native consumer awaits callbacks and captures scope before caller mutation', async () => {
  const captured = scope();
  let calls = 0,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const operation = consumeDirectOpenAITextResponse(response(), captured, async () => {
    calls++;
    if (calls === 1) {
      captured.upstreamModelId = 'changed';
      captured.clientModelAlias = 'changed';
      await gate;
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls, 1);
  release();
  assert.equal((await operation).model, 'chat');
  assert.equal(calls, 2);
});
test('callback failure and aborted pending delivery cancel safely', async () => {
  await assert.rejects(
    consumeDirectOpenAITextResponse(response(), scope(), () => {
      throw Error('private key');
    }),
    safe,
  );
  const controller = new AbortController();
  await assert.rejects(
    consumeDirectOpenAITextResponse(
      response(),
      scope(),
      () => {
        controller.abort('private reason');
        return new Promise(() => {});
      },
      controller.signal,
    ),
    safe,
  );
});
test('native refusal remains response content and finishes as content_filter', async () => {
  const seen: unknown[] = [];
  const result = await consumeDirectOpenAITextResponse(
    response(
      frame(chunk({ role: 'assistant', content: null, refusal: 'private refusal' })) +
        frame(chunk({}, 'content_filter')) +
        frame(usage()) +
        'data: [DONE]\n\n',
    ),
    scope(),
    (delta) => {
      seen.push(delta);
    },
  );
  assert.equal(result.finishReason, 'content_filter');
  assert.ok(JSON.stringify(seen).includes('private refusal'));
  assert.ok(!JSON.stringify(result).includes('private refusal'));
});

test('created identity cannot change between native chunks', async () => {
  const changed = { ...chunk({}, 'stop'), created: 43 };
  await assert.rejects(
    consumeDirectOpenAITextResponse(
      response(
        frame(chunk({ content: 'text' })) + frame(changed) + frame(usage()) + 'data: [DONE]\n\n',
      ),
      scope(),
      () => {},
    ),
    safe,
  );
});
