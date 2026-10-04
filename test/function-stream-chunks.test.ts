import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeOpenRouterFunctionStreamPayload,
  decodeOpenRouterStreamPayload,
} from '../src/streaming/openrouter-stream-chunks.ts';

const scope = { upstreamModelId: 'model', clientModelAlias: 'approved' };
function chunk(
  delta: Record<string, unknown>,
  finish: unknown = null,
  extra: Record<string, unknown> = {},
) {
  return JSON.stringify({
    id: 'gen',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'model',
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...extra,
  });
}
const first = {
  index: 0,
  id: 'call',
  type: 'function',
  function: { name: 'lookup', arguments: '{"query":' },
};
test('function stream decoder preserves partial and interleaved fragments without assembly', () => {
  for (const calls of [
    [first],
    [
      { index: 1, function: { arguments: '"終"}' } },
      { index: 0, function: { arguments: '"private"}' } },
    ],
    [{ index: 0 }],
    [{ index: 0, id: '', function: { name: '', arguments: '' } }],
    [],
    [{ index: 0, function: {} }],
  ]) {
    const event = decodeOpenRouterFunctionStreamPayload(
      chunk({ role: 'assistant', content: null, tool_calls: calls }),
      scope,
    );
    assert.equal(event.kind, 'delta');
    if (event.kind !== 'delta') assert.fail('Expected delta');
    assert.equal(event.model, 'approved');
    assert.deepEqual(event.toolCalls, calls);
    assert.ok(Object.isFrozen(event));
    assert.ok(Object.isFrozen(event.toolCalls));
    for (const call of event.toolCalls ?? []) {
      assert.ok(Object.isFrozen(call));
      if (call.function) assert.ok(Object.isFrozen(call.function));
    }
  }
  const terminal = decodeOpenRouterFunctionStreamPayload(chunk({}, 'tool_calls'), scope);
  assert.equal(terminal.kind, 'delta');
  if (terminal.kind === 'delta') assert.equal(terminal.finishReason, 'tool_calls');
});

test('function stream decoder retains metadata/reasoning/text and complete usage gates', () => {
  const delta = decodeOpenRouterFunctionStreamPayload(
    chunk(
      {
        tool_calls: [first],
        reasoning: 'private reasoning',
        reasoning_details: [{ type: 'reasoning.summary', summary: 'private summary' }],
        content: 'private prelude',
      },
      null,
      { service_tier: 'tier', system_fingerprint: null },
    ),
    scope,
  );
  assert.equal(delta.kind, 'delta');
  if (delta.kind === 'delta') {
    assert.equal(delta.content, 'private prelude');
    assert.equal(delta.reasoning, 'private reasoning');
    assert.equal(delta.reasoningDetails?.[0]?.type, 'reasoning.summary');
    assert.equal(delta.serviceTier, 'tier');
    assert.equal(delta.systemFingerprint, null);
  }
  const usage = decodeOpenRouterFunctionStreamPayload(
    chunk({}, 'tool_calls', { usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }),
    scope,
  );
  assert.equal(usage.kind, 'usage');
  if (usage.kind === 'usage') {
    assert.equal(usage.finishReason, 'tool_calls');
    assert.deepEqual(usage.usage, { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 });
  }
  const empty = decodeOpenRouterFunctionStreamPayload(
    chunk({}, null, { choices: [], usage: {} }),
    scope,
  );
  assert.equal(empty.kind, 'usage');
  if (empty.kind === 'usage') {
    assert.equal(empty.finishReason, null);
    assert.equal(empty.usage, undefined);
  }
});

test('function stream decoder rejects unsupported/malformed fragments with fixed errors', () => {
  const invalidCalls: unknown[] = [
    null,
    {},
    [null],
    [{}],
    [{ index: -1 }],
    [{ index: 128 }],
    [{ index: 0.5 }],
    [{ index: '0' }],
    [{ index: 0 }, { index: 0 }],
    [{ index: 0, id: null }],
    [{ index: 0, id: 1 }],
    [{ index: 0, type: 'server' }],
    [{ index: 0, function: null }],
    [{ index: 0, function: [] }],
    [{ index: 0, function: { name: null } }],
    [{ index: 0, function: { arguments: {} } }],
    [{ index: 0, unknown: 'private data' }],
    [{ index: 0, function: { unknown: 'private data' } }],
    Array.from({ length: 129 }, (_, index) => ({ index })),
  ];
  for (const calls of invalidCalls)
    assert.throws(
      () => decodeOpenRouterFunctionStreamPayload(chunk({ tool_calls: calls }), scope),
      { message: 'Invalid OpenRouter stream chunk' },
    );
  const valid = Array.from({ length: 128 }, (_, index) => ({ index }));
  const event = decodeOpenRouterFunctionStreamPayload(chunk({ tool_calls: valid }), scope);
  if (event.kind !== 'delta') assert.fail('Expected delta');
  assert.equal(event.toolCalls?.length, 128);
  for (const delta of [{ function_call: { name: 'private' } }, { tool_calls: [first], audio: {} }])
    assert.throws(() => decodeOpenRouterFunctionStreamPayload(chunk(delta), scope), {
      message: 'Invalid OpenRouter stream chunk',
    });
  for (const calls of [[], [first], null])
    assert.throws(
      () =>
        decodeOpenRouterFunctionStreamPayload(
          chunk({ tool_calls: calls }, 'tool_calls', { usage: {} }),
          scope,
        ),
      { message: 'Invalid OpenRouter stream chunk' },
    );
});

test('function stream decoder preserves authorized scope and text-only isolation', () => {
  for (const payload of [
    chunk({ tool_calls: [first] }, null, { model: 'unauthorized' }),
    chunk({}, null, { choices: [{ index: 1, delta: {}, finish_reason: null }] }),
    chunk({}, 'function_call'),
    chunk({}, 'error'),
  ])
    assert.throws(() => decodeOpenRouterFunctionStreamPayload(payload, scope), {
      message: 'Invalid OpenRouter stream chunk',
    });
  for (const payload of [
    chunk({ tool_calls: [first] }),
    chunk({ tool_calls: [] }),
    chunk({}, 'tool_calls'),
  ])
    assert.throws(() => decodeOpenRouterStreamPayload(payload, scope), {
      message: 'Invalid OpenRouter stream chunk',
    });
  assert.deepEqual(decodeOpenRouterFunctionStreamPayload('[DONE]', scope), { kind: 'done' });
  assert.deepEqual(
    decodeOpenRouterFunctionStreamPayload(
      JSON.stringify({ error: { message: 'private call arguments fixture-key' } }),
      scope,
    ),
    { kind: 'error' },
  );
  for (const payload of ['private malformed', 'null', '[]'])
    assert.throws(() => decodeOpenRouterFunctionStreamPayload(payload, scope), {
      message: 'Invalid OpenRouter stream chunk',
    });
});

test('installed OpenRouter SDK agrees on fragment fields while local bounds stay explicit', async () => {
  const { chatStreamDeltaFromJSON, chatStreamToolCallFromJSON } = await import(
    '@openrouter/sdk/models'
  );
  for (const calls of [
    [first],
    [{ index: 0 }],
    [{ index: 1, function: { arguments: '' } }],
    [],
    [{ index: 0, id: '', type: 'function', function: {} }],
  ]) {
    const sdk = chatStreamDeltaFromJSON(JSON.stringify({ tool_calls: calls }));
    assert.ok(sdk.ok);
    const local = decodeOpenRouterFunctionStreamPayload(chunk({ tool_calls: calls }), scope);
    if (local.kind !== 'delta') assert.fail('Expected delta');
    assert.deepEqual(JSON.parse(JSON.stringify(sdk.value.toolCalls)), local.toolCalls);
  }
  assert.equal(chatStreamToolCallFromJSON(JSON.stringify({ index: 128 })).ok, true);
  assert.throws(() =>
    decodeOpenRouterFunctionStreamPayload(chunk({ tool_calls: [{ index: 128 }] }), scope),
  );
  for (const value of [
    { index: 0, id: null },
    { index: 0, function: { arguments: null } },
    { type: 'function' },
  ])
    assert.equal(chatStreamToolCallFromJSON(JSON.stringify(value)).ok, false);
});

test('function mode preserves existing ordinary text payload projections', () => {
  for (const payload of [
    chunk({ role: 'assistant', content: 'text' }),
    chunk({ refusal: 'refused' }, 'stop'),
    chunk({ reasoning: 'reason' }),
    chunk({}, 'length', { usage: { total_tokens: 'invalid' } }),
    chunk({}, null, { choices: [], usage: {} }),
    '[DONE]',
    JSON.stringify({ error: {} }),
  ]) {
    assert.deepEqual(
      decodeOpenRouterFunctionStreamPayload(payload, scope),
      decodeOpenRouterStreamPayload(payload, scope),
    );
  }
});

test('bounded SSE framing delivers separate tool argument fragments unchanged', async () => {
  const { parseSseDataEvents } = await import('../src/streaming/parse-sse-data-events.ts');
  const payloads = [
    chunk({ tool_calls: [first] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '"終"}' } }] }),
    chunk({}, 'tool_calls'),
    chunk({}, 'tool_calls', { usage: {} }),
    '[DONE]',
  ];
  const bytes = new TextEncoder().encode(
    payloads.map((payload) => `data: ${payload}\n\n`).join(''),
  );
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const events = [];
  for await (const payload of parseSseDataEvents(source))
    events.push(decodeOpenRouterFunctionStreamPayload(payload, scope));
  assert.equal(events.length, 5);
  assert.equal(events[0]?.kind, 'delta');
  const continuation = events[1];
  if (continuation?.kind !== 'delta') assert.fail('Expected delta');
  assert.deepEqual(continuation.toolCalls, [{ index: 0, function: { arguments: '"終"}' } }]);
  assert.deepEqual(events[4], { kind: 'done' });
});
