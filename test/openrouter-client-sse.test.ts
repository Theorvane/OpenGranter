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

test('independent encoder rejects usage-only content/refusal before suppressing incomplete counts', () => {
  for (const usage of [
    { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    undefined,
    { prompt_tokens: 3 },
    { prompt_tokens: -1, completion_tokens: 2, total_tokens: 5 },
  ]) {
    for (const field of ['content', 'refusal']) {
      for (const value of ['private response\n\ndata: forged', 42, {}, [], false]) {
        assert.throws(
          () =>
            encodeOpenRouterTextSse({
              kind: 'usage',
              id: 'gen-1',
              created: 42,
              model: 'approved-chat',
              finishReason: 'stop',
              usage,
              [field]: value,
            }),
          { message: 'Unsupported OpenRouter text stream event' },
          `${field} must fail independently of token-count completeness`,
        );
      }
    }
  }
});

test('content-free usage fields preserve terminal framing and incomplete-count omission', () => {
  for (const value of [undefined, null, '']) {
    for (const usage of [
      { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      undefined,
      { prompt_tokens: 3 },
    ]) {
      const encoded = encodeOpenRouterTextSse({
        kind: 'usage',
        id: 'gen-1',
        created: 42,
        model: 'approved-chat',
        finishReason: 'stop',
        usage,
        ...(value === undefined ? {} : { content: value, refusal: value }),
      });
      if (usage === undefined || !('total_tokens' in usage)) {
        assert.equal(encoded, undefined);
      } else {
        assert.deepEqual(payload(encoded).choices, [
          { index: 0, delta: { role: 'assistant', content: '' }, finish_reason: 'stop' },
        ]);
        assert.deepEqual(payload(encoded).usage, usage);
      }
    }
  }
});

test('delta projection snapshots validated content/refusal without leaking later accessor values', () => {
  for (const field of ['content', 'refusal']) {
    let reads = 0;
    const event = {
      kind: 'delta' as const,
      id: 'gen-1',
      created: 42,
      model: 'approved-chat',
      finishReason: null,
    };
    Object.defineProperty(event, field, {
      get: () => {
        reads += 1;
        return reads <= 3 ? 'validated\n\ndata: text 😀' : { private: 'unchecked payload' };
      },
    });
    const encoded = encodeOpenRouterTextSse(event);
    assert.deepEqual(payload(encoded).choices, [
      { index: 0, delta: { [field]: 'validated\n\ndata: text 😀' }, finish_reason: null },
    ]);
    assert.equal(reads, 1);
    assert.equal(encoded?.includes('unchecked payload'), false);
  }
});

test('delta content/refusal preserve exact omission/null/empty and reject malformed captures', () => {
  for (const field of ['content', 'refusal']) {
    for (const value of [undefined, null, '', 'literal\n😀']) {
      const encoded = encodeOpenRouterTextSse({
        kind: 'delta',
        id: 'gen-1',
        created: 42,
        model: 'approved-chat',
        finishReason: null,
        [field]: value,
      });
      assert.deepEqual(payload(encoded).choices, [
        { index: 0, delta: value === undefined ? {} : { [field]: value }, finish_reason: null },
      ]);
    }
    assert.throws(
      () =>
        encodeOpenRouterTextSse({
          kind: 'delta',
          id: 'gen-1',
          created: 42,
          model: 'approved-chat',
          finishReason: null,
          [field]: { private: 'malformed' },
        }),
      { message: 'Unsupported OpenRouter text stream event' },
    );
  }
});
