import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeOpenRouterTextStream } from '../src/streaming/openrouter-stream-consumer.ts';
import { OpenRouterStreamSequenceFailure } from '../src/streaming/openrouter-stream-sequence.ts';

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

function sse(payload: string): string {
  return `data: ${payload}\n\n`;
}

function source(parts: readonly (string | Uint8Array)[]): {
  stream: ReadableStream<Uint8Array>;
  wasCancelled: () => boolean;
  pulled: () => number;
} {
  let index = 0;
  let cancelled = false;
  return {
    stream: new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const part = parts[index++];
          if (part === undefined) controller.close();
          else controller.enqueue(typeof part === 'string' ? encoder.encode(part) : part);
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    ),
    wasCancelled: () => cancelled,
    pulled: () => index,
  };
}

async function invalid(operation: () => Promise<unknown>): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof OpenRouterStreamSequenceFailure);
    assert.equal(error.message, 'Invalid OpenRouter stream sequence');
    assert.equal(error.possiblyBilled, true);
    assert.equal(JSON.stringify(error).includes('private'), false);
    assert.equal('cause' in error, false);
    return true;
  });
}

test('consumes fragmented SSE, delivers validated deltas and returns final usage', async () => {
  const events = [
    sse(chunk({ role: 'assistant' })),
    sse(chunk({ content: 'private 한글' })),
    sse(chunk({}, 'stop')),
    sse(chunk({}, 'stop', { usage: { prompt_tokens: 3, completion_tokens: 2 } })),
    sse('[DONE]'),
    sse(chunk({ content: 'must not be read' })),
  ];
  const bytes = encoder.encode(events.join(''));
  const input = source([bytes.slice(0, 7), bytes.slice(7, 60), bytes.slice(60)]);
  const contents: (string | null | undefined)[] = [];
  const result = await consumeOpenRouterTextStream(input.stream, scope, async (delta) => {
    contents.push(delta.content);
  });
  assert.deepEqual(contents, [undefined, 'private 한글', undefined]);
  assert.deepEqual(result, {
    status: 'complete',
    id: 'gen-1',
    model: 'approved-chat',
    finishReason: 'stop',
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
  assert.equal(input.wasCancelled(), true);
  assert.equal(input.stream.locked, false);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('awaits a delta callback before pulling the next event', async () => {
  const input = source([
    sse(chunk({ content: 'first' })),
    sse(chunk({}, 'stop')),
    sse(chunk({}, 'stop', { usage: {} })),
    sse('[DONE]'),
  ]);
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let delivered: (() => void) | undefined;
  const first = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  const completion = consumeOpenRouterTextStream(input.stream, scope, async () => {
    delivered?.();
    await gate;
  });
  await first;
  assert.equal(input.pulled(), 1);
  release?.();
  assert.equal((await completion).status, 'complete');
});

test('first-event and midstream upstream errors return safe failure and cancel', async () => {
  for (const prior of [[], [sse(chunk({ content: 'private response' }))]]) {
    const input = source([
      ...prior,
      sse(JSON.stringify({ error: { message: 'private upstream error' } })),
      sse(chunk({ content: 'after error' })),
    ]);
    const delivered: string[] = [];
    const result = await consumeOpenRouterTextStream(input.stream, scope, (delta) => {
      if (delta.content) delivered.push(delta.content);
    });
    assert.deepEqual(result, { status: 'failed', possiblyBilled: true });
    assert.deepEqual(delivered, prior.length ? ['private response'] : []);
    assert.equal(input.wasCancelled(), true);
    assert.equal(input.stream.locked, false);
  }
});

test('malformed framing, payload, identity, order and truncated EOF fail safely', async () => {
  for (const parts of [
    [new Uint8Array([0x64, 0x61, 0x74, 0x61, 0x3a, 0xff])],
    [sse('{private-invalid-json')],
    [sse(chunk({ content: 'private' }).replace('openai/example', 'other/model'))],
    [sse('[DONE]')],
    [sse(chunk({ content: 'partial' }))],
    [sse(chunk({}, 'stop')), sse(chunk({}, 'stop', { usage: {} }))],
  ]) {
    const input = source(parts);
    await invalid(() => consumeOpenRouterTextStream(input.stream, scope, () => {}));
    assert.equal(input.stream.locked, false);
  }
});

test('callback rejection is fixed and cancels before another upstream event', async () => {
  const input = source([sse(chunk({ content: 'private' })), sse(chunk({}, 'stop'))]);
  await invalid(() =>
    consumeOpenRouterTextStream(input.stream, scope, () => {
      throw new Error('private callback failure');
    }),
  );
  assert.equal(input.pulled(), 1);
  assert.equal(input.wasCancelled(), true);
  assert.equal(input.stream.locked, false);
});

test('captures the authorized model scope before asynchronous delivery', async () => {
  const mutableScope = { ...scope };
  const input = source([
    sse(chunk({ content: 'first' })),
    sse(chunk({}, 'stop')),
    sse(chunk({}, 'stop', { usage: {} })),
    sse('[DONE]'),
  ]);
  const result = await consumeOpenRouterTextStream(input.stream, mutableScope, () => {
    mutableScope.upstreamModelId = 'other/model';
    mutableScope.clientModelAlias = 'other-alias';
  });
  assert.equal(result.status, 'complete');
  if (result.status === 'complete') assert.equal(result.model, 'approved-chat');
});

test('transport errors never expose their cause', async () => {
  const failed = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error('private transport secret'));
    },
  });
  await invalid(() => consumeOpenRouterTextStream(failed, scope, () => {}));
  assert.equal(failed.locked, false);
});
