import assert from 'node:assert/strict';
import test from 'node:test';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';
import { consumeDirectGoogleFunctionResponse } from '../src/streaming/direct-google-function-response.ts';

const scope = () => ({ upstreamModelId: 'gemini-exact', clientModelAlias: 'chat' });
const chunk = (
  parts: object[] = [{ text: 'private answer' }],
  finishReason?: string,
  usageMetadata?: unknown,
) => ({
  responseId: 'response',
  modelVersion: 'gemini-exact',
  candidates: [
    {
      index: 0,
      content: { role: 'model', parts },
      ...(finishReason === undefined ? {} : { finishReason }),
    },
  ],
  ...(usageMetadata === undefined ? {} : { usageMetadata }),
});
const end = (
  usage: unknown = { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 7 },
) => chunk([], 'STOP', usage);
const frame = (events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
const response = (events: object[] = [chunk(), end()]) =>
  new Response(frame(events), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
const safe = (e: unknown) =>
  e instanceof DirectProviderFailure &&
  e.responseStarted &&
  e.possiblyBilled &&
  e.message === 'Direct provider attempt failed';
const consume = (events: object[] = [chunk(), end()]) =>
  consumeDirectGoogleFunctionResponse(response(events), scope(), () => {}, undefined, 42);
test('Gemini function-mode text stream projects exact identity and gateway timestamp without retaining content', async () => {
  const seen: unknown[] = [];
  const result = await consumeDirectGoogleFunctionResponse(
    response([chunk([{ text: 'private answer' }, { text: ' 終😀', thought: false }]), end()]),
    scope(),
    (d) => {
      seen.push(d);
    },
    undefined,
    42,
  );
  assert.equal(result.model, 'chat');
  assert.equal(result.id, 'response');
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.usage?.total_tokens, 7);
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.ok(Object.isFrozen(result));
  assert.ok(JSON.stringify(seen).includes('終😀'));
  for (const d of seen as { created: number; model: string }[]) {
    assert.equal(d.created, 42);
    assert.equal(d.model, 'chat');
  }
});
for (const [reason, finish] of [
  ['STOP', 'stop'],
  ['MAX_TOKENS', 'length'],
  ['SAFETY', 'content_filter'],
] as const)
  test(`native ${reason} maps to ${finish}`, async () => {
    assert.equal(
      (await consume([chunk(), chunk([], reason, { totalTokenCount: 7 })])).finishReason,
      finish,
    );
  });
test('prompt SAFETY with no candidates maps to content_filter', async () => {
  assert.equal(
    (
      await consume([
        {
          responseId: 'response',
          modelVersion: 'gemini-exact',
          promptFeedback: { blockReason: 'SAFETY' },
          usageMetadata: { promptTokenCount: 2, totalTokenCount: 2 },
        },
      ])
    ).finishReason,
    'content_filter',
  );
});
test('later omitted identities retain the first binding and metadata-only final usage replaces counters', async () => {
  const result = await consume([
    chunk(),
    {
      candidates: [{ index: 0, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
    },
    { usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 7 } },
  ]);
  assert.equal(result.usage?.total_tokens, 7);
  assert.equal(result.id, 'response');
});
for (const [value, expected] of [
  [null, undefined],
  [{}, undefined],
  [
    { promptTokenCount: 2, candidatesTokenCount: 3 },
    { prompt_tokens: 2, completion_tokens: 3 },
  ],
  [
    { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 7 },
    { prompt_tokens: 2, completion_tokens: 3, total_tokens: 7 },
  ],
  [
    { promptTokenCount: -1, candidatesTokenCount: 3, totalTokenCount: NaN },
    { prompt_tokens: null, completion_tokens: 3, total_tokens: null },
  ],
  [{ candidatesTokenCount: 3 }, { completion_tokens: 3 }],
] as const)
  test('Google preserves final missing/invalid total without assuming hidden thought counts', async () => {
    assert.deepEqual(
      (
        await consume([
          chunk([], undefined, { promptTokenCount: 100, totalTokenCount: 100 }),
          chunk(),
          end(value),
        ])
      ).usage,
      expected,
    );
  });
for (const events of [
  [],
  [chunk()],
  [end(), chunk()],
  [end(), end()],
  [end(), { usageMetadata: {} }, { usageMetadata: {} }],
  [chunk(), { error: { message: 'private key' } }],
  [{ ...chunk(), modelVersion: 'gemini-other' }, end()],
  [{ ...chunk(), responseId: '' }, end()],
  [{ ...chunk(), responseId: 'x'.repeat(257) }, end()],
  [{ ...chunk(), modelVersion: undefined }, end()],
  [chunk(), { ...end(), responseId: 'other' }],
  [chunk(), { ...end(), modelVersion: 'other' }],
  [chunk([{ text: 'private thought', thought: true }]), end()],
  [chunk([{ text: '', thoughtSignature: 'private signature' }]), end()],
  [chunk([{ inlineData: { data: 'private' } }]), end()],
  [chunk([{ text: 'private', thought: null }]), end()],
  [chunk(), chunk([{ text: 'private' }], 'SAFETY')],
  [{ ...chunk(), candidates: [{ index: 1, content: { parts: [{ text: 'private' }] } }] }, end()],
  [{ ...chunk(), candidates: [...chunk().candidates, ...chunk().candidates] }, end()],
  [
    { ...chunk(), candidates: [{ content: { role: 'user', parts: [{ text: 'private' }] } }] },
    end(),
  ],
  [
    {
      ...chunk(),
      candidates: [{ content: { parts: [{ text: 'private' }] }, groundingMetadata: {} }],
    },
    end(),
  ],
  [chunk(), chunk([], 'RECITATION')],
  [chunk(), chunk([], 'MALFORMED_FUNCTION_CALL')],
  [
    {
      responseId: 'response',
      modelVersion: 'gemini-exact',
      promptFeedback: { blockReason: 'OTHER' },
    },
  ],
  [{ ...chunk(), promptFeedback: { blockReason: 'SAFETY' } }],
  [
    chunk(),
    {
      responseId: 'response',
      modelVersion: 'gemini-exact',
      promptFeedback: { blockReason: 'SAFETY' },
    },
  ],
  [chunk(), { usageMetadata: { totalTokenCount: 2 } }, end()],
])
  test('unsupported, outside-scope, malformed and incomplete native Google streams fail safely', async () => {
    await assert.rejects(consume(events), safe);
  });
test('Google waits for clean EOF after terminal and rejects a reader error', async () => {
  let delivered = 0;
  const r = new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(frame([chunk(), end()])));
      },
      pull(c) {
        c.error(Error('private network'));
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
  await assert.rejects(
    consumeDirectGoogleFunctionResponse(r, scope(), () => {
      delivered++;
    }),
    safe,
  );
  assert.equal(delivered, 3);
});
test('Google rejects more than 128 text parts in one event', async () => {
  await assert.rejects(
    consume([chunk(Array.from({ length: 129 }, () => ({ text: 'private' }))), end()]),
    safe,
  );
});
for (const [status, category] of [
  [429, 'rate-limit'],
  [503, 'server-error'],
  [400, 'other'],
] as const)
  test(`Google HTTP ${status} cancels without reading private failure body`, async () => {
    let read = 0,
      cancelled = false;
    const r = new Response(
      new ReadableStream<Uint8Array>({
        pull() {
          read++;
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status },
    );
    await assert.rejects(
      consumeDirectGoogleFunctionResponse(r, scope(), () => {}),
      (e) => safe(e) && e instanceof DirectProviderFailure && e.category === category,
    );
    assert.equal(read, 0);
    assert.equal(cancelled, true);
  });
test('Google rejects invalid media, UTF-8, oversized SSE and invalid timestamp safely', async () => {
  for (const r of [
    new Response('private'),
    new Response(null, { headers: { 'content-type': 'text/event-stream' } }),
    new Response(new Uint8Array([255]), { headers: { 'content-type': 'text/event-stream' } }),
    new Response(`data: ${'x'.repeat(1048577)}\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    }),
  ])
    await assert.rejects(
      consumeDirectGoogleFunctionResponse(r, scope(), () => {}),
      safe,
    );
  await assert.rejects(
    consumeDirectGoogleFunctionResponse(response(), scope(), () => {}, undefined, -1),
    safe,
  );
});
test('Google awaits callbacks and captures scope before mutation', async () => {
  const captured = scope();
  let calls = 0,
    release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const pending = consumeDirectGoogleFunctionResponse(
    response(),
    captured,
    async () => {
      calls++;
      if (calls === 1) {
        captured.upstreamModelId = 'other';
        captured.clientModelAlias = 'other';
        await gate;
      }
    },
    undefined,
    42,
  );
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 1);
  release();
  assert.equal((await pending).model, 'chat');
  assert.equal(calls, 3);
});
test('Google callback failure and pending abort remain opened possibly-billed failures', async () => {
  await assert.rejects(
    consumeDirectGoogleFunctionResponse(response(), scope(), () => {
      throw Error('private callback');
    }),
    safe,
  );
  const controller = new AbortController();
  await assert.rejects(
    consumeDirectGoogleFunctionResponse(
      response(),
      scope(),
      () => {
        controller.abort('private abort');
        return new Promise(() => {});
      },
      controller.signal,
    ),
    safe,
  );
});

test('Gemini terminal followed by a partial unframed event never reports success', async () => {
  for (const trailing of [
    'data: {"error":{"message":"private"}}',
    'data: {"usageMetadata":{}}\n',
    'data: ' + JSON.stringify(end()) + '\n',
  ])
    await assert.rejects(
      consumeDirectGoogleFunctionResponse(
        new Response(frame([chunk(), end()]) + trailing, {
          headers: { 'content-type': 'text/event-stream' },
        }),
        scope(),
        () => {},
      ),
      safe,
    );
});

const functionPart = (
  id: string | undefined = 'call_one',
  args: unknown = { q: 'private 終' },
) => ({ functionCall: { ...(id === undefined ? {} : { id }), name: 'lookup', args } });
test('Gemini complete objects in separate and parallel chunks emit dense calls with mixed Unicode text', async () => {
  const seen: { created: number; toolCalls?: readonly { index: number }[] }[] = [];
  const result = await consumeDirectGoogleFunctionResponse(
    response([
      chunk([{ text: 'private intro' }, functionPart()]),
      chunk([functionPart('call_two', { q: 'private 😀' }), functionPart('call_three', {})]),
      end(),
    ]),
    scope(),
    (d) => {
      seen.push(d);
    },
    undefined,
    42,
  );
  assert.equal(result.finishReason, 'tool_calls');
  assert.deepEqual(
    result.toolCalls?.map((c) => c.id),
    ['call_one', 'call_two', 'call_three'],
  );
  assert.equal(result.toolCalls?.[1]?.function.arguments, '{"q":"private 😀"}');
  assert.deepEqual(
    seen.flatMap((d) => d.toolCalls?.map((c) => c.index) ?? []),
    [0, 1, 2],
  );
  assert.ok(Object.isFrozen(result.toolCalls));
  assert.equal(result.usage?.total_tokens, 7);
});
test('Gemini missing call ID and omitted args preserve gateway correlation semantics', async () => {
  const result = await consume([chunk([{ functionCall: { name: 'lookup' } }]), end()]);
  assert.match(result.toolCalls?.[0]?.id ?? '', /^og_google_missing_id_[0-9a-f-]{36}$/u);
  assert.equal(result.toolCalls?.[0]?.function.arguments, '{}');
});
for (const parts of [
  [functionPart(), functionPart()],
  [functionPart('', {})],
  [functionPart('og_google_missing_id_00000000-0000-0000-0000-000000000000', {})],
  [functionPart('one', null)],
  [functionPart('one', [])],
  [functionPart('one', 1)],
  [{ functionCall: { name: 'bad.name', args: {} } }],
  [{ functionCall: { name: 'lookup', args: {}, partialArgs: [] } }],
  [{ functionCall: { name: 'lookup', args: {}, willContinue: true } }],
  [{ ...functionPart(), thoughtSignature: 42 }],
  [{ ...functionPart(), thought: true }],
  [{ ...functionPart(), text: 'private text' }],
  [functionPart('one', { q: Array.from({ length: 20001 }, () => null) })],
])
  test('Gemini invalid whole calls never become terminal success', async () => {
    await assert.rejects(consume([chunk(parts), end()]), safe);
  });
for (const finish of ['MAX_TOKENS', 'SAFETY'])
  test(`Gemini ${finish} cannot complete prior calls`, async () => {
    await assert.rejects(consume([chunk([functionPart()]), chunk([], finish)]), safe);
  });
test('Gemini duplicate native call IDs across events fail before repeated call delivery', async () => {
  let calls = 0;
  await assert.rejects(
    consumeDirectGoogleFunctionResponse(
      response([chunk([functionPart()]), chunk([functionPart()]), end()]),
      scope(),
      (d) => {
        calls += d.toolCalls?.length ?? 0;
      },
    ),
    safe,
  );
  assert.equal(calls, 1);
});
test('Gemini prevalidates a whole mixed event before exposing any private part', async () => {
  let delivered = 0;
  await assert.rejects(
    consumeDirectGoogleFunctionResponse(
      response([chunk([{ text: 'private' }, functionPart('one', null)]), end()]),
      scope(),
      () => {
        delivered++;
      },
    ),
    safe,
  );
  assert.equal(delivered, 0);
});
test('Gemini bounds total call count across individually valid events', async () => {
  await assert.rejects(
    consume([
      ...Array.from({ length: 129 }, (_, i) => chunk([functionPart(`call_${i}`, {})])),
      end(),
    ]),
    safe,
  );
});
test('Gemini bounded sequence rejects retained arguments above one MiB', async () => {
  await assert.rejects(
    consume([
      ...Array.from({ length: 3 }, (_, i) =>
        chunk([functionPart(`call_${i}`, { q: 'x'.repeat(400000) })]),
      ),
      end(),
    ]),
    safe,
  );
});
test('Gemini native DONE and trailing unframed function data are not clean EOF', async () => {
  for (const suffix of ['data: [DONE]\n\n', 'data: {"functionCall":{"name":"lookup"}}'])
    await assert.rejects(
      consumeDirectGoogleFunctionResponse(
        new Response(frame([chunk([functionPart()]), end()]) + suffix, {
          headers: { 'content-type': 'text/event-stream' },
        }),
        scope(),
        () => {},
      ),
      safe,
    );
});
test('Gemini accepts exactly 128 complete calls without sparse client indices', async () => {
  const result = await consume([
    chunk(Array.from({ length: 128 }, (_, i) => functionPart(`call_${i}`, {}))),
    end(),
  ]);
  assert.equal(result.toolCalls?.length, 128);
  assert.equal(result.finishReason, 'tool_calls');
});
