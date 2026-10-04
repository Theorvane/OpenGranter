import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenRouterFunctionStreamSequence } from '../src/streaming/openrouter-function-stream-sequence.ts';
import { decodeOpenRouterFunctionStreamPayload } from '../src/streaming/openrouter-stream-chunks.ts';
import { OpenRouterStreamSequenceFailure } from '../src/streaming/openrouter-stream-sequence.ts';

const scope = { upstreamModelId: 'model', clientModelAlias: 'approved' };
function delta(
  value: Record<string, unknown> = {},
  finish: string | null = null,
  usage?: unknown,
  id = 'gen',
) {
  return decodeOpenRouterFunctionStreamPayload(
    JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'model',
      choices: [{ index: 0, delta: value, finish_reason: finish }],
      ...(usage === undefined ? {} : { usage }),
    }),
    scope,
  );
}
const call = (index = 0, id = `call_${index}`) => ({
  index,
  id,
  type: 'function',
  function: { name: 'private_lookup', arguments: '' },
});
const done = () => decodeOpenRouterFunctionStreamPayload('[DONE]', scope);
function complete(
  sequence: OpenRouterFunctionStreamSequence,
  finish = 'tool_calls',
  usage: unknown = {},
) {
  sequence.accept(delta({}, finish));
  sequence.accept(delta({}, finish, usage));
  sequence.accept(done());
  return sequence.finish();
}
function invalid(action: () => unknown) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof OpenRouterStreamSequenceFailure);
    assert.equal(error.possiblyBilled, true);
    assert.equal(error.message, 'Invalid OpenRouter stream sequence');
    return true;
  });
}

test('function sequence assembles interleaved exact arguments and freezes completed calls', () => {
  const sequence = new OpenRouterFunctionStreamSequence();
  sequence.accept(
    delta({ role: 'assistant', content: 'private prelude', reasoning: 'private reasoning' }),
  );
  sequence.accept(
    delta({
      tool_calls: [
        { ...call(1), function: { name: 'private_lookup', arguments: '{"q":' } },
        call(0),
      ],
    }),
  );
  sequence.accept(
    delta({
      tool_calls: [
        { index: 1, function: { arguments: '"終"}' } },
        { index: 0, function: { arguments: 'private not JSON' } },
      ],
    }),
  );
  sequence.accept(
    delta({
      tool_calls: [
        { index: 1, id: 'call_1', type: 'function', function: { name: 'private_lookup' } },
      ],
    }),
  );
  assert.doesNotMatch(JSON.stringify(sequence), /private|call_1|終/u);
  const result = complete(sequence, 'tool_calls', { prompt_tokens: 2, completion_tokens: 1 });
  assert.equal(result.status, 'complete');
  if (result.status !== 'complete') assert.fail('Expected complete');
  assert.equal(result.finishReason, 'tool_calls');
  assert.equal(result.model, 'approved');
  assert.deepEqual(result.toolCalls, [
    {
      id: 'call_0',
      type: 'function',
      function: { name: 'private_lookup', arguments: 'private not JSON' },
    },
    {
      id: 'call_1',
      type: 'function',
      function: { name: 'private_lookup', arguments: '{"q":"終"}' },
    },
  ]);
  assert.deepEqual(result.usage, { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.toolCalls));
  for (const item of result.toolCalls ?? []) {
    assert.ok(Object.isFrozen(item));
    assert.ok(Object.isFrozen(item.function));
  }
  assert.doesNotMatch(JSON.stringify(sequence), /private|call_1|終/u);
  invalid(() => sequence.finish());
});

test('function sequence supports late metadata and explicitly empty argument strings', () => {
  const sequence = new OpenRouterFunctionStreamSequence();
  sequence.accept(delta({ tool_calls: [{ index: 0, function: { arguments: '' } }] }));
  sequence.accept(
    delta({
      tool_calls: [{ index: 0, id: 'call', type: 'function', function: { name: 'lookup' } }],
    }),
  );
  const result = complete(sequence);
  if (result.status !== 'complete') assert.fail('Expected complete');
  assert.deepEqual(result.toolCalls, [
    { id: 'call', type: 'function', function: { name: 'lookup', arguments: '' } },
  ]);
});

test('function sequence rejects incomplete, sparse, duplicate or conflicting calls', () => {
  for (const calls of [
    [{ index: 0 }],
    [{ index: 0, id: '', type: 'function', function: { name: 'lookup', arguments: '' } }],
    [{ index: 0, id: 'call', function: { name: 'lookup', arguments: '' } }],
    [{ index: 0, id: 'call', type: 'function', function: { name: '', arguments: '' } }],
    [{ index: 0, id: 'call', type: 'function', function: { name: 'lookup' } }],
    [call(1)],
    [call(0, 'duplicate'), call(1, 'duplicate')],
  ]) {
    const sequence = new OpenRouterFunctionStreamSequence();
    sequence.accept(delta({ tool_calls: calls }));
    invalid(() => sequence.accept(delta({}, 'tool_calls')));
    invalid(() => sequence.finish());
  }
  for (const fragment of [
    { index: 0, id: 'changed' },
    { index: 0, function: { name: 'changed' } },
  ]) {
    const sequence = new OpenRouterFunctionStreamSequence();
    sequence.accept(delta({ tool_calls: [call()] }));
    invalid(() => sequence.accept(delta({ tool_calls: [fragment] })));
    invalid(() => sequence.finish());
  }
});

test('function sequence enforces call/refusal/finish consistency across chunks', () => {
  for (const finish of ['stop', 'length', 'content_filter']) {
    const sequence = new OpenRouterFunctionStreamSequence();
    sequence.accept(delta({ tool_calls: [call()] }));
    invalid(() => sequence.accept(delta({}, finish)));
  }
  const empty = new OpenRouterFunctionStreamSequence();
  empty.accept(delta({ tool_calls: [] }));
  invalid(() => empty.accept(delta({}, 'tool_calls')));
  for (const refusalFirst of [false, true]) {
    const sequence = new OpenRouterFunctionStreamSequence();
    const refusal = delta({ refusal: 'private refusal' }),
      calls = delta({ tool_calls: [call()] });
    sequence.accept(refusalFirst ? refusal : calls);
    sequence.accept(refusalFirst ? calls : refusal);
    invalid(() => sequence.accept(delta({}, 'tool_calls')));
  }
});

test('function sequence preserves ordinary outcomes, final metadata and unknown usage', () => {
  for (const reported of [{}, { total_tokens: 'invalid' }]) {
    const sequence = new OpenRouterFunctionStreamSequence();
    sequence.accept(delta({ content: 'private text' }, 'stop'));
    sequence.accept(
      decodeOpenRouterFunctionStreamPayload(
        JSON.stringify({
          id: 'gen',
          object: 'chat.completion.chunk',
          created: 2,
          model: 'model',
          system_fingerprint: null,
          service_tier: 'tier',
          choices: [],
          usage: reported,
        }),
        scope,
      ),
    );
    sequence.accept(done());
    const result = sequence.finish();
    if (result.status !== 'complete') assert.fail('Expected complete');
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.toolCalls, undefined);
    assert.equal(result.systemFingerprint, null);
    assert.equal(result.serviceTier, 'tier');
    assert.deepEqual(
      result.usage,
      Object.keys(reported).length ? { total_tokens: null } : undefined,
    );
    assert.doesNotMatch(JSON.stringify(result), /private/u);
  }
});

test('function sequence requires identity and terminal usage done order', () => {
  for (const events of [
    [done()],
    [delta({}, 'tool_calls', {})],
    [delta({ tool_calls: [call()] }), done()],
    [delta({ tool_calls: [call()] }), delta({}, 'tool_calls'), done()],
    [delta({ tool_calls: [call()] }), delta({}, 'tool_calls'), delta({}, 'stop', {})],
    [delta({ tool_calls: [call()] }), delta({}, 'tool_calls'), delta({ content: 'late' })],
    [delta({ tool_calls: [call()] }), delta({}, null, undefined, 'changed')],
  ]) {
    const sequence = new OpenRouterFunctionStreamSequence();
    invalid(() => {
      for (const event of events) sequence.accept(event);
    });
    invalid(() => sequence.finish());
  }
  for (const events of [
    [],
    [delta({ tool_calls: [call()] })],
    [delta({ tool_calls: [call()] }), delta({}, 'tool_calls')],
    [delta({ tool_calls: [call()] }), delta({}, 'tool_calls'), delta({}, 'tool_calls', {})],
  ]) {
    const sequence = new OpenRouterFunctionStreamSequence();
    for (const event of events) sequence.accept(event);
    invalid(() => sequence.finish());
  }
  const sequence = new OpenRouterFunctionStreamSequence();
  sequence.accept(delta({ tool_calls: [call()] }));
  complete(sequence);
  invalid(() => sequence.accept(done()));
});

test('function sequence clears private calls on upstream error and rejects content budget overflow', () => {
  const failed = new OpenRouterFunctionStreamSequence();
  failed.accept(delta({ tool_calls: [call()] }));
  failed.accept({ kind: 'error' });
  assert.deepEqual(failed.finish(), { status: 'failed', possiblyBilled: true });
  assert.doesNotMatch(JSON.stringify(failed), /private_lookup|call_0/u);
  invalid(() => failed.finish());
  const budget = 1_048_576;
  const sequence = new OpenRouterFunctionStreamSequence();
  sequence.accept(
    delta({
      tool_calls: [
        {
          index: 0,
          id: 'i',
          type: 'function',
          function: { name: 'n', arguments: '終'.repeat(budget - 2) },
        },
      ],
    }),
  );
  const result = complete(sequence);
  if (result.status !== 'complete') assert.fail('Expected complete');
  assert.equal(result.toolCalls?.[0]?.function.arguments.length, budget - 2);
  const overflow = new OpenRouterFunctionStreamSequence();
  overflow.accept(
    delta({
      tool_calls: [
        {
          index: 0,
          id: 'i',
          type: 'function',
          function: { name: 'n', arguments: 'x'.repeat(budget - 2) },
        },
      ],
    }),
  );
  invalid(() =>
    overflow.accept(delta({ tool_calls: [{ index: 0, function: { arguments: 'x' } }] })),
  );
  assert.doesNotMatch(JSON.stringify(overflow), /private_lookup/u);
  invalid(() => overflow.finish());
});

test('function sequence validates all 128 calls and aggregate content across calls', () => {
  const sequence = new OpenRouterFunctionStreamSequence();
  sequence.accept(
    delta({ refusal: '', tool_calls: Array.from({ length: 128 }, (_, index) => call(index)) }),
  );
  const result = complete(sequence);
  if (result.status !== 'complete') assert.fail('Expected complete');
  assert.equal(result.toolCalls?.length, 128);
  assert.equal(result.toolCalls?.[127]?.id, 'call_127');
  const overflow = new OpenRouterFunctionStreamSequence();
  overflow.accept(
    delta({
      tool_calls: [
        {
          index: 0,
          id: 'i',
          type: 'function',
          function: { name: 'n', arguments: 'x'.repeat(1_048_573) },
        },
      ],
    }),
  );
  invalid(() =>
    overflow.accept(
      delta({
        tool_calls: [
          { index: 1, id: 'j', type: 'function', function: { name: 'm', arguments: '' } },
        ],
      }),
    ),
  );
});

test('function sequence handles upstream errors in every active phase without response payload', () => {
  for (const phase of ['open', 'terminal', 'usage']) {
    const sequence = new OpenRouterFunctionStreamSequence();
    sequence.accept(delta({ tool_calls: [call()] }));
    if (phase !== 'open') sequence.accept(delta({}, 'tool_calls'));
    if (phase === 'usage') sequence.accept(delta({}, 'tool_calls', {}));
    sequence.accept({ kind: 'error' });
    assert.deepEqual(sequence.finish(), { status: 'failed', possiblyBilled: true });
    assert.equal(JSON.stringify(sequence), '{}');
    invalid(() => sequence.accept(done()));
  }
});

test('function sequence rejects alias changes, duplicate usage and missing stable metadata', () => {
  const alias = new OpenRouterFunctionStreamSequence();
  alias.accept(delta({ tool_calls: [call()] }));
  const changed = delta({});
  if (changed.kind !== 'delta') assert.fail('Expected delta');
  invalid(() => alias.accept({ ...changed, model: 'other' }));
  const duplicate = new OpenRouterFunctionStreamSequence();
  duplicate.accept(delta({ tool_calls: [call()] }));
  duplicate.accept(delta({}, 'tool_calls'));
  duplicate.accept(delta({}, 'tool_calls', {}));
  invalid(() => duplicate.accept(delta({}, 'tool_calls', {})));
  const missing = new OpenRouterFunctionStreamSequence();
  missing.accept(
    delta({
      tool_calls: [{ index: 0, type: 'function', function: { name: 'lookup', arguments: '' } }],
    }),
  );
  invalid(() => missing.accept(delta({}, 'tool_calls')));
});
