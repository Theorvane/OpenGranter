import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { type ChatHandlerPorts, createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import { createOpenRouterTextStreamInvoker } from '../src/providers/openrouter-stream.ts';
import { encodeOpenRouterTextSse } from '../src/streaming/openrouter-client-sse.ts';
import { decodeOpenRouterStreamPayload } from '../src/streaming/openrouter-stream-chunks.ts';
import { OpenRouterTextStreamSequence } from '../src/streaming/openrouter-stream-sequence.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

const details = {
  prompt_tokens_details: {
    cached_tokens: 200,
    cache_write_tokens: 0,
    audio_tokens: 1,
    video_tokens: 2,
  },
  completion_tokens_details: {
    reasoning_tokens: 100,
    audio_tokens: null,
    accepted_prediction_tokens: 0,
    rejected_prediction_tokens: 3,
  },
};
const counts = { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 };
const scope = { upstreamModelId: 'openai/example', clientModelAlias: 'chat' };
const chat = {
  model: 'chat',
  messages: [{ role: 'user' as const, content: 'private prompt' }],
  stream: true as const,
};
function chunk(choices: unknown[], usage?: unknown): string {
  return JSON.stringify({
    id: 'gen-1',
    object: 'chat.completion.chunk',
    created: 42,
    model: scope.upstreamModelId,
    system_fingerprint: 'fp_fixture',
    choices,
    ...(usage === undefined ? {} : { usage }),
  });
}
const terminal = () => chunk([{ index: 0, delta: {}, finish_reason: 'stop' }]);
const final = (usage: unknown, empty = false) =>
  chunk(empty ? [] : [{ index: 0, delta: {}, finish_reason: 'stop' }], usage);
function fixture(usage: unknown = { ...counts, ...details }, empty = false, gate = '') {
  const records: UsageRecord[] = [],
    audit: unknown[] = [];
  let calls = 0,
    secrets = 0;
  const invoker = createOpenRouterTextStreamInvoker({
    credentialRef: 'secret/openrouter',
    resolveSecret: async () => {
      secrets++;
      return 'fixture-upstream-key';
    },
    fetcher: async () => {
      calls++;
      return new Response(
        [
          chunk([
            {
              index: 0,
              delta: { role: 'assistant', content: 'private answer' },
              finish_reason: null,
            },
          ]),
          terminal(),
          final(usage, empty),
          '[DONE]',
        ]
          .map((value) => `data: ${value}\n\n`)
          .join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  const ports: ChatHandlerPorts<unknown> = {
    newRequestId: () => 'req-stream-details',
    authenticate: async () =>
      gate === 'auth'
        ? undefined
        : {
            id: 'user',
            active: true,
            credentialId: 'credential',
            policyVersions: [],
            statements: [
              { effect: 'Allow', actions: ['*'], resources: ['*'] },
              ...(gate === 'model' || gate === 'provider'
                ? [
                    {
                      effect: 'Deny' as const,
                      actions: [gate === 'model' ? 'llm:InvokeModel' : 'llm:UseProvider'],
                      resources: ['*'],
                    },
                  ]
                : []),
            ],
          },
    resolveRoute: async () => ({
      kind: 'delegated',
      version: 'v1',
      credentialRef: 'secret/openrouter',
      candidates: [
        {
          id: 'candidate',
          kind: 'delegated',
          providerId: 'openai',
          upstreamModelId: scope.upstreamModelId,
        },
      ],
    }),
    resolveVerifiedProviderSlug: async () => 'OpenAI',
    checkLimit: async () => gate !== 'limit',
    resolveSecret: async () => assert.fail('Unexpected routing secret'),
    invokeDirect: async () => assert.fail('Unexpected direct call'),
    invokeOpenRouterTextStream: (_ref, ...args) => invoker(...args),
    writeAudit: async (event) => {
      if (
        (gate === 'selection' && event.kind === 'delegated-selection') ||
        (gate === 'audit' && event.kind === 'delegated-attempt')
      )
        throw Error('private audit cause');
      audit.push(event);
    },
    writeUsage: async (record) => {
      if (gate === 'ledger') throw Error('private ledger cause');
      records.push(record);
    },
  };
  const request = (base: string, signal?: AbortSignal) =>
    new Request(`http://gateway${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer fixture-proxy-key', 'content-type': 'application/json' },
      body: JSON.stringify({ ...chat, stream_options: { include_usage: false } }),
      ...(signal ? { signal } : {}),
    });
  return { ports, records, audit, request, calls: () => calls, secrets: () => secrets };
}
function frames(text: string): Record<string, unknown>[] {
  assert.ok(text.endsWith('data: [DONE]\n\n'));
  return text
    .trim()
    .split('\n\n')
    .filter((value) => value !== 'data: [DONE]')
    .map((value) => JSON.parse(value.slice(6)) as Record<string, unknown>);
}
function safe(f: ReturnType<typeof fixture>) {
  assert.doesNotMatch(
    JSON.stringify([f.records, f.audit]),
    /private|fixture-.*key|cached_tokens|reasoning_tokens/u,
  );
}

test('public final stream usage preserves bounded categories for both prefixes and upstream choice shapes', async () => {
  for (const base of ['/v1', '/api/v1'])
    for (const empty of [false, true]) {
      const f = fixture(
        {
          ...counts,
          ...details,
          cost: 0.1,
          prompt_tokens_details: { ...details.prompt_tokens_details, private: 'unknown payload' },
        },
        empty,
      );
      const response = await createChatHandler(f.ports)(f.request(base));
      assert.equal(response.status, 200);
      const result = frames(await response.text());
      assert.equal(result.length, 3);
      assert.deepEqual(result[2]?.usage, { ...counts, ...details });
      assert.deepEqual(result[2]?.choices, [
        { index: 0, delta: { role: 'assistant', content: '' }, finish_reason: 'stop' },
      ]);
      assert.equal(f.records.length, 1);
      assert.deepEqual(f.records[0]?.usage, {
        status: 'reported',
        promptTokens: 2,
        completionTokens: 1,
        totalTokens: 3,
      });
      safe(f);
    }
});

test('stream detail omission/null/empty and invalid groups preserve aggregate reporting independently', async () => {
  for (const base of ['/v1', '/api/v1'])
    for (const [extra, expected] of [
      [{}, {}],
      [
        { prompt_tokens_details: null, completion_tokens_details: null },
        { prompt_tokens_details: null, completion_tokens_details: null },
      ],
      [
        { prompt_tokens_details: {}, completion_tokens_details: {} },
        { prompt_tokens_details: {}, completion_tokens_details: {} },
      ],
      [
        {
          prompt_tokens_details: { cached_tokens: null },
          completion_tokens_details: { reasoning_tokens: null },
        },
        { completion_tokens_details: { reasoning_tokens: null } },
      ],
      [
        {
          prompt_tokens_details: { cached_tokens: 2 },
          completion_tokens_details: { reasoning_tokens: -1 },
        },
        { prompt_tokens_details: { cached_tokens: 2 } },
      ],
      [{ prompt_tokens_details: 'private bad', completion_tokens_details: [] }, {}],
    ] as const) {
      const f = fixture({ ...counts, ...extra });
      const response = await createChatHandler(f.ports)(f.request(base));
      assert.deepEqual(frames(await response.text()).at(-1)?.usage, { ...counts, ...expected });
      assert.equal(f.records[0]?.usage.totalTokens, 3);
      safe(f);
    }
});

test('stream categories never fabricate aggregate usage or change unknown accounting status', async () => {
  for (const base of ['/v1', '/api/v1'])
    for (const [usage, status] of [
      [{ ...details }, 'missing'],
      [{ prompt_tokens: 2, ...details }, 'partial'],
      [{ prompt_tokens: 2, completion_tokens: null, ...details }, 'invalid'],
    ] as const) {
      const f = fixture(usage);
      const response = await createChatHandler(f.ports)(f.request(base));
      assert.equal(frames(await response.text()).length, 2);
      assert.equal(f.records[0]?.usage.status, status);
      assert.equal(f.records[0]?.usage.totalTokens, null);
      safe(f);
    }
});

test('stream detail delivery keeps pre-dispatch gates and required final persistence failures', async () => {
  for (const base of ['/v1', '/api/v1'])
    for (const [gate, status, calls] of [
      ['auth', 401, 0],
      ['model', 403, 0],
      ['provider', 403, 0],
      ['limit', 429, 0],
      ['selection', 503, 0],
      ['ledger', 200, 1],
      ['audit', 200, 1],
    ] as const) {
      const f = fixture({ ...counts, ...details }, false, gate);
      const response = await createChatHandler(f.ports)(f.request(base));
      const text = await response.text();
      assert.equal(response.status, status, gate);
      assert.equal(f.calls(), calls);
      assert.equal(f.secrets(), calls);
      assert.equal(text.includes('[DONE]'), false);
      assert.equal(text.includes('cached_tokens'), false);
      assert.equal(text.includes('private audit cause'), false);
      assert.equal(text.includes('private ledger cause'), false);
      assert.equal(f.records.length, gate === 'audit' ? 1 : 0);
      safe(f);
    }
});

test('actual pinned OpenRouter and OpenAI SDK sockets receive final categories without duplicate accounting', async () => {
  for (const base of ['/v1', '/api/v1'])
    for (const empty of [false, true]) {
      const f = fixture({ ...counts, ...details }, empty),
        server = createNodeChatServer(f.ports);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const address = server.address();
        assert.ok(address && typeof address === 'object');
        const client = new OpenRouter({
          apiKey: 'fixture-proxy-key',
          serverURL: `http://127.0.0.1:${address.port}${base}`,
          retryConfig: { strategy: 'none' },
          timeoutMs: 3000,
        });
        const stream = await client.chat.send({
          chatRequest: { ...chat, streamOptions: { includeUsage: false } },
        });
        assert.ok(Symbol.asyncIterator in stream);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        assert.equal(chunks.length, 3);
        assert.deepEqual(chunks[2]?.usage?.promptTokensDetails, {
          cachedTokens: 200,
          cacheWriteTokens: 0,
          audioTokens: 1,
          videoTokens: 2,
        });
        assert.deepEqual(chunks[2]?.usage?.completionTokensDetails, {
          reasoningTokens: 100,
          audioTokens: null,
          acceptedPredictionTokens: 0,
          rejectedPredictionTokens: 3,
        });
        const openai = new OpenAI({
          apiKey: 'fixture-proxy-key',
          baseURL: `http://127.0.0.1:${address.port}${base}`,
          maxRetries: 0,
          timeout: 3000,
        });
        const raw = await openai.chat.completions.create(chat);
        const rawChunks = [];
        for await (const chunk of raw) rawChunks.push(chunk);
        assert.deepEqual(rawChunks[2]?.usage, { ...counts, ...details });
        assert.equal(f.records.length, 2);
        assert.ok(f.records.every((record) => record.usage.totalTokens === 3));
        safe(f);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((e) => (e ? reject(e) : resolve())),
        );
      }
    }
});

test('independent decoder/encoder preserve final detail groups and do not invent omitted totals', () => {
  for (const empty of [false, true]) {
    const event = decodeOpenRouterStreamPayload(final({ ...counts, ...details }, empty), scope);
    assert.equal(event.kind, 'usage');
    const frame = encodeOpenRouterTextSse(event);
    assert.deepEqual(JSON.parse(frame?.slice(6) ?? '{}').usage, { ...counts, ...details });
  }
  assert.equal(
    encodeOpenRouterTextSse({
      kind: 'usage',
      id: 'gen-1',
      model: 'chat',
      created: 42,
      finishReason: 'stop',
      usage: { prompt_tokens: 2, completion_tokens: 1, ...details },
    }),
    undefined,
  );
});

test('independent sequence snapshots nested usage without retaining later mutations or unknown payloads', () => {
  const sequence = new OpenRouterTextStreamSequence();
  sequence.accept(decodeOpenRouterStreamPayload(terminal(), scope));
  const prompt = { cached_tokens: 2 },
    completion = { reasoning_tokens: 1 };
  const supplied = {
    ...counts,
    prompt_tokens_details: prompt,
    completion_tokens_details: completion,
    private: 'unknown payload',
  };
  sequence.accept({
    kind: 'usage',
    id: 'gen-1',
    model: 'chat',
    created: 42,
    finishReason: 'stop',
    usage: supplied,
  });
  prompt.cached_tokens = 99;
  completion.reasoning_tokens = 99;
  sequence.accept({ kind: 'done' });
  const result = sequence.finish();
  assert.equal(result.status, 'complete');
  if (result.status !== 'complete') assert.fail('Expected complete');
  assert.deepEqual(result.usage, {
    ...counts,
    prompt_tokens_details: { cached_tokens: 2 },
    completion_tokens_details: { reasoning_tokens: 1 },
  });
  assert.ok(Object.isFrozen(result.usage?.prompt_tokens_details));
  assert.ok(Object.isFrozen(result.usage?.completion_tokens_details));
  assert.equal(JSON.stringify(sequence).includes('private'), false);
});

test('independent encoder uses one validated capture for category and aggregate getters', () => {
  let aggregateReads = 0,
    categoryReads = 0;
  const usage = {
    completion_tokens: 1,
    total_tokens: 3,
    get prompt_tokens() {
      aggregateReads++;
      return aggregateReads === 1 ? 2 : { private: 'unchecked aggregate' };
    },
    prompt_tokens_details: {
      get cached_tokens() {
        categoryReads++;
        return categoryReads === 1 ? 2 : 'private unchecked';
      },
    },
  };
  const frame = encodeOpenRouterTextSse({
    kind: 'usage',
    id: 'gen-1',
    model: 'chat',
    created: 42,
    finishReason: 'stop',
    usage: usage as unknown as {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    },
  });
  assert.deepEqual(JSON.parse(frame?.slice(6) ?? '{}').usage, {
    ...counts,
    prompt_tokens_details: { cached_tokens: 2 },
  });
  assert.equal(aggregateReads, 1);
  assert.equal(categoryReads, 1);
});

test('trusted outcome usage is snapshotted before asynchronous persistence can mutate it', async () => {
  for (const base of ['/v1', '/api/v1']) {
    const f = fixture(),
      supplied = { ...counts, prompt_tokens_details: { cached_tokens: 2 } };
    f.ports = {
      ...f.ports,
      invokeOpenRouterTextStream: async (_ref, _attempt, _request, onDelta) => {
        const end = decodeOpenRouterStreamPayload(terminal(), scope);
        assert.equal(end.kind, 'delta');
        if (end.kind !== 'delta') assert.fail('Expected delta');
        await onDelta(end);
        return {
          status: 'complete',
          id: 'gen-1',
          model: 'chat',
          finishReason: 'stop',
          usage: supplied,
        };
      },
      writeUsage: async (record) => {
        supplied.prompt_tokens = 99;
        supplied.prompt_tokens_details.cached_tokens = 99;
        f.records.push(record);
      },
    };
    const response = await createChatHandler(f.ports)(f.request(base));
    assert.deepEqual(frames(await response.text()).at(-1)?.usage, {
      ...counts,
      prompt_tokens_details: { cached_tokens: 2 },
    });
    assert.equal(f.records[0]?.usage.promptTokens, 2);
  }
});

test('actual final usage alone supplies categories and incomplete normalized events stay incomplete', () => {
  for (const usage of [counts, { prompt_tokens: 2, completion_tokens: 1 }]) {
    const sequence = new OpenRouterTextStreamSequence();
    const end = decodeOpenRouterStreamPayload(terminal(), scope);
    const previous = { ...end, usage: { ...counts, ...details } };
    sequence.accept(previous);
    sequence.accept({
      kind: 'usage',
      id: 'gen-1',
      model: 'chat',
      created: 42,
      finishReason: 'stop',
      usage,
    });
    sequence.accept({ kind: 'done' });
    const outcome = sequence.finish();
    assert.equal(outcome.status, 'complete');
    if (outcome.status !== 'complete') assert.fail('Expected complete');
    assert.deepEqual(outcome.usage, usage);
    const encoded = encodeOpenRouterTextSse({
      kind: 'usage',
      id: 'gen-1',
      model: 'chat',
      created: 42,
      finishReason: 'stop',
      usage: outcome.usage,
    });
    if ('total_tokens' in usage)
      assert.deepEqual(JSON.parse(encoded?.slice(6) ?? '{}').usage, counts);
    else assert.equal(encoded, undefined);
  }
});

test('trusted outcome captures the usage accessor once before accounting and framing', async () => {
  const f = fixture();
  let reads = 0;
  f.ports = {
    ...f.ports,
    invokeOpenRouterTextStream: async (_ref, _attempt, _request, onDelta) => {
      const end = decodeOpenRouterStreamPayload(terminal(), scope);
      assert.equal(end.kind, 'delta');
      if (end.kind !== 'delta') assert.fail('Expected delta');
      await onDelta(end);
      return {
        status: 'complete',
        id: 'gen-1',
        model: 'chat',
        finishReason: 'stop',
        get usage() {
          reads++;
          return reads === 1
            ? { ...counts, ...details }
            : { prompt_tokens: 99, completion_tokens: 99, total_tokens: 198 };
        },
      };
    },
  };
  const response = await createChatHandler(f.ports)(f.request('/api/v1'));
  assert.deepEqual(frames(await response.text()).at(-1)?.usage, { ...counts, ...details });
  assert.equal(f.records[0]?.usage.totalTokens, 3);
  assert.equal(reads, 1);
});

test('independent encoder omits malformed groups while excluding injected unknown usage payloads', () => {
  const supplied = {
    ...counts,
    cost: 0.1,
    private: 'unchecked container',
    prompt_tokens_details: { cached_tokens: -1, private: 'unchecked group' },
    completion_tokens_details: { reasoning_tokens: null, private: 'unchecked group' },
  };
  const encoded = encodeOpenRouterTextSse({
    kind: 'usage',
    id: 'gen-1',
    created: 42,
    model: 'chat',
    finishReason: 'stop',
    usage: supplied,
  });
  assert.deepEqual(JSON.parse(encoded?.slice(6) ?? '{}').usage, {
    ...counts,
    completion_tokens_details: { reasoning_tokens: null },
  });
  assert.equal(encoded?.includes('unchecked'), false);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test('cancellation before and after detail accounting retains exactly one attempt and safe interruption audit', {
  timeout: 5000,
}, async () => {
  for (const base of ['/v1', '/api/v1'])
    for (const completed of [false, true]) {
      const f = fixture(),
        accounted = deferred(),
        interrupted = deferred();
      const writeAudit = f.ports.writeAudit;
      f.ports = {
        ...f.ports,
        writeAudit: async (event) => {
          await writeAudit(event);
          if (event.kind === 'delegated-attempt') accounted.resolve();
          if (event.kind === 'stream-interrupted') interrupted.resolve();
        },
      };
      const response = await createChatHandler(f.ports)(f.request(base)),
        reader = response.body?.getReader();
      assert.ok(reader);
      await reader.read();
      if (completed) {
        await reader.read();
        await accounted.promise;
        await new Promise((resolve) => setImmediate(resolve));
      }
      await reader.cancel('private cancellation reason');
      await interrupted.promise;
      assert.equal(f.records.length, 1);
      assert.equal(f.records[0]?.outcome, completed ? 'succeeded' : 'failed');
      assert.equal(f.records[0]?.usage.status, completed ? 'reported' : 'missing');
      assert.equal(f.records[0]?.usage.totalTokens, completed ? 3 : null);
      safe(f);
    }
});

test('independent sequence freezes invalid-container usage without retaining its payload', () => {
  const sequence = new OpenRouterTextStreamSequence();
  sequence.accept(decodeOpenRouterStreamPayload(terminal(), scope));
  sequence.accept({
    kind: 'usage',
    id: 'gen-1',
    model: 'chat',
    created: 42,
    finishReason: 'stop',
    usage: ['private container'] as unknown as { total_tokens: null },
  });
  sequence.accept({ kind: 'done' });
  const result = sequence.finish();
  assert.equal(result.status, 'complete');
  if (result.status !== 'complete') assert.fail('Expected complete');
  assert.deepEqual(result.usage, { total_tokens: null });
  assert.ok(Object.isFrozen(result.usage));
  assert.equal(JSON.stringify(sequence).includes('private'), false);
});
