import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consumeOpenRouterFunctionStream } from '../src/streaming/openrouter-function-stream-consumer.ts';
import { OpenRouterStreamSequenceFailure } from '../src/streaming/openrouter-stream-sequence.ts';

const encoder = new TextEncoder();
const scope = { upstreamModelId: 'model', clientModelAlias: 'approved' };
function frame(
  delta: Record<string, unknown> = {},
  finish: string | null = null,
  extra: Record<string, unknown> = {},
) {
  return `data: ${JSON.stringify({ id: 'gen', object: 'chat.completion.chunk', created: 1, model: 'model', choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
}
const call = {
  index: 0,
  id: 'private_call',
  type: 'function',
  function: { name: 'private_lookup', arguments: '{"q":' },
};
const first = () => frame({ tool_calls: [call] });
const terminal = () => frame({}, 'tool_calls');
const usage = () => frame({}, 'tool_calls', { usage: { prompt_tokens: 2, completion_tokens: 1 } });
const done = 'data: [DONE]\n\n';
function source(parts: readonly (string | Uint8Array)[]) {
  let pulls = 0,
    cancels = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const part = parts[pulls++];
        if (part === undefined) controller.close();
        else controller.enqueue(typeof part === 'string' ? encoder.encode(part) : part);
      },
      cancel() {
        cancels++;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, pulls: () => pulls, cancels: () => cancels };
}
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function invalid(promise: Promise<unknown>) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof OpenRouterStreamSequenceFailure);
    assert.equal(error.message, 'Invalid OpenRouter stream sequence');
    assert.equal(error.possiblyBilled, true);
    assert.doesNotMatch(JSON.stringify(error), /private|fixture-key/u);
    assert.equal('cause' in error, false);
    return true;
  });
}

test('function consumer frames Unicode fragments and stops after DONE without reading trailing data', async () => {
  const bytes = encoder.encode(
    first() +
      frame({ tool_calls: [{ index: 0, function: { arguments: '"終"}' } }] }) +
      terminal() +
      usage() +
      done,
  );
  const input = source(
    [...bytes]
      .map((byte) => Uint8Array.of(byte))
      .concat([encoder.encode('private trailing invalid')]),
  );
  const deltas = [];
  const result = await consumeOpenRouterFunctionStream(input.stream, scope, async (event) => {
    deltas.push(event);
  });
  assert.equal(result.status, 'complete');
  if (result.status !== 'complete') assert.fail('Expected complete');
  assert.deepEqual(result.toolCalls, [
    {
      id: 'private_call',
      type: 'function',
      function: { name: 'private_lookup', arguments: '{"q":"終"}' },
    },
  ]);
  assert.deepEqual(result.usage, { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 });
  assert.equal(deltas.length, 3);
  assert.equal(input.pulls(), bytes.length);
  assert.equal(input.cancels(), 1);
  assert.equal(input.stream.locked, false);
});

test('function consumer awaits callback and fixes authorized scope before delivery', async () => {
  const mutable = { ...scope },
    gate = deferred(),
    entered = deferred();
  const input = source([first(), terminal(), usage(), done]);
  const completion = consumeOpenRouterFunctionStream(input.stream, mutable, async () => {
    mutable.upstreamModelId = 'unauthorized';
    mutable.clientModelAlias = 'changed';
    entered.resolve();
    await gate.promise;
  });
  await entered.promise;
  assert.equal(input.pulls(), 1);
  gate.resolve();
  const result = await completion;
  assert.equal(result.status, 'complete');
  if (result.status === 'complete') assert.equal(result.model, 'approved');
});

test('function consumer handles first and midstream errors without exposing calls', async () => {
  for (const prior of [[], [first()]]) {
    const input = source([
      ...prior,
      'data: {"error":{"message":"private fixture-key"}}\n\n',
      terminal(),
    ]);
    let delivered = 0;
    const result = await consumeOpenRouterFunctionStream(input.stream, scope, () => {
      delivered++;
    });
    assert.deepEqual(result, { status: 'failed', possiblyBilled: true });
    assert.equal(delivered, prior.length);
    assert.equal(input.pulls(), prior.length + 1);
    assert.equal(input.cancels(), 1);
    assert.equal(input.stream.locked, false);
  }
});

test('function consumer sanitizes framing/model/order/truncation and transport failures', async () => {
  for (const parts of [
    [Uint8Array.of(0x64, 0x61, 0x74, 0x61, 0x3a, 0xff)],
    ['data: private-invalid\n\n'],
    [first().replace('"model":"model"', '"model":"wrong"')],
    [done],
    [first()],
    [first(), terminal(), usage()],
    [frame({ content: 'x'.repeat(1_048_577) })],
  ]) {
    const input = source(parts);
    await invalid(consumeOpenRouterFunctionStream(input.stream, scope, () => {}));
    assert.equal(input.stream.locked, false);
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error('private transport fixture-key'));
    },
  });
  await invalid(consumeOpenRouterFunctionStream(stream, scope, () => {}));
  assert.equal(stream.locked, false);
});

test('function consumer never delivers an inconsistent terminal and sanitizes callback failures', async () => {
  const incomplete = source([frame({ tool_calls: [{ index: 0 }] }), terminal(), usage()]);
  let deliveries = 0;
  await invalid(
    consumeOpenRouterFunctionStream(incomplete.stream, scope, () => {
      deliveries++;
    }),
  );
  assert.equal(deliveries, 1);
  assert.equal(incomplete.cancels(), 1);
  for (const asynchronous of [false, true]) {
    const input = source([first(), terminal()]);
    await invalid(
      consumeOpenRouterFunctionStream(input.stream, scope, () => {
        if (asynchronous) return Promise.reject(new Error('private callback fixture-key'));
        throw new Error('private callback fixture-key');
      }),
    );
    assert.equal(input.pulls(), 1);
    assert.equal(input.cancels(), 1);
    assert.equal(input.stream.locked, false);
  }
});

test('function consumer cancels stalled reads without awaiting uncooperative cleanup', {
  timeout: 2000,
}, async () => {
  const cancellation = new AbortController(),
    entered = deferred();
  let cancels = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull() {
        entered.resolve();
        return new Promise<void>(() => {});
      },
      cancel() {
        cancels++;
        return new Promise<void>(() => {});
      },
    },
    { highWaterMark: 0 },
  );
  const completion = consumeOpenRouterFunctionStream(stream, scope, () => {}, cancellation.signal);
  await entered.promise;
  cancellation.abort('private caller fixture-key');
  await invalid(completion);
  assert.equal(cancels, 1);
  assert.equal(stream.locked, false);
});

test('function consumer cancels pending delivery and observes its late rejection', {
  timeout: 2000,
}, async () => {
  const cancellation = new AbortController(),
    gate = deferred(),
    entered = deferred();
  const input = source([first(), terminal()]);
  const completion = consumeOpenRouterFunctionStream(
    input.stream,
    scope,
    () => {
      entered.resolve();
      return gate.promise;
    },
    cancellation.signal,
  );
  await entered.promise;
  cancellation.abort('private fixture-key');
  await invalid(completion);
  gate.reject(new Error('private late callback'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(input.pulls(), 1);
  assert.equal(input.cancels(), 1);
  assert.equal(input.stream.locked, false);
});

test('function consumer already cancelled never pulls or delivers', async () => {
  const cancellation = new AbortController();
  cancellation.abort('private fixture-key');
  const input = source([first()]);
  let delivered = 0;
  await invalid(
    consumeOpenRouterFunctionStream(
      input.stream,
      scope,
      () => {
        delivered++;
      },
      cancellation.signal,
    ),
  );
  assert.equal(input.pulls(), 0);
  assert.equal(delivered, 0);
  assert.equal(input.stream.locked, false);
});
