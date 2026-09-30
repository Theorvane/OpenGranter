import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeOpenRouterStreamPayload,
  type OpenRouterTextStreamPayload,
} from '../src/streaming/openrouter-stream-chunks.ts';
import {
  OpenRouterStreamSequenceFailure,
  OpenRouterTextStreamSequence,
} from '../src/streaming/openrouter-stream-sequence.ts';

const scope = { upstreamModelId: 'openai/example', clientModelAlias: 'approved-chat' };

function payload(
  delta: Record<string, unknown>,
  finishReason: string | null = null,
  usage?: unknown,
  id = 'gen-1',
): OpenRouterTextStreamPayload {
  return decodeOpenRouterStreamPayload(
    JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created: 42,
      model: 'openai/example',
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      ...(usage === undefined ? {} : { usage }),
    }),
    scope,
  );
}

const terminal = () => payload({}, 'stop');
const usage = () => payload({}, 'stop', { prompt_tokens: 3, completion_tokens: 2 });
const done = () => decodeOpenRouterStreamPayload('[DONE]', scope);

function invalid(operation: () => unknown): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof OpenRouterStreamSequenceFailure);
    assert.equal(error.message, 'Invalid OpenRouter stream sequence');
    assert.equal(error.possiblyBilled, true);
    return true;
  });
}

test('completes only after terminal, usage and done without retaining text', () => {
  const sequence = new OpenRouterTextStreamSequence();
  sequence.accept(payload({ role: 'assistant' }));
  sequence.accept(payload({ content: 'private response' }));
  sequence.accept(terminal());
  sequence.accept(usage());
  sequence.accept(done());
  const result = sequence.finish();
  assert.deepEqual(result, {
    status: 'complete',
    id: 'gen-1',
    model: 'approved-chat',
    finishReason: 'stop',
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.usage), true);
  assert.equal(JSON.stringify(sequence).includes('private response'), false);
});

test('accepts empty-choice usage with no repeated finish reason', () => {
  const sequence = new OpenRouterTextStreamSequence();
  sequence.accept(terminal());
  sequence.accept(
    decodeOpenRouterStreamPayload(
      JSON.stringify({
        id: 'gen-1',
        object: 'chat.completion.chunk',
        created: 43,
        model: 'openai/example',
        choices: [],
        usage: { total_tokens: 5 },
      }),
      scope,
    ),
  );
  sequence.accept(done());
  assert.deepEqual(sequence.finish(), {
    status: 'complete',
    id: 'gen-1',
    model: 'approved-chat',
    finishReason: 'stop',
    usage: { total_tokens: 5 },
  });
});

test('preserves missing and invalid usage instead of inventing counters', () => {
  for (const [reported, expected] of [
    [{}, undefined],
    [{ total_tokens: 'private invalid' }, { total_tokens: null }],
  ] as const) {
    const sequence = new OpenRouterTextStreamSequence();
    sequence.accept(terminal());
    sequence.accept(payload({}, 'stop', reported));
    sequence.accept(done());
    const outcome = sequence.finish();
    assert.equal(outcome.status, 'complete');
    if (outcome.status === 'complete') assert.deepEqual(outcome.usage, expected);
  }
});

test('rejects mismatched identity and model alias across decoded events', () => {
  for (const changed of [
    payload({ content: 'private' }, null, undefined, 'gen-2'),
    { ...payload({ content: 'private' }), model: 'other-alias' },
  ]) {
    const sequence = new OpenRouterTextStreamSequence();
    sequence.accept(payload({ content: 'first' }));
    invalid(() => sequence.accept(changed));
  }
});

test('rejects incomplete and out-of-order terminal, usage and done', () => {
  for (const events of [
    [usage()],
    [done()],
    [terminal(), terminal()],
    [terminal(), payload({ content: 'late' })],
    [terminal(), usage(), usage()],
    [terminal(), done()],
    [terminal(), payload({}, 'length', { total_tokens: 5 })],
    [terminal(), usage(), done(), done()],
  ]) {
    const sequence = new OpenRouterTextStreamSequence();
    invalid(() => {
      for (const event of events) sequence.accept(event);
    });
  }
  for (const events of [
    [],
    [payload({ content: 'partial' })],
    [terminal()],
    [terminal(), usage()],
  ]) {
    const sequence = new OpenRouterTextStreamSequence();
    for (const event of events) sequence.accept(event);
    invalid(() => sequence.finish());
  }
});

test('first-event and midstream upstream errors return safe possibly billed outcomes', () => {
  for (const prior of [[], [payload({ content: 'private response' })]]) {
    const sequence = new OpenRouterTextStreamSequence();
    for (const event of prior) sequence.accept(event);
    sequence.accept(
      decodeOpenRouterStreamPayload(
        JSON.stringify({ error: { message: 'private upstream error', code: 'secret-code' } }),
        scope,
      ),
    );
    assert.deepEqual(sequence.finish(), { status: 'failed', possiblyBilled: true });
    assert.equal(JSON.stringify(sequence).includes('private'), false);
    invalid(() => sequence.accept(done()));
  }
});

test('completed and failed sequences cannot be finalized twice', () => {
  const sequence = new OpenRouterTextStreamSequence();
  sequence.accept(terminal());
  sequence.accept(usage());
  sequence.accept(done());
  sequence.finish();
  invalid(() => sequence.finish());
});

test('an invalid event poisons the sequence even if a later valid event arrives', () => {
  const sequence = new OpenRouterTextStreamSequence();
  sequence.accept(terminal());
  invalid(() => sequence.accept(payload({ content: 'late' })));
  invalid(() => sequence.accept(usage()));
  invalid(() => sequence.finish());
});
