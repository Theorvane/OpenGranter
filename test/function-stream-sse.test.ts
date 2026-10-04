import assert from 'node:assert/strict';
import test from 'node:test';
import {
  encodeOpenRouterFunctionSse,
  encodeOpenRouterTextSse,
} from '../src/streaming/openrouter-client-sse.ts';
import type { OpenRouterFunctionStreamPayload } from '../src/streaming/openrouter-stream-chunks.ts';

const base = {
  kind: 'delta' as const,
  id: 'gen',
  model: 'approved',
  created: 42,
  finishReason: null,
};
function payload(event: OpenRouterFunctionStreamPayload) {
  const frame = encodeOpenRouterFunctionSse(event);
  assert.ok(frame);
  assert.match(frame, /^data: [^\n]*\n\n$/);
  return JSON.parse(frame.slice(6));
}
test('projects partial indexed functions exactly without parsing or SSE injection', () => {
  const calls = [
    {
      index: 0,
      id: 'call',
      type: 'function' as const,
      function: { name: 'lookup', arguments: '{"q":"終\n\ndata: forged' },
    },
    { index: 1, function: { arguments: '' } },
  ];
  const p = payload({
    ...base,
    role: 'assistant',
    content: null,
    toolCalls: calls,
    nativeFinishReason: 'tool_use',
    serviceTier: 'tier',
    systemFingerprint: null,
  });
  assert.deepEqual(p.choices, [
    {
      index: 0,
      delta: { role: 'assistant', content: null, tool_calls: calls },
      finish_reason: null,
      native_finish_reason: 'tool_use',
    },
  ]);
  assert.equal(p.model, 'approved');
  assert.equal(p.service_tier, 'tier');
  assert.equal(p.system_fingerprint, null);
  assert.deepEqual(payload({ ...base, toolCalls: [] }).choices[0].delta.tool_calls, []);
  assert.deepEqual(payload({ ...base, toolCalls: [{ index: 0 }] }).choices[0].delta.tool_calls, [
    { index: 0 },
  ]);
});
test('preserves tool terminal and content-free final usage then DONE', () => {
  assert.equal(
    payload({ ...base, finishReason: 'tool_calls' }).choices[0].finish_reason,
    'tool_calls',
  );
  const p = payload({
    ...base,
    kind: 'usage',
    finishReason: 'tool_calls',
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
  assert.equal(p.choices[0].finish_reason, 'tool_calls');
  assert.equal(p.choices[0].delta.tool_calls, undefined);
  assert.equal(p.usage.total_tokens, 5);
  assert.deepEqual(
    payload({
      ...base,
      kind: 'usage',
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    }).choices,
    [],
  );
  assert.equal(
    encodeOpenRouterFunctionSse({ ...base, kind: 'usage', usage: undefined }),
    undefined,
  );
  assert.equal(encodeOpenRouterFunctionSse({ kind: 'done' }), 'data: [DONE]\n\n');
});
test('rejects malformed fragments and unsafe event values with fixed errors', () => {
  for (const calls of [
    null,
    {},
    [null],
    [{ index: -1 }],
    [{ index: 128 }],
    [{ index: 0 }, { index: 0 }],
    [{ index: 0, id: null }],
    [{ index: 0, type: 'custom' }],
    [{ index: 0, function: null }],
    [{ index: 0, function: { arguments: 42 } }],
    [{ index: 0, function: { extra: 'private' } }],
    [{ index: 0, extra: 'private' }],
    Array.from({ length: 129 }, (_, index) => ({ index })),
  ]) {
    assert.throws(
      () => encodeOpenRouterFunctionSse({ ...base, toolCalls: calls as never }),
      /Unsupported OpenRouter text stream event/,
    );
  }
  for (const event of [
    { ...base, id: '' },
    { ...base, finishReason: 'private' },
    { ...base, content: 42 },
    { kind: 'error' },
    { ...base, kind: 'usage', toolCalls: [], usage: undefined },
  ])
    assert.throws(() => encodeOpenRouterFunctionSse(event as never));
});
test('text encoder refuses injected function data instead of silently dropping it', () => {
  assert.throws(() => encodeOpenRouterTextSse({ ...base, toolCalls: [] } as never));
  assert.throws(() => encodeOpenRouterTextSse({ ...base, finishReason: 'tool_calls' } as never));
});
test('uses first captured fragment scalar values without caller toJSON execution', () => {
  let reads = 0;
  const call = Object.defineProperty({ index: 0, function: { arguments: 'private args' } }, 'id', {
    enumerable: true,
    get() {
      reads++;
      return reads === 1 ? 'call' : null;
    },
  });
  assert.equal(payload({ ...base, toolCalls: [call] }).choices[0].delta.tool_calls[0].id, 'call');
  assert.equal(reads, 1);
});

test('rejects invalid locally supplied captured array lengths', () => {
  for (const length of [-1, 0.5, Number.NaN, '0']) {
    const calls = new Proxy([], {
      get(target, key, receiver) {
        return key === 'length' ? length : Reflect.get(target, key, receiver);
      },
    });
    assert.throws(() => encodeOpenRouterFunctionSse({ ...base, toolCalls: calls }));
  }
});
