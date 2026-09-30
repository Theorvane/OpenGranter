import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeOpenRouterStreamPayload } from '../src/streaming/openrouter-stream-chunks.ts';

const scope = { upstreamModelId: 'openai/example', clientModelAlias: 'approved-chat' };

function chunk(
  delta: Record<string, unknown>,
  finishReason: unknown = null,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    id: 'gen-1',
    object: 'chat.completion.chunk',
    created: 42,
    model: 'openai/example',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...extra,
  });
}

test('recognizes text, terminal, final usage and done payloads', () => {
  assert.deepEqual(decodeOpenRouterStreamPayload('[DONE]', scope), { kind: 'done' });
  assert.deepEqual(decodeOpenRouterStreamPayload(chunk({ role: 'assistant' }), scope), {
    kind: 'delta',
    id: 'gen-1',
    created: 42,
    model: 'approved-chat',
    role: 'assistant',
    finishReason: null,
  });
  assert.deepEqual(decodeOpenRouterStreamPayload(chunk({ content: 'Hello' }), scope), {
    kind: 'delta',
    id: 'gen-1',
    created: 42,
    model: 'approved-chat',
    content: 'Hello',
    finishReason: null,
  });
  assert.deepEqual(decodeOpenRouterStreamPayload(chunk({}, 'stop'), scope), {
    kind: 'delta',
    id: 'gen-1',
    created: 42,
    model: 'approved-chat',
    finishReason: 'stop',
  });
  assert.deepEqual(
    decodeOpenRouterStreamPayload(
      chunk({ content: '', role: 'assistant' }, 'stop', {
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }),
      scope,
    ),
    {
      kind: 'usage',
      id: 'gen-1',
      created: 42,
      model: 'approved-chat',
      finishReason: 'stop',
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    },
  );
});

test('treats first-event upstream errors as safe failures without leaking details', () => {
  const result = decodeOpenRouterStreamPayload(
    JSON.stringify({
      error: { code: 'private-code', message: 'private provider response' },
      choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }],
    }),
    scope,
  );
  assert.deepEqual(result, { kind: 'error' });
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('preserves invalid and missing usage markers for later accounting', () => {
  const invalid = decodeOpenRouterStreamPayload(
    chunk({ content: '' }, 'length', { usage: { total_tokens: 'private invalid' } }),
    scope,
  );
  assert.deepEqual(invalid, {
    kind: 'usage',
    id: 'gen-1',
    created: 42,
    model: 'approved-chat',
    finishReason: 'length',
    usage: { total_tokens: null },
  });
  const missing = decodeOpenRouterStreamPayload(
    chunk({ content: '' }, 'stop', { usage: {} }),
    scope,
  );
  assert.deepEqual(missing, {
    kind: 'usage',
    id: 'gen-1',
    created: 42,
    model: 'approved-chat',
    finishReason: 'stop',
    usage: undefined,
  });
});

test('accepts an empty-choice usage chunk without inventing a finish reason', () => {
  const payload = JSON.stringify({
    id: 'gen-1',
    object: 'chat.completion.chunk',
    created: 42,
    model: 'openai/example',
    choices: [],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
  assert.deepEqual(decodeOpenRouterStreamPayload(payload, scope), {
    kind: 'usage',
    id: 'gen-1',
    created: 42,
    model: 'approved-chat',
    finishReason: null,
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
});

test('rejects malformed, out-of-scope and unsupported chunks with fixed errors', () => {
  for (const payload of [
    '{private-invalid-json',
    ' [DONE]',
    chunk({ content: 'private' }).replace('openai/example', 'other/model'),
    chunk({ tool_calls: [{ function: { arguments: 'private' } }] }),
    chunk({ reasoning: 'private' }),
    chunk({ role: 'tool' }),
    chunk({ content: { secret: 'private' } }),
    chunk({ content: 'private' }, 'error'),
    chunk({ content: 'private' }, 'tool_calls'),
    chunk({ content: 'private' }, null, { usage: { total_tokens: 2 } }),
    chunk({ content: 'private' }, 'stop', { usage: { total_tokens: 2 } }),
    chunk({ content: '' }, 'stop').replace('"index":0', '"index":1'),
    chunk({ content: '' }, 'stop').replace('"choices":[', '"choices":[{"index":0},'),
    chunk({}, 'stop').replace(/"choices":\[[^\]]+\]/u, '"choices":[]'),
  ]) {
    assert.throws(() => decodeOpenRouterStreamPayload(payload, scope), {
      message: 'Invalid OpenRouter stream chunk',
    });
  }
});
