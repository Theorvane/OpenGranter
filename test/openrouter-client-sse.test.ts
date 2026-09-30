import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeOpenRouterTextSse } from '../src/streaming/openrouter-client-sse.ts';
import { decodeOpenRouterStreamPayload } from '../src/streaming/openrouter-stream-chunks.ts';

function payload(frame: string | undefined): Record<string, unknown> {
  assert.equal(typeof frame, 'string');
  if (frame === undefined) throw new Error('Expected an SSE frame');
  assert.match(frame, /^data: [^\n]*\n\n$/);
  return JSON.parse(frame.slice(6, -2)) as Record<string, unknown>;
}

test('encodes authorized text, terminal, complete usage and DONE as one SSE frame each', () => {
  const scope = { upstreamModelId: 'openai/private', clientModelAlias: 'approved-chat' };
  const upstream = (delta: Record<string, unknown>, finishReason: string | null, extra = {}) =>
    JSON.stringify({
      id: 'gen-1',
      object: 'chat.completion.chunk',
      created: 42,
      model: 'openai/private',
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      ...extra,
    });
  const role = encodeOpenRouterTextSse(
    decodeOpenRouterStreamPayload(upstream({ role: 'assistant' }, null), scope),
  );
  assert.deepEqual(payload(role), {
    id: 'gen-1',
    object: 'chat.completion.chunk',
    created: 42,
    model: 'approved-chat',
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  });
  const content = encodeOpenRouterTextSse(
    decodeOpenRouterStreamPayload(upstream({ content: 'hello\n\ndata: forged 😀' }, null), scope),
  );
  assert.deepEqual(payload(content).choices, [
    { index: 0, delta: { content: 'hello\n\ndata: forged 😀' }, finish_reason: null },
  ]);
  assert.equal(content?.match(/\ndata:/g), null);
  const terminal = encodeOpenRouterTextSse(
    decodeOpenRouterStreamPayload(upstream({}, 'stop'), scope),
  );
  assert.deepEqual(payload(terminal).choices, [{ index: 0, delta: {}, finish_reason: 'stop' }]);
  const usage = encodeOpenRouterTextSse(
    decodeOpenRouterStreamPayload(
      upstream({ content: '' }, 'stop', {
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }),
      scope,
    ),
  );
  assert.deepEqual(payload(usage), {
    id: 'gen-1',
    object: 'chat.completion.chunk',
    created: 42,
    model: 'approved-chat',
    choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
  assert.equal(encodeOpenRouterTextSse({ kind: 'done' }), 'data: [DONE]\n\n');
});

test('preserves empty-choice final usage without inventing a finish reason', () => {
  const frame = encodeOpenRouterTextSse({
    kind: 'usage',
    id: 'gen-1',
    created: 42,
    model: 'approved-chat',
    finishReason: null,
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
  assert.deepEqual(payload(frame).choices, []);
});

test('omits incomplete or invalid usage without fabricating token counts', () => {
  for (const usage of [
    undefined,
    { prompt_tokens: 3, completion_tokens: 2 },
    { prompt_tokens: 3, completion_tokens: null, total_tokens: 5 },
    { prompt_tokens: -1, completion_tokens: 2, total_tokens: 5 },
  ]) {
    assert.equal(
      encodeOpenRouterTextSse({
        kind: 'usage',
        id: 'gen-1',
        created: 42,
        model: 'approved-chat',
        finishReason: 'stop',
        usage,
      }),
      undefined,
    );
  }
});

test('rejects upstream error and unknown events with a fixed non-leaking error', () => {
  for (const event of [{ kind: 'error' }, { kind: 'tool', secret: 'private' }]) {
    assert.throws(
      () => encodeOpenRouterTextSse(event as Parameters<typeof encodeOpenRouterTextSse>[0]),
      { message: 'Unsupported OpenRouter text stream event' },
    );
  }
});
