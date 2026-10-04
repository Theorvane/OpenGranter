import assert from 'node:assert/strict';
import test from 'node:test';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';
import { consumeDirectOpenAIFunctionResponse } from '../src/streaming/direct-openai-function-response.ts';

const scope = { upstreamModelId: 'native', clientModelAlias: 'alias' };
const identity = { id: 's', created: 4, model: 'native', object: 'chat.completion.chunk' };
const chunk = (delta: unknown, finish: string | null = null) => ({
  ...identity,
  choices: [{ index: 0, delta, finish_reason: finish }],
  usage: null,
});
const usage = () => ({
  ...identity,
  choices: [],
  usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
});
function source(events: unknown[]) {
  return new Response(
    events
      .map((event) => `data: ${event === '[DONE]' ? event : JSON.stringify(event)}\n\n`)
      .join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
const calls = [
  chunk({
    role: 'assistant',
    tool_calls: [
      { index: 1, id: 'b', type: 'function', function: { name: 'lookup', arguments: '{"q":' } },
      { index: 0, id: 'a', type: 'function', function: { name: 'lookup', arguments: '{"q":' } },
    ],
  }),
  chunk({
    tool_calls: [
      { index: 0, function: { arguments: '"private α"}' } },
      { index: 1, function: { arguments: '"private β"}' } },
    ],
  }),
  chunk({}, 'tool_calls'),
  usage(),
  '[DONE]',
];
test('native function response validates interleaved indexed calls and final usage', async () => {
  const deltas: unknown[] = [];
  const result = await consumeDirectOpenAIFunctionResponse(source(calls), scope, (delta) => {
    deltas.push(delta);
  });
  assert.equal(result.model, 'alias');
  assert.equal(result.finishReason, 'tool_calls');
  assert.equal(result.usage?.total_tokens, 3);
  assert.deepEqual(
    result.toolCalls?.map((call) => call.id),
    ['a', 'b'],
  );
  assert.equal(result.toolCalls?.[0]?.function.arguments, '{"q":"private α"}');
  assert.ok(JSON.stringify(deltas).includes('private'));
  assert.equal(deltas.length, 3);
});
test('native function response accepts text continuation and unknown final usage without counters', async () => {
  const result = await consumeDirectOpenAIFunctionResponse(
    source([
      chunk({ content: 'private answer' }),
      chunk({}, 'stop'),
      { ...usage(), usage: null },
      '[DONE]',
    ]),
    scope,
    () => {},
  );
  assert.equal(result.toolCalls, undefined);
  assert.equal(result.usage, undefined);
});
for (const variant of [
  'wrong-model',
  'created',
  'missing-usage',
  'missing-done',
  'sparse',
  'duplicate-id',
  'changed-id',
  'refusal',
  'custom',
  'deprecated',
  'reasoning',
  'ordinary-usage',
] as const)
  test(`native function response rejects ${variant} safely`, async () => {
    let events: unknown[] = [...calls];
    if (variant === 'wrong-model') events[0] = { ...chunk({ content: 'private' }), model: 'wrong' };
    if (variant === 'created') events[1] = { ...chunk({}), created: 5 };
    if (variant === 'missing-usage') events.splice(3, 1);
    if (variant === 'missing-done') events.pop();
    if (variant === 'sparse')
      events = [
        chunk({
          tool_calls: [
            { index: 1, id: 'a', type: 'function', function: { name: 'lookup', arguments: '{}' } },
          ],
        }),
        chunk({}, 'tool_calls'),
        usage(),
        '[DONE]',
      ];
    if (variant === 'duplicate-id')
      events[0] = chunk({
        tool_calls: [0, 1].map((index) => ({
          index,
          id: 'a',
          type: 'function',
          function: { name: 'lookup', arguments: '{}' },
        })),
      });
    if (variant === 'changed-id') events[1] = chunk({ tool_calls: [{ index: 0, id: 'changed' }] });
    if (variant === 'refusal') events[1] = chunk({ refusal: 'private refusal' });
    if (variant === 'custom')
      events[0] = chunk({
        tool_calls: [
          { index: 0, id: 'a', type: 'custom', custom: { name: 'lookup', input: 'private' } },
        ],
      });
    if (variant === 'deprecated')
      events[0] = chunk({ function_call: { name: 'lookup', arguments: 'private' } });
    if (variant === 'reasoning') events[0] = chunk({ reasoning: 'private reasoning' });
    if (variant === 'ordinary-usage') events[0] = { ...chunk({}), usage: { total_tokens: 3 } };
    await assert.rejects(
      consumeDirectOpenAIFunctionResponse(source(events), scope, () => {}),
      (error) =>
        error instanceof DirectProviderFailure &&
        error.responseStarted &&
        error.possiblyBilled &&
        !String(error).includes('private'),
    );
  });
for (const [status, category] of [
  [429, 'rate-limit'],
  [503, 'server-error'],
  [401, 'other'],
] as const)
  test(`native function response classifies HTTP ${status} without reading failure body`, async () => {
    await assert.rejects(
      consumeDirectOpenAIFunctionResponse(
        new Response('private failure', { status }),
        scope,
        () => {},
      ),
      (error) =>
        error instanceof DirectProviderFailure &&
        error.category === category &&
        !String(error).includes('private'),
    );
  });
test('native function response rejects wrong media and callback failure safely', async () => {
  await assert.rejects(
    consumeDirectOpenAIFunctionResponse(new Response('private body'), scope, () => {}),
    DirectProviderFailure,
  );
  await assert.rejects(
    consumeDirectOpenAIFunctionResponse(source(calls), scope, () => {
      throw Error('private callback');
    }),
    DirectProviderFailure,
  );
});
test('native function response awaits delivery and cancels a hanging body on abort', {
  timeout: 3000,
}, async () => {
  const cancellation = new AbortController();
  let cancelled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(calls[0])}\n\n`));
      },
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
  const running = consumeDirectOpenAIFunctionResponse(
    response,
    scope,
    async () => {
      cancellation.abort();
    },
    cancellation.signal,
  );
  await assert.rejects(running, DirectProviderFailure);
  assert.equal(cancelled, true);
});
