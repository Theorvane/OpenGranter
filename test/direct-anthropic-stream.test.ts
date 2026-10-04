import assert from 'node:assert/strict';
import test from 'node:test';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';
import { consumeDirectAnthropicTextResponse } from '../src/streaming/direct-anthropic-text-response.ts';

const scope = () => ({ upstreamModelId: 'claude-exact', clientModelAlias: 'chat' });
const start = (usage: unknown = { input_tokens: 2, output_tokens: 1 }) => ({
  type: 'message_start',
  message: {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-exact',
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage,
  },
});
const block = (index = 0) => ({
  type: 'content_block_start',
  index,
  content_block: { type: 'text', text: '' },
});
const text = (index = 0) => ({
  type: 'content_block_delta',
  index,
  delta: { type: 'text_delta', text: 'private response' },
});
const close = (index = 0) => ({ type: 'content_block_stop', index });
const terminal = (reason: string | null = 'end_turn', usage: unknown = { output_tokens: 3 }) => ({
  type: 'message_delta',
  delta: { stop_reason: reason, stop_sequence: null },
  usage,
});
const stop = { type: 'message_stop' },
  ping = { type: 'ping' };
const frame = (events: object[]) =>
  events
    .map((e) => `event: ${'type' in e ? e.type : 'unknown'}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('');
const complete = () => [start(), block(), text(), close(), terminal(), stop];
const response = (events = complete()) =>
  new Response(frame(events), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
const safe = (e: unknown) =>
  e instanceof DirectProviderFailure &&
  e.responseStarted &&
  e.possiblyBilled &&
  e.message === 'Direct provider attempt failed';
const consume = (events = complete()) =>
  consumeDirectAnthropicTextResponse(response(events), scope(), () => {}, undefined, 42);
test('native Anthropic maps sequential blocks, exact model and timestamp without retaining text', async () => {
  const seen: unknown[] = [];
  const result = await consumeDirectAnthropicTextResponse(
    response([
      ping,
      start(),
      block(),
      text(),
      close(),
      block(1),
      text(1),
      close(1),
      ping,
      terminal(),
      stop,
    ]),
    scope(),
    (d) => {
      seen.push(d);
    },
    undefined,
    42,
  );
  assert.equal(result.model, 'chat');
  assert.equal(result.id, 'msg');
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.usage?.total_tokens, 5);
  assert.equal(seen.length, 4);
  assert.ok(JSON.stringify(seen).includes('private response'));
  assert.ok(!JSON.stringify(result).includes('private response'));
  assert.ok(Object.isFrozen(result));
  for (const event of seen as { created: number; model: string }[]) {
    assert.equal(event.created, 42);
    assert.equal(event.model, 'chat');
  }
});
for (const [reason, finish] of [
  ['end_turn', 'stop'],
  ['stop_sequence', 'stop'],
  ['max_tokens', 'length'],
  ['refusal', 'content_filter'],
] as const)
  test(`native ${reason} maps to ${finish}`, async () => {
    assert.equal((await consume([start(), terminal(reason), stop])).finishReason, finish);
  });
for (const [initial, final, expected] of [
  [
    { input_tokens: 2, output_tokens: 1 },
    { output_tokens: 4 },
    { prompt_tokens: 2, completion_tokens: 4, total_tokens: 6 },
  ],
  [{ input_tokens: 2, output_tokens: 1 }, {}, { prompt_tokens: 2 }],
  [{ input_tokens: 2 }, null, { prompt_tokens: 2 }],
  [null, null, undefined],
  [{ input_tokens: -1 }, { output_tokens: 3 }, { prompt_tokens: null, completion_tokens: 3 }],
  [
    { input_tokens: 2 },
    { input_tokens: 4, output_tokens: 3 },
    { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
  ],
] as const)
  test('native final usage preserves unavailable counters without initial-output fabrication', async () => {
    assert.deepEqual(
      (await consume([start(initial), terminal('end_turn', final), stop])).usage,
      expected,
    );
  });
test('message_delta output counts are cumulative and never added', async () => {
  assert.equal(
    (
      await consume([
        start(),
        block(),
        text(),
        close(),
        terminal(null, { output_tokens: 2 }),
        terminal('end_turn', { output_tokens: 3 }),
        stop,
      ])
    ).usage?.total_tokens,
    5,
  );
});
for (const events of [
  [block(), start(), terminal(), stop],
  [start(), start(), terminal(), stop],
  [start(), text(), terminal(), stop],
  [start(), block(), text(1), close(), terminal(), stop],
  [start(), block(1), close(1), terminal(), stop],
  [start(), block(), terminal(), stop],
  [start(), close(), terminal(), stop],
  [start(), terminal(), terminal(), stop],
  [start(), terminal(null), block(), close(), terminal(), stop],
  [start(), terminal(null, { output_tokens: 4 }), terminal('end_turn', { output_tokens: 3 }), stop],
  [start(), terminal()],
  [start(), stop],
  [start(), { type: 'future_event' }, terminal(), stop],
  [
    start(),
    { ...block(), content_block: { type: 'tool_use', id: 'private', input: {} } },
    terminal(),
    stop,
  ],
  [
    start(),
    block(),
    { ...text(), delta: { type: 'thinking_delta', thinking: 'private' } },
    close(),
    terminal(),
    stop,
  ],
  [start(), { type: 'error', error: { message: 'private key' } }, stop],
  [{ ...start(), message: { ...start().message, model: 'claude-other' } }, terminal(), stop],
  [
    { ...start(), message: { ...start().message, content: [{ type: 'text', text: 'private' }] } },
    terminal(),
    stop,
  ],
  [start(), terminal('tool_use'), stop],
  [
    start(),
    { ...terminal(), delta: { stop_reason: 'end_turn', stop_sequence: null, model: 'other' } },
    stop,
  ],
])
  test('outside-subset, malformed and misordered native sequences fail safely', async () => {
    await assert.rejects(consume(events), safe);
  });
for (const [status, category] of [
  [429, 'rate-limit'],
  [529, 'server-error'],
  [400, 'other'],
] as const)
  test(`HTTP ${status} discards body safely`, async () => {
    let reads = 0,
      cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull() {
        reads++;
      },
      cancel() {
        cancelled = true;
      },
    });
    await assert.rejects(
      consumeDirectAnthropicTextResponse(new Response(body, { status }), scope(), () => {}),
      (e) => safe(e) && e instanceof DirectProviderFailure && e.category === category,
    );
    assert.equal(reads, 0);
    assert.equal(cancelled, true);
  });
test('invalid media type, UTF-8, oversized payload and invalid timestamp fail safely', async () => {
  for (const r of [
    new Response('private'),
    new Response(null, { headers: { 'content-type': 'text/event-stream' } }),
    new Response(new Uint8Array([255]), { headers: { 'content-type': 'text/event-stream' } }),
    new Response(`data: ${'x'.repeat(1048577)}\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    }),
  ])
    await assert.rejects(
      consumeDirectAnthropicTextResponse(r, scope(), () => {}),
      safe,
    );
  await assert.rejects(
    consumeDirectAnthropicTextResponse(response(), scope(), () => {}, undefined, -1),
    safe,
  );
});
test('callback backpressure snapshots scope and keeps gateway timestamp stable', async () => {
  const captured = scope();
  let count = 0,
    release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const operation = consumeDirectAnthropicTextResponse(
    response(),
    captured,
    async () => {
      count++;
      if (count === 1) {
        captured.upstreamModelId = 'other';
        captured.clientModelAlias = 'other';
        await gate;
      }
    },
    undefined,
    42,
  );
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(count, 1);
  release();
  assert.equal((await operation).model, 'chat');
  assert.equal(count, 3);
});
test('callback errors and pending cancellation discard private errors', async () => {
  await assert.rejects(
    consumeDirectAnthropicTextResponse(response(), scope(), () => {
      throw Error('private key');
    }),
    safe,
  );
  const controller = new AbortController();
  await assert.rejects(
    consumeDirectAnthropicTextResponse(
      response(),
      scope(),
      () => {
        controller.abort('private');
        return new Promise(() => {});
      },
      controller.signal,
    ),
    safe,
  );
});

test('more than 128 sequential blocks fails before delivering another block', async () => {
  const blocks = Array.from({ length: 129 }, (_, index) => [block(index), close(index)]).flat();
  await assert.rejects(consume([start(), ...blocks, terminal(), stop]), safe);
});
