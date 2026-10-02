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
    chunk({ reasoning_details: [{ type: 'reasoning.text', text: 'private' }] }),
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

test('preserves bounded opaque fingerprints on text and both final usage layouts', () => {
  for (const fingerprint of [undefined, null, '', 'fp_한글\n\ndata: forged']) {
    const extra = fingerprint === undefined ? {} : { system_fingerprint: fingerprint };
    for (const payload of [
      chunk({ content: 'text' }, null, extra),
      chunk({}, 'stop', { ...extra, usage: { prompt_tokens: 1, completion_tokens: 2 } }),
      JSON.stringify({
        ...JSON.parse(chunk({}, 'stop', extra)),
        choices: [],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      }),
    ]) {
      const event = decodeOpenRouterStreamPayload(payload, scope);
      assert.equal('systemFingerprint' in event ? event.systemFingerprint : undefined, fingerprint);
      assert.equal(Object.hasOwn(event, 'systemFingerprint'), fingerprint !== undefined);
    }
  }
});

test('malformed fingerprints cannot be silently dropped', () => {
  for (const fingerprint of [true, 42, [], { secret: 'private' }]) {
    for (const payload of [
      chunk({}, null, { system_fingerprint: fingerprint }),
      chunk({}, 'stop', { system_fingerprint: fingerprint, usage: { total_tokens: 3 } }),
    ]) {
      assert.throws(() => decodeOpenRouterStreamPayload(payload, scope), {
        message: 'Invalid OpenRouter stream chunk',
      });
    }
  }
});

test('client encoder independently validates and safely frames fingerprint metadata', async () => {
  const { encodeOpenRouterTextSse } = await import('../src/streaming/openrouter-client-sse.ts');
  const event = decodeOpenRouterStreamPayload(chunk({ content: 'text' }), scope);
  assert.equal(event.kind, 'delta');
  if (event.kind !== 'delta') assert.fail('expected delta');
  for (const fingerprint of [undefined, null, '', 'fp_한글\n\ndata: forged']) {
    const frame = encodeOpenRouterTextSse({
      ...event,
      ...(fingerprint === undefined ? {} : { systemFingerprint: fingerprint }),
    });
    assert.ok(frame);
    const value = JSON.parse(frame.slice(6));
    assert.equal(value.system_fingerprint, fingerprint);
    assert.equal(Object.hasOwn(value, 'system_fingerprint'), fingerprint !== undefined);
    assert.equal(frame.trim().split('\n\n').length, 1);
  }
  for (const malformed of [true, 42, [], { secret: 'private' }]) {
    assert.throws(
      () => encodeOpenRouterTextSse({ ...event, systemFingerprint: malformed as never }),
      { message: 'Unsupported OpenRouter text stream event' },
    );
  }
});

test('stream refusal deltas preserve exact string/null/omission and safe framing', async () => {
  const { encodeOpenRouterTextSse } = await import('../src/streaming/openrouter-client-sse.ts');
  for (const refusal of [undefined, null, '', 'private 拒否\n\ndata: forged']) {
    const event = decodeOpenRouterStreamPayload(
      chunk({ content: null, ...(refusal === undefined ? {} : { refusal }) }, 'content_filter'),
      scope,
    );
    assert.equal(event.kind, 'delta');
    const frame = encodeOpenRouterTextSse(event);
    assert.ok(frame);
    const value = JSON.parse(frame.slice(6)).choices[0];
    assert.equal(value.delta.refusal, refusal);
    assert.equal(Object.hasOwn(value.delta, 'refusal'), refusal !== undefined);
    assert.equal(value.finish_reason, 'content_filter');
    assert.equal(value.delta.content, null);
    assert.equal(frame.trim().split('\n\n').length, 1);
  }
});

test('usage-only refusal text cannot silently disappear', () => {
  for (const refusal of ['private refusal', true, 42, [], {}]) {
    assert.throws(
      () =>
        decodeOpenRouterStreamPayload(
          chunk({ refusal }, 'content_filter', { usage: { total_tokens: 3 } }),
          scope,
        ),
      { message: 'Invalid OpenRouter stream chunk' },
    );
  }
});

test('refusal validation at decoder and independent encoder rejects malformed values', async () => {
  const { encodeOpenRouterTextSse } = await import('../src/streaming/openrouter-client-sse.ts');
  const text = decodeOpenRouterStreamPayload(chunk({ content: 'ordinary text' }), scope);
  assert.equal(text.kind, 'delta');
  if (text.kind !== 'delta') assert.fail('fixture shape');
  for (const refusal of [true, 42, [], { secret: 'private-refusal' }]) {
    assert.throws(() => decodeOpenRouterStreamPayload(chunk({ refusal }), scope), {
      message: 'Invalid OpenRouter stream chunk',
    });
    assert.throws(() => encodeOpenRouterTextSse({ ...text, refusal: refusal as never }), {
      message: 'Unsupported OpenRouter text stream event',
    });
  }
  const event = decodeOpenRouterStreamPayload(
    chunk({ content: 'ordinary text', refusal: 'refusal fragment' }),
    scope,
  );
  const frame = encodeOpenRouterTextSse(event);
  assert.ok(frame);
  assert.deepEqual(JSON.parse(frame.slice(6)).choices[0].delta, {
    content: 'ordinary text',
    refusal: 'refusal fragment',
  });
  for (const refusal of [null, '']) {
    assert.equal(
      decodeOpenRouterStreamPayload(
        chunk({ refusal }, 'content_filter', { usage: { total_tokens: 3 } }),
        scope,
      ).kind,
      'usage',
    );
  }
});

test('stream reasoning deltas preserve exact string/null/omission and safe framing', async () => {
  const { encodeOpenRouterTextSse } = await import('../src/streaming/openrouter-client-sse.ts');
  for (const reasoning of [undefined, null, '', 'private 思考\n\ndata: forged']) {
    const event = decodeOpenRouterStreamPayload(
      chunk({ content: null, ...(reasoning === undefined ? {} : { reasoning }) }, 'stop'),
      scope,
    );
    assert.equal(event.kind, 'delta');
    const frame = encodeOpenRouterTextSse(event);
    assert.ok(frame);
    const value = JSON.parse(frame.slice(6)).choices[0];
    assert.equal(value.delta.reasoning, reasoning);
    assert.equal(Object.hasOwn(value.delta, 'reasoning'), reasoning !== undefined);
    assert.equal(value.finish_reason, 'stop');
    assert.equal(value.delta.content, null);
    assert.equal(frame.trim().split('\n\n').length, 1);
  }
});

test('usage-only reasoning text cannot silently disappear', () => {
  for (const reasoning of ['private reasoning', true, 42, [], {}]) {
    assert.throws(
      () =>
        decodeOpenRouterStreamPayload(
          chunk({ reasoning }, 'stop', { usage: { total_tokens: 3 } }),
          scope,
        ),
      { message: 'Invalid OpenRouter stream chunk' },
    );
  }
});

test('reasoning validation at decoder and independent encoder rejects malformed values', async () => {
  const { encodeOpenRouterTextSse } = await import('../src/streaming/openrouter-client-sse.ts');
  const text = decodeOpenRouterStreamPayload(chunk({ content: 'ordinary text' }), scope);
  assert.equal(text.kind, 'delta');
  if (text.kind !== 'delta') assert.fail('fixture shape');
  for (const reasoning of [true, 42, [], { secret: 'private-reasoning' }]) {
    assert.throws(() => decodeOpenRouterStreamPayload(chunk({ reasoning }), scope), {
      message: 'Invalid OpenRouter stream chunk',
    });
    assert.throws(() => encodeOpenRouterTextSse({ ...text, reasoning: reasoning as never }), {
      message: 'Unsupported OpenRouter text stream event',
    });
  }
  const event = decodeOpenRouterStreamPayload(
    chunk({ content: 'ordinary text', refusal: null, reasoning: 'reasoning fragment' }),
    scope,
  );
  const frame = encodeOpenRouterTextSse(event);
  assert.ok(frame);
  assert.deepEqual(JSON.parse(frame.slice(6)).choices[0].delta, {
    content: 'ordinary text',
    refusal: null,
    reasoning: 'reasoning fragment',
  });
  for (const reasoning of [null, '']) {
    assert.equal(
      decodeOpenRouterStreamPayload(
        chunk({ reasoning }, 'stop', { usage: { total_tokens: 3 } }),
        scope,
      ).kind,
      'usage',
    );
  }
});

test('independent encoder rejects usage-only reasoning before missing-token early returns', async () => {
  const { encodeOpenRouterTextSse } = await import('../src/streaming/openrouter-client-sse.ts');
  const final = decodeOpenRouterStreamPayload(
    chunk({}, 'stop', { usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }),
    scope,
  );
  assert.equal(final.kind, 'usage');
  for (const missing of [false, true]) {
    for (const reasoning of ['private usage reasoning', 42, {}, true, []]) {
      const event = { ...final, ...(missing ? { usage: undefined } : {}), reasoning };
      assert.throws(() => encodeOpenRouterTextSse(event), {
        message: 'Unsupported OpenRouter text stream event',
      });
    }
    for (const reasoning of [undefined, null, '']) {
      const event = { ...final, ...(missing ? { usage: undefined } : {}), reasoning };
      const frame = encodeOpenRouterTextSse(event);
      if (missing) assert.equal(frame, undefined);
      else
        assert.equal(
          Object.hasOwn(JSON.parse(frame?.slice(6) ?? '{}').choices[0].delta, 'reasoning'),
          false,
        );
    }
  }
  const delta = { ...decodeOpenRouterStreamPayload(chunk({ content: 'text' }), scope) };
  let reads = 0;
  Object.defineProperty(delta, 'reasoning', {
    enumerable: true,
    get: () => (++reads === 1 ? 'private captured reasoning' : { malformed: true }),
  });
  const encoded = encodeOpenRouterTextSse(delta);
  assert.equal(reads, 1);
  assert.equal(
    JSON.parse(encoded?.slice(6) ?? '{}').choices[0].delta.reasoning,
    'private captured reasoning',
  );
});

test('stream service tier survives decoder and encoder without inferred metadata', async () => {
  const { encodeOpenRouterTextSse } = await import('../src/streaming/openrouter-client-sse.ts');
  const event = decodeOpenRouterStreamPayload(
    chunk({ content: 'text' }, null, { service_tier: 'private-tier' }),
    scope,
  );
  const frame = encodeOpenRouterTextSse(event);
  assert.ok(frame);
  assert.equal(JSON.parse(frame.slice(6)).service_tier, 'private-tier');
});

test('stream tiers preserve exact metadata on delta and both usage forms', async () => {
  const { encodeOpenRouterTextSse } = await import('../src/streaming/openrouter-client-sse.ts');
  for (const tier of [undefined, null, '', 'private-tier\n\ndata: forged 한글']) {
    const metadata = tier === undefined ? {} : { service_tier: tier };
    for (const payload of [
      chunk({ content: 'text' }, null, metadata),
      chunk({}, 'stop', { ...metadata, usage: { prompt_tokens: 1, completion_tokens: 2 } }),
      chunk({}, null, {
        ...metadata,
        choices: [],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      }),
    ]) {
      const event = decodeOpenRouterStreamPayload(payload, scope);
      const frame = encodeOpenRouterTextSse(event);
      assert.ok(frame);
      const body = JSON.parse(frame.slice(6));
      assert.equal(body.service_tier, tier);
      assert.equal(Object.hasOwn(body, 'service_tier'), tier !== undefined);
      assert.equal(frame.trim().split('\n\n').length, 1);
    }
  }
});
test('malformed stream tier rejects at decoder and independent client encoder', async () => {
  const { encodeOpenRouterTextSse } = await import('../src/streaming/openrouter-client-sse.ts');
  const event = decodeOpenRouterStreamPayload(chunk({ content: 'text' }), scope);
  assert.equal(event.kind, 'delta');
  if (event.kind !== 'delta') assert.fail('fixture');
  for (const tier of [true, 42, [], { private: 'tier' }]) {
    for (const payload of [
      chunk({}, null, { service_tier: tier }),
      chunk({}, 'stop', { service_tier: tier, usage: { total_tokens: 3 } }),
    ])
      assert.throws(() => decodeOpenRouterStreamPayload(payload, scope), {
        message: 'Invalid OpenRouter stream chunk',
      });
    assert.throws(() => encodeOpenRouterTextSse({ ...event, serviceTier: tier as never }), {
      message: 'Unsupported OpenRouter text stream event',
    });
    assert.throws(
      () =>
        encodeOpenRouterTextSse({
          ...event,
          kind: 'usage',
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          serviceTier: tier as never,
        }),
      { message: 'Unsupported OpenRouter text stream event' },
    );
    assert.throws(
      () =>
        encodeOpenRouterTextSse({
          ...event,
          kind: 'usage',
          usage: undefined,
          serviceTier: tier as never,
        }),
      { message: 'Unsupported OpenRouter text stream event' },
    );
  }
});

test('independent stream encoder captures service tier once', async () => {
  const { encodeOpenRouterTextSse } = await import('../src/streaming/openrouter-client-sse.ts');
  const event = decodeOpenRouterStreamPayload(chunk({ content: 'text' }), scope);
  assert.equal(event.kind, 'delta');
  if (event.kind !== 'delta') assert.fail('fixture');
  let reads = 0;
  const observed = Object.defineProperty({ ...event }, 'serviceTier', {
    get: () => {
      reads++;
      return reads === 1 ? 'private-tier' : { invalid: true };
    },
  });
  const frame = encodeOpenRouterTextSse(observed);
  assert.ok(frame);
  assert.equal(JSON.parse(frame.slice(6)).service_tier, 'private-tier');
  assert.equal(reads, 1);
});
