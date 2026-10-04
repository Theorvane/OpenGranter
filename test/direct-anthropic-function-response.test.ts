import assert from 'node:assert/strict';
import test from 'node:test';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';
import { consumeDirectAnthropicFunctionResponse } from '../src/streaming/direct-anthropic-function-response.ts';
import {
  close,
  fragment,
  frames,
  native,
  start,
  stop,
  terminal,
  text,
  tool,
} from './anthropic-function-stream-fixture.ts';

const scope = { upstreamModelId: 'claude-exact', clientModelAlias: 'chat' };
const response = (events: readonly object[]) =>
  new Response(frames(events), { headers: { 'content-type': 'text/event-stream' } });
const consume = (events: readonly object[]) =>
  consumeDirectAnthropicFunctionResponse(response(events), scope, () => {}, undefined, 42);
const safe = (error: unknown) =>
  error instanceof DirectProviderFailure &&
  error.responseStarted &&
  error.possiblyBilled &&
  error.message === 'Direct provider attempt failed';
test('Anthropic function consumer maps dense calls independently of text block indices', async () => {
  const deltas: unknown[] = [];
  const result = await consumeDirectAnthropicFunctionResponse(
    response([
      start(),
      ...text(),
      tool(1),
      fragment(1, '{"q":'),
      fragment(1, '"private 終"}'),
      close(1),
      tool(2, 'call_two'),
      fragment(2, '{}'),
      close(2),
      terminal(),
      stop,
    ]),
    scope,
    (delta) => {
      deltas.push(delta);
    },
    undefined,
    42,
  );
  assert.equal(result.finishReason, 'tool_calls');
  assert.equal(result.model, 'chat');
  assert.equal(result.usage?.total_tokens, 5);
  assert.deepEqual(result.toolCalls, [
    {
      id: 'call_one',
      type: 'function',
      function: { name: 'lookup', arguments: '{"q":"private 終"}' },
    },
    { id: 'call_two', type: 'function', function: { name: 'lookup', arguments: '{}' } },
  ]);
  const serialized = JSON.stringify(deltas);
  assert.ok(serialized.includes('private final answer'));
  assert.ok(serialized.includes('"index":0'));
  assert.ok(serialized.includes('"index":1'));
  assert.ok(!JSON.stringify(result).includes('private final answer'));
});
test('Anthropic empty tool with no deltas preserves the SDK placeholder object', async () => {
  const result = await consume([start(), tool(), close(), terminal(), stop]);
  assert.equal(result.toolCalls?.[0]?.function.arguments, '{}');
});
for (const [reason, expected] of [
  ['end_turn', 'stop'],
  ['max_tokens', 'length'],
  ['refusal', 'content_filter'],
] as const)
  test(`Anthropic function mode permits unused tools and ${reason} text`, async () => {
    assert.equal(
      (await consume([start(), ...text(), terminal(reason), stop])).finishReason,
      expected,
    );
  });
for (const events of [
  [start('unapproved'), ...native().slice(1)],
  [start(), tool(1), fragment(1), close(1), terminal(), stop],
  [start(), tool(), tool(1), terminal(), stop],
  [start(), tool(), fragment(1), close(), terminal(), stop],
  [start(), tool(), fragment(0, '{'), close(), terminal(), stop],
  ...['null', '[]', '1', '"private"', '', '{"x":1e999}'].map((args) => [
    start(),
    tool(),
    fragment(0, args),
    close(),
    terminal(),
    stop,
  ]),
  [start(), tool(0, 'call', 'lookup', { q: 'private' }), close(), terminal(), stop],
  [start(), tool(0, 'call', 'bad.name'), fragment(), close(), terminal(), stop],
  [
    start(),
    tool(),
    fragment(),
    close(),
    tool(1, 'call_one'),
    fragment(1, '{}'),
    close(1),
    terminal(),
    stop,
  ],
  [start(), terminal(), stop],
  [start(), tool(), fragment(), terminal(), stop],
  ...['max_tokens', 'end_turn', 'refusal'].map((reason) => [
    start(),
    tool(),
    fragment(),
    close(),
    terminal(reason),
    stop,
  ]),
  [start(), ...native().slice(1, -1)],
  [start(), stop],
  [
    start(),
    tool(),
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'private' } },
    close(),
    terminal(),
    stop,
  ],
  [
    start(),
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'server_tool_use', id: 'call', name: 'lookup', input: {} },
    },
    close(),
    terminal(),
    stop,
  ],
  [start(), { type: 'error', error: { message: 'private fixture-key' } }],
  [
    start(),
    tool(),
    fragment(0, JSON.stringify({ x: Array(20_001).fill(0) })),
    close(),
    terminal(),
    stop,
  ],
])
  test('Anthropic malformed function stream is sanitized and possibly billed', async () => {
    await assert.rejects(consume(events), safe);
  });
test('Anthropic cumulative usage is final rather than summed', async () => {
  const result = await consume([
    start(),
    ...text(),
    terminal(null, { output_tokens: 2 }),
    terminal('end_turn', { output_tokens: 4 }),
    stop,
  ]);
  assert.equal(result.usage?.total_tokens, 6);
  await assert.rejects(
    consume([
      start(),
      ...text(),
      terminal(null, { output_tokens: 4 }),
      terminal('end_turn', { output_tokens: 2 }),
      stop,
    ]),
    safe,
  );
});
test('Anthropic delivery failure discards content and cancels upstream', async () => {
  let cancelled = false;
  const bytes = new TextEncoder().encode(frames(native()));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    consumeDirectAnthropicFunctionResponse(
      new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
      scope,
      () => {
        throw Error('private fixture-key');
      },
    ),
    safe,
  );
  assert.equal(cancelled, true);
});
test('Anthropic awaiting callback observes cancellation', async () => {
  const controller = new AbortController();
  await assert.rejects(
    consumeDirectAnthropicFunctionResponse(
      response(native()),
      scope,
      () => {
        controller.abort();
        return new Promise<void>(() => {});
      },
      controller.signal,
    ),
    safe,
  );
});
for (const usage of [undefined, null, { input_tokens: 2 }])
  test('Anthropic function usage retains absence and partial components', async () => {
    const result = await consume([
      start('claude-exact', usage ?? null),
      tool(),
      close(),
      terminal('tool_use', null),
      stop,
    ]);
    assert.equal(result.usage?.total_tokens, undefined);
    assert.equal(result.usage?.prompt_tokens, usage?.input_tokens);
  });
test('Anthropic aggregate retained call arguments cannot exceed the shared 1 MiB bound', async () => {
  const part = 'x'.repeat(600_000);
  await assert.rejects(
    consume([
      start(),
      tool(),
      fragment(0, '{"q":"' + part),
      fragment(0, part + '"}'),
      close(),
      terminal(),
      stop,
    ]),
    safe,
  );
});
test('Anthropic maximum native blocks includes text as well as tools', async () => {
  const blocks = Array.from({ length: 129 }, (_, index) => [
    tool(index, `call_${index}`),
    close(index),
  ]).flat();
  await assert.rejects(consume([start(), ...blocks, terminal(), stop]), safe);
});
test('Anthropic native function event bytes may split inside Unicode and framing', async () => {
  const bytes = new TextEncoder().encode(frames(native()));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
      controller.close();
    },
  });
  const result = await consumeDirectAnthropicFunctionResponse(
    new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    scope,
    () => {},
  );
  assert.equal(result.toolCalls?.[1]?.function.arguments, '{"q":"private 😀"}');
});
for (const responseValue of [
  new Response('private', { status: 429 }),
  new Response('private', { status: 503 }),
  new Response('private'),
  new Response(null, { headers: { 'content-type': 'text/event-stream' } }),
])
  test('Anthropic function status/media/body failures remain sanitized', async () => {
    await assert.rejects(
      consumeDirectAnthropicFunctionResponse(responseValue, scope, () => {}),
      safe,
    );
  });
