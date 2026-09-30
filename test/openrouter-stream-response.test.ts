import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenRouterChatFailure } from '../src/providers/openrouter-chat.ts';
import { consumeOpenRouterTextResponse } from '../src/streaming/openrouter-stream-response.ts';

const encoder = new TextEncoder();
const scope = { upstreamModelId: 'openai/example', clientModelAlias: 'approved-chat' };

function chunk(
  delta: Record<string, unknown>,
  finishReason: string | null = null,
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

function event(payload: string): string {
  return `data: ${payload}\n\n`;
}

function response(
  events: readonly string[],
  status = 200,
  contentType = 'text/event-stream; charset=utf-8',
) {
  let index = 0;
  let cancelled = false;
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls += 1;
        const next = events[index++];
        if (next === undefined) controller.close();
        else controller.enqueue(encoder.encode(next));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return {
    value: new Response(body, { status, headers: { 'content-type': contentType } }),
    cancelled: () => cancelled,
    pulls: () => pulls,
  };
}

async function failure(
  operation: () => Promise<unknown>,
  category: OpenRouterChatFailure['category'],
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof OpenRouterChatFailure);
    assert.equal(error.category, category);
    assert.equal(error.responseStarted, true);
    assert.equal(error.possiblyBilled, true);
    assert.equal(error.message, 'OpenRouter chat attempt failed');
    assert.equal('cause' in error, false);
    assert.equal(JSON.stringify(error).includes('private'), false);
    return true;
  });
}

test('accepts an HTTP SSE response and returns validated final usage', async () => {
  const input = response([
    event(chunk({ content: 'private answer' })),
    event(chunk({}, 'stop')),
    event(chunk({}, 'stop', { usage: { prompt_tokens: 3, completion_tokens: 2 } })),
    event('[DONE]'),
    event(chunk({ content: 'not delivered' })),
  ]);
  const delivered: string[] = [];
  const outcome = await consumeOpenRouterTextResponse(input.value, scope, (delta) => {
    if (delta.content) delivered.push(delta.content);
  });
  assert.deepEqual(delivered, ['private answer']);
  assert.deepEqual(outcome, {
    status: 'complete',
    id: 'gen-1',
    model: 'approved-chat',
    finishReason: 'stop',
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
  assert.equal(input.cancelled(), true);
  assert.equal(input.value.body?.locked, false);
});

test('classifies HTTP errors without reading their bodies', async () => {
  for (const [status, category] of [
    [429, 'rate-limit'],
    [503, 'server-error'],
    [401, 'upstream'],
    [201, 'upstream'],
  ] as const) {
    const input = response(['private response body'], status);
    await failure(() => consumeOpenRouterTextResponse(input.value, scope, () => {}), category);
    assert.equal(input.pulls(), 0);
    assert.equal(input.cancelled(), true);
    assert.equal(input.value.body?.locked, false);
  }
});

test('rejects missing or non-SSE success content and cancels unread bodies', async () => {
  for (const mime of ['application/json', 'text/event-streamx', '']) {
    const input = response(['private response body'], 200, mime);
    await failure(() => consumeOpenRouterTextResponse(input.value, scope, () => {}), 'upstream');
    assert.equal(input.pulls(), 0);
    assert.equal(input.cancelled(), true);
  }
  await failure(
    () =>
      consumeOpenRouterTextResponse(
        new Response(null, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
        scope,
        () => {},
      ),
    'upstream',
  );
});

test('upstream SSE errors, invalid sequence and callback errors fail safely', async () => {
  for (const events of [
    [event(JSON.stringify({ error: { message: 'private upstream failure' } }))],
    [event(chunk({ content: 'private partial' }))],
    [event(chunk({}, 'stop')), event('[DONE]')],
  ]) {
    const input = response(events);
    await failure(() => consumeOpenRouterTextResponse(input.value, scope, () => {}), 'upstream');
    assert.equal(input.value.body?.locked, false);
  }
  const input = response([event(chunk({ content: 'private partial' })), event('[DONE]')]);
  await failure(
    () =>
      consumeOpenRouterTextResponse(input.value, scope, () => {
        throw new Error('private callback error');
      }),
    'upstream',
  );
  assert.equal(input.cancelled(), true);
  assert.equal(input.pulls(), 1);
});

test('a stalled body cancellation cannot delay safe HTTP failure', async () => {
  const body = new ReadableStream<Uint8Array>(
    {
      cancel() {
        return new Promise<void>(() => {});
      },
    },
    { highWaterMark: 0 },
  );
  const operation = consumeOpenRouterTextResponse(
    new Response(body, { status: 429 }),
    scope,
    () => {},
  ).then(
    () => 'unexpected success',
    (error: unknown) => (error instanceof OpenRouterChatFailure ? error.category : 'wrong error'),
  );
  const result = await Promise.race([
    operation,
    new Promise<string>((resolve) => setImmediate(() => resolve('stalled'))),
  ]);
  assert.equal(result, 'rate-limit');
});
