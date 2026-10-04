import assert from 'node:assert/strict';
import test from 'node:test';
import { createDirectGoogleFunctionStreamInvoker } from '../src/providers/direct-google-function-stream.ts';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';
import { consumeDirectGoogleFunctionResponse } from '../src/streaming/direct-google-function-response.ts';
import { decodeDirectOpenAIFunctionPayload } from '../src/streaming/direct-openai-function-response.ts';
import { encodeOpenRouterFunctionSse } from '../src/streaming/openrouter-client-sse.ts';
import { OpenRouterFunctionStreamSequence } from '../src/streaming/openrouter-function-stream-sequence.ts';
import {
  decodeOpenRouterFunctionStreamPayload,
  type FunctionCallFragment,
} from '../src/streaming/openrouter-stream-chunks.ts';
import { OpenRouterStreamSequenceFailure } from '../src/streaming/openrouter-stream-sequence.ts';
import { call, chunk, frames } from './google-function-stream-fixture.ts';

const signature = 'private-signature+/==';
const extra = () => ({ google: { thought_signature: signature } });
const scope = { upstreamModelId: 'gemini-exact', clientModelAlias: 'chat' };
const terminal = () =>
  chunk([], 'STOP', { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 7 });
const signed = (id = 'one', value: unknown = signature) => ({
  ...call(id),
  thoughtSignature: value,
});
const response = (events: object[]) =>
  new Response(frames(events), { headers: { 'content-type': 'text/event-stream' } });
const consume = (events: object[]) =>
  consumeDirectGoogleFunctionResponse(response(events), scope, () => {});
const safe = (e: unknown) =>
  e instanceof DirectProviderFailure &&
  e.possiblyBilled &&
  e.responseStarted &&
  e.message === 'Direct provider attempt failed';
const delta = (calls: readonly FunctionCallFragment[]) => ({
  kind: 'delta' as const,
  id: 'gen',
  model: 'chat',
  created: 1,
  finishReason: null,
  toolCalls: calls,
});
const fragment = (value = signature, index = 0): FunctionCallFragment => ({
  index,
  id: `call_${index}`,
  type: 'function',
  function: { name: 'lookup', arguments: '{}' },
  extra_content: { google: { thought_signature: value } },
});
function finish(s: OpenRouterFunctionStreamSequence) {
  s.accept({ ...delta([]), finishReason: 'tool_calls' });
  s.accept({
    kind: 'usage',
    id: 'gen',
    model: 'chat',
    created: 1,
    finishReason: null,
    usage: undefined,
  });
  s.accept({ kind: 'done' });
  return s.finish();
}
test('signed Gemini complete parallel/separate calls preserve exact frozen association in deltas and completion', async () => {
  const seen: unknown[] = [];
  const result = await consumeDirectGoogleFunctionResponse(
    response([
      chunk([{ text: 'private prelude' }, signed(), call('two')]),
      chunk([signed('three', 'private-next')]),
      terminal(),
    ]),
    scope,
    (d) => {
      seen.push(d);
    },
  );
  assert.equal(result.finishReason, 'tool_calls');
  assert.deepEqual(
    result.toolCalls?.map((c) => c.extra_content),
    [extra(), undefined, { google: { thought_signature: 'private-next' } }],
  );
  assert.ok(Object.isFrozen(result.toolCalls?.[0]?.extra_content?.google));
  assert.equal(result.usage?.total_tokens, 7);
  const events = seen as { toolCalls?: FunctionCallFragment[] }[];
  assert.deepEqual(
    events.flatMap((d) => d.toolCalls ?? []).map((c) => c.extra_content),
    result.toolCalls?.map((c) => c.extra_content),
  );
});
test('signed native missing-ID stream preserves gateway correlation and exact signature', async () => {
  const result = await consume([
    chunk([{ functionCall: { name: 'lookup' }, thoughtSignature: signature }]),
    terminal(),
  ]);
  assert.match(result.toolCalls?.[0]?.id ?? '', /^og_google_missing_id_[0-9a-f-]{36}$/u);
  assert.deepEqual(result.toolCalls?.[0]?.extra_content, extra());
});
test('shared private sequence snapshots signatures and does not double-charge stable repeated metadata', () => {
  const f = fragment(),
    s = new OpenRouterFunctionStreamSequence();
  s.accept(delta([f]));
  assert.ok(f.extra_content);
  Reflect.set(f.extra_content.google, 'thought_signature', 'changed');
  s.accept(delta([{ index: 0, extra_content: extra() }]));
  const result = finish(s);
  assert.equal(result.status, 'complete');
  if (result.status !== 'complete') assert.fail();
  assert.deepEqual(result.toolCalls?.[0]?.extra_content, extra());
  assert.ok(Object.isFrozen(result.toolCalls?.[0]?.extra_content?.google));
  assert.equal(JSON.stringify(s), '{}');
});
test('shared sequence charges signatures and arguments together at exact aggregate boundary', () => {
  const s = new OpenRouterFunctionStreamSequence();
  // call_0=6, lookup=6, args=2, leaving this exact signature budget.
  const f = fragment('x'.repeat(1_048_576 - 14));
  s.accept(delta([f]));
  assert.ok(f.extra_content);
  s.accept(delta([{ index: 0, extra_content: f.extra_content }]));
  assert.equal(finish(s).status, 'complete');
  const overflow = new OpenRouterFunctionStreamSequence();
  overflow.accept(delta([f]));
  assert.throws(
    () => overflow.accept(delta([{ index: 0, function: { arguments: 'x' } }])),
    OpenRouterStreamSequenceFailure,
  );
  assert.throws(() => overflow.finish(), OpenRouterStreamSequenceFailure);
});
for (const bad of ['', null, 42, {}, 'x'.repeat(1_048_577)])
  test('shared sequence rejects malformed signature and permanently discards private assembly', () => {
    const s = new OpenRouterFunctionStreamSequence();
    assert.throws(
      () =>
        s.accept(
          delta([
            {
              ...fragment(),
              extra_content: { google: { thought_signature: bad } },
            } as FunctionCallFragment,
          ]),
        ),
      OpenRouterStreamSequenceFailure,
    );
    assert.equal(JSON.stringify(s), '{}');
    assert.throws(() => finish(s), OpenRouterStreamSequenceFailure);
  });
test('shared sequence rejects conflicting signature replacement and discards on error', () => {
  const s = new OpenRouterFunctionStreamSequence();
  s.accept(delta([fragment()]));
  assert.throws(
    () =>
      s.accept(delta([{ index: 0, extra_content: { google: { thought_signature: 'other' } } }])),
    OpenRouterStreamSequenceFailure,
  );
  assert.throws(() => finish(s), OpenRouterStreamSequenceFailure);
  const failed = new OpenRouterFunctionStreamSequence();
  failed.accept(delta([fragment()]));
  failed.accept({ kind: 'error' });
  assert.deepEqual(failed.finish(), { status: 'failed', possiblyBilled: true });
});
test('trusted outbound function SSE preserves Google metadata while unrelated inbound decoders reject it', () => {
  const frame = encodeOpenRouterFunctionSse(delta([fragment()]));
  assert.ok(frame);
  const wire = JSON.parse(frame.slice(6, -2));
  assert.deepEqual(wire.choices[0].delta.tool_calls[0].extra_content, extra());
  assert.throws(() =>
    decodeOpenRouterFunctionStreamPayload(
      JSON.stringify({ ...wire, model: 'gemini-exact' }),
      scope,
    ),
  );
  assert.throws(() =>
    decodeDirectOpenAIFunctionPayload(JSON.stringify({ ...wire, model: 'gemini-exact' }), scope),
  );
  for (const metadata of [
    undefined,
    null,
    { google: { thought_signature: '' } },
    { google: { thought_signature: signature }, other: true },
  ]) {
    assert.throws(
      () =>
        encodeOpenRouterFunctionSse(
          delta([{ ...fragment(), extra_content: metadata } as FunctionCallFragment]),
        ),
      (e) => e instanceof Error && !e.message.includes(signature),
    );
  }
});
for (const bad of ['', null, 42, {}, 'x'.repeat(1_048_577)])
  test('native malformed stream signature fails opened without exposing private error', async () => {
    await assert.rejects(consume([chunk([signed('one', bad)]), terminal()]), safe);
  });
for (const part of [
  { text: '', thoughtSignature: signature },
  { thoughtSignature: signature },
  { functionCall: {}, thoughtSignature: signature },
  { functionCall: { partialArgs: [] }, thoughtSignature: signature },
])
  test('signed text and unassociated/partial native signature chunks remain closed after signed calls', async () => {
    await assert.rejects(consume([chunk([signed()]), chunk([part]), terminal()]), safe);
  });
test('signed native streams enforce total retained budget across separately valid events', async () => {
  await assert.rejects(
    consume([
      chunk([signed('one', 'x'.repeat(600000))]),
      chunk([signed('two', 'y'.repeat(600000))]),
      terminal(),
    ]),
    safe,
  );
});
test('signed native callback failure and abort cannot certify complete calls', async () => {
  const controller = new AbortController();
  for (const abort of [false, true])
    await assert.rejects(
      consumeDirectGoogleFunctionResponse(
        response([chunk([signed()]), terminal()]),
        scope,
        (d) => {
          if (d.toolCalls) {
            if (abort) controller.abort('private abort');
            else throw Error('private callback');
          }
        },
        abort ? controller.signal : undefined,
      ),
      safe,
    );
});
test('Google function transport captures signed history before key lookup and preserves call association', async () => {
  const metadata = extra();
  const request = {
    model: 'chat',
    messages: [
      { role: 'user' as const, content: 'private prompt' },
      {
        role: 'assistant' as const,
        content: null,
        tool_calls: [
          {
            id: 'prior',
            type: 'function' as const,
            function: { name: 'lookup', arguments: '{}' },
            extra_content: metadata,
          },
        ],
      },
      { role: 'tool' as const, tool_call_id: 'prior', content: 'private result' },
      {
        role: 'assistant' as const,
        content: null,
        tool_calls: [
          {
            id: 'next',
            type: 'function' as const,
            function: { name: 'lookup', arguments: '{}' },
            extra_content: { google: { thought_signature: 'private-next' } },
          },
        ],
      },
      { role: 'tool' as const, tool_call_id: 'next', content: 'private next result' },
    ],
  };
  const invoke = createDirectGoogleFunctionStreamInvoker({
    registrations: [{ providerId: 'google', kind: 'google', credentialRef: 'ref' }],
    resolveSecret: async () => {
      metadata.google.thought_signature = 'changed';
      return 'fixture-key';
    },
    fetcher: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.contents[1].parts, [
        { functionCall: { id: 'prior', name: 'lookup', args: {} }, thoughtSignature: signature },
      ]);
      assert.equal(body.contents[2].parts[0].thoughtSignature, undefined);
      assert.equal(body.contents[3].parts[0].thoughtSignature, 'private-next');
      assert.equal(body.contents[4].parts[0].functionResponse.id, 'next');
      return response([chunk([signed()]), terminal()]);
    },
  });
  assert.deepEqual(
    (
      await invoke(
        { id: 'one', kind: 'managed', providerId: 'google', upstreamModelId: 'gemini-exact' },
        request,
        () => {},
      )
    ).toolCalls?.[0]?.extra_content,
    extra(),
  );
});
