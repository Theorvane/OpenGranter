import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import { normalizeNonstreamChatUsage } from '../src/providers/nonstream-chat-usage.ts';
import { createOpenRouterChatInvoker } from '../src/providers/openrouter-chat.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

type Kind = 'openai' | 'openrouter' | 'anthropic' | 'google';
const input = { model: 'chat', messages: [{ role: 'user' as const, content: 'private prompt' }] };
function fixture(
  kind: Kind,
  stats: unknown,
  gate = '',
  opaque?: { response: unknown },
  fingerprint?: string,
) {
  const usage: UsageRecord[] = [],
    audit: unknown[] = [];
  let calls = 0,
    secrets = 0;
  const candidate = {
    id: 'candidate',
    kind: 'managed' as const,
    providerId: 'provider',
    upstreamModelId: 'model',
  };
  const resolveSecret = async () => {
    secrets++;
    return 'private-provider-key';
  };
  const fetcher: typeof fetch = async () => {
    calls++;
    const base = {
      id: 'completion',
      created: 1,
      model: 'model',
      ...(fingerprint === undefined ? {} : { system_fingerprint: fingerprint }),
    };
    return Response.json(
      kind === 'anthropic'
        ? {
            ...base,
            content: [{ type: 'text', text: 'private answer' }],
            stop_reason: 'end_turn',
            usage: stats,
          }
        : kind === 'google'
          ? {
              candidates: [
                { content: { parts: [{ text: 'private answer' }] }, finishReason: 'STOP' },
              ],
              usageMetadata: stats,
            }
          : {
              ...base,
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'private answer' },
                  finish_reason: 'stop',
                },
              ],
              usage: stats,
            },
    );
  };
  const direct = createDirectChatInvoker({
    registrations:
      kind === 'openrouter'
        ? []
        : [{ providerId: 'provider', kind, credentialRef: 'ref', maxOutputTokens: 128 }],
    resolveSecret,
    fetcher,
  });
  const delegated = createOpenRouterChatInvoker({ credentialRef: 'ref', resolveSecret, fetcher });
  const handler = createChatHandler({
    newRequestId: () => 'request',
    authenticate: async () =>
      gate === 'auth'
        ? undefined
        : {
            id: 'user',
            active: true,
            credentialId: 'credential',
            policyVersions: [],
            statements:
              gate === 'deny'
                ? []
                : [
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
    resolveRoute: async () =>
      kind === 'openrouter'
        ? {
            kind: 'delegated',
            version: 'v1',
            credentialRef: 'ref',
            candidates: [{ ...candidate, kind: 'delegated' }],
          }
        : { version: 'v1', candidates: [candidate] },
    resolveVerifiedProviderSlug: async () => 'provider',
    checkLimit: async () => gate !== 'limit',
    resolveSecret,
    invokeDirect: async (_, request) => (opaque ? opaque.response : direct(candidate, request)),
    invokeOpenRouter: async (_, attempt, request) =>
      opaque ? opaque.response : delegated(attempt, request),
    writeUsage: async (record) => {
      if (gate === 'ledger') throw Error('private ledger');
      usage.push(record);
    },
    writeAudit: async (event) => {
      if (
        gate === 'selection' &&
        (event.kind === 'selection-started' || event.kind === 'delegated-selection')
      )
        throw Error('private selection audit');
      if (gate === 'audit' && (event.kind === 'attempt' || event.kind === 'delegated-attempt'))
        throw Error('private audit');
      audit.push(event);
    },
  });
  return { handler, usage, audit, calls: () => calls, secrets: () => secrets };
}
function request(base: string) {
  return new Request(`http://localhost${base}/chat/completions`, {
    method: 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}
async function sdk(f: ReturnType<typeof fixture>, base = '/api/v1') {
  const server = createNodeRequestServer(f.handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const client = new OpenRouter({
      apiKey: 'fixture',
      serverURL: `http://127.0.0.1:${address.port}${base}`,
      retryConfig: { strategy: 'none' },
      timeoutMs: 3000,
    });
    return await client.chat.send({ chatRequest: input });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}

test('official SDK accepts compatible partial usage without invented counters', async () => {
  const f = fixture('openrouter', { prompt_tokens: 2 });
  const result = await sdk(f);
  assert.ok('choices' in result);
  assert.equal(result.choices[0]?.message.content, 'private answer');
  assert.equal(result.usage, undefined);
  assert.deepEqual(f.usage[0]?.usage, {
    status: 'partial',
    promptTokens: 2,
    completionTokens: null,
    totalTokens: null,
  });
});

const sparse = [
  { value: undefined, status: 'missing' },
  { value: null, status: 'missing' },
  { value: {}, status: 'missing' },
  { value: { prompt_tokens: 2 }, status: 'partial' },
  { value: { completion_tokens: 1 }, status: 'partial' },
  { value: { total_tokens: 3 }, status: 'partial' },
  { value: { prompt_tokens: null, completion_tokens: 1 }, status: 'invalid' },
  { value: { prompt_tokens: 'private invalid', completion_tokens: 1 }, status: 'invalid' },
  { value: { prompt_tokens: 2, completion_tokens: 1, total_tokens: -1 }, status: 'invalid' },
  { value: { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 1 }, status: 'invalid' },
  { value: 'private container', status: 'invalid' },
] as const;
for (const kind of ['openai', 'openrouter'] as const) {
  test(`${kind}: sparse compatible SDK usage preserves ledger classification and legacy reporting`, async () => {
    for (const scenario of sparse) {
      const f = fixture(kind, scenario.value);
      const result = await sdk(f);
      assert.ok('choices' in result);
      assert.equal(result.usage, undefined);
      assert.equal(result.systemFingerprint, null);
      assert.equal(f.usage[0]?.usage.status, scenario.status);
      assert.equal(f.usage[0]?.outcome, 'succeeded');
      const legacy = await f.handler(request('/v1'));
      assert.equal(legacy.status, 200);
      const body = (await legacy.json()) as { usage?: unknown };
      const shouldHaveUsage = scenario.status !== 'missing';
      assert.equal(Object.hasOwn(body, 'usage'), shouldHaveUsage);
      assert.deepEqual(f.usage[1]?.usage, f.usage[0]?.usage);
      assert.equal(f.calls(), 2);
      assert.doesNotMatch(JSON.stringify([f.usage, f.audit]), /private/u);
    }
  });
  test(`${kind}: complete and zero compatible usage survives SDK serialization`, async () => {
    for (const stats of [
      { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      { prompt_tokens: 2, completion_tokens: 1 },
      { prompt_tokens: 2, completion_tokens: 1, total_tokens: 7 },
    ]) {
      const f = fixture(kind, stats),
        result = await sdk(f);
      assert.ok('choices' in result);
      assert.equal(result.usage?.promptTokens, stats.prompt_tokens);
      assert.equal(result.usage?.completionTokens, stats.completion_tokens);
      assert.equal(result.usage?.totalTokens, stats.total_tokens ?? 3);
      assert.equal(f.usage[0]?.usage.status, 'reported');
    }
  });
  test(`${kind}: usage projection cannot bypass denial or required accounting failures`, async () => {
    for (const [gate, status, calls] of [
      ['auth', 401, 0],
      ['deny', 403, 0],
      ['model', 403, 0],
      ['provider', 403, 0],
      ['limit', 429, 0],
      ['ledger', 503, 1],
      ['audit', 503, 1],
    ] as const) {
      const f = fixture(kind, { prompt_tokens: 2 }, gate),
        response = await f.handler(request('/api/v1'));
      assert.equal(response.status, status, gate);
      assert.equal(f.calls(), calls, gate);
      if (!calls) {
        assert.equal(f.secrets(), 0);
        assert.equal(f.usage.length, 0);
      }
      if (gate === 'audit') assert.equal(f.usage[0]?.usage.status, 'partial');
      assert.doesNotMatch(await response.text(), /private/u);
      assert.doesNotMatch(JSON.stringify([f.usage, f.audit]), /private/u);
    }
  });
}
for (const kind of ['anthropic', 'google'] as const)
  test(`${kind}: sparse native usage stays recorded while compatible SDK omits it`, async () => {
    const f = fixture(kind, kind === 'anthropic' ? { input_tokens: 2 } : { promptTokenCount: 2 });
    const result = await sdk(f);
    assert.ok('choices' in result);
    assert.equal(result.usage, undefined);
    assert.deepEqual(f.usage[0]?.usage, {
      status: 'partial',
      promptTokens: 2,
      completionTokens: null,
      totalTokens: null,
    });
    const legacy = await f.handler(request('/v1'));
    assert.equal(legacy.status, 200);
    assert.deepEqual(((await legacy.json()) as { usage: unknown }).usage, { prompt_tokens: 2 });
  });

test('compatible usage projection clones frozen completions and preserves opaque values', async () => {
  for (const fingerprint of [undefined, null, 'fp_exact']) {
    const stats = Object.freeze({ prompt_tokens: 2 });
    const original = Object.freeze({
      object: 'chat.completion',
      usage: stats,
      ...(fingerprint === undefined ? {} : { system_fingerprint: fingerprint }),
    });
    const f = fixture('openai', undefined, '', { response: original });
    const response = await f.handler(request('/api/v1'));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      object: 'chat.completion',
      system_fingerprint: fingerprint ?? null,
    });
    assert.deepEqual(original.usage, { prompt_tokens: 2 });
    const legacy = await f.handler(request('/v1'));
    assert.deepEqual(await legacy.json(), original);
  }
  for (const original of [
    Object.freeze({ usage: { prompt_tokens: 2 } }),
    Object.freeze({ object: 'other', usage: null }),
  ]) {
    const f = fixture('openai', undefined, '', { response: original });
    assert.deepEqual(await (await f.handler(request('/api/v1'))).json(), original);
  }
});

const tokenDetails = {
  prompt_tokens_details: {
    cached_tokens: 200,
    cache_write_tokens: 0,
    audio_tokens: 5,
    video_tokens: 7,
  },
  completion_tokens_details: {
    reasoning_tokens: 100,
    audio_tokens: null,
    accepted_prediction_tokens: 0,
    rejected_prediction_tokens: 4,
  },
};
const aggregates = { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 };
for (const kind of ['openai', 'openrouter'] as const) {
  test(`${kind}: public nonstream usage preserves token categories without double accounting`, async () => {
    for (const base of ['/v1', '/api/v1']) {
      const f = fixture(kind, {
        ...aggregates,
        ...tokenDetails,
        cost: 0.1,
        cost_details: { private: 'cost marker' },
        prompt_tokens_details: { ...tokenDetails.prompt_tokens_details, private: 'prompt marker' },
        completion_tokens_details: {
          ...tokenDetails.completion_tokens_details,
          private: 'response marker',
        },
      });
      const response = await f.handler(request(base));
      assert.equal(response.status, 200);
      assert.deepEqual(((await response.json()) as { usage: unknown }).usage, {
        ...aggregates,
        ...tokenDetails,
      });
      assert.equal(f.usage.length, 1);
      assert.deepEqual(f.usage[0]?.usage, {
        status: 'reported',
        promptTokens: 2,
        completionTokens: 1,
        totalTokens: 3,
      });
      assert.doesNotMatch(
        JSON.stringify([f.usage, f.audit]),
        /private|cached_tokens|reasoning_tokens/u,
      );
    }
  });

  test(`${kind}: category container omission/null/empty and completion nulls remain exact`, async () => {
    for (const base of ['/v1', '/api/v1']) {
      for (const details of [
        {},
        { prompt_tokens_details: null, completion_tokens_details: null },
        { prompt_tokens_details: {}, completion_tokens_details: {} },
        { completion_tokens_details: { reasoning_tokens: null } },
      ]) {
        const f = fixture(kind, { ...aggregates, ...details });
        const response = await f.handler(request(base));
        assert.equal(response.status, 200);
        assert.deepEqual(((await response.json()) as { usage: unknown }).usage, {
          ...aggregates,
          ...details,
        });
      }
    }
  });

  test(`${kind}: malformed groups are omitted independently without losing aggregate reporting`, async () => {
    for (const base of ['/v1', '/api/v1']) {
      for (const field of ['prompt_tokens_details', 'completion_tokens_details']) {
        const validOther =
          field === 'prompt_tokens_details'
            ? { completion_tokens_details: tokenDetails.completion_tokens_details }
            : { prompt_tokens_details: tokenDetails.prompt_tokens_details };
        const counter = field === 'prompt_tokens_details' ? 'cached_tokens' : 'reasoning_tokens';
        for (const value of [
          'private container',
          [],
          false,
          42,
          ...[-1, 0.1, Number.MAX_SAFE_INTEGER + 1, 'private count', [], {}].map((count) => ({
            [counter]: count,
          })),
          ...(field === 'prompt_tokens_details' ? [{ cached_tokens: null }] : []),
        ]) {
          const f = fixture(kind, { ...aggregates, ...validOther, [field]: value });
          const response = await f.handler(request(base));
          assert.equal(response.status, 200);
          assert.deepEqual(((await response.json()) as { usage: unknown }).usage, {
            ...aggregates,
            ...validOther,
          });
          assert.equal(f.usage[0]?.usage.status, 'reported');
          assert.equal(f.usage[0]?.usage.totalTokens, 3);
          assert.doesNotMatch(JSON.stringify([f.usage, f.audit]), /private/u);
        }
      }
    }
  });

  test(`${kind}: details never fabricate missing aggregates or alter compatible sparse omission`, async () => {
    for (const base of ['/v1', '/api/v1']) {
      for (const partial of [
        {},
        { prompt_tokens: 2 },
        { prompt_tokens: null, completion_tokens: 1 },
      ]) {
        const f = fixture(kind, { ...partial, ...tokenDetails });
        const response = await f.handler(request(base));
        assert.equal(response.status, 200);
        const result = (await response.json()) as { usage?: unknown };
        assert.equal(f.usage[0]?.usage.totalTokens, null);
        assert.notEqual(f.usage[0]?.usage.status, 'reported');
        if (base === '/api/v1' || Object.keys(partial).length === 0) {
          assert.equal(result.usage, undefined);
        } else {
          assert.deepEqual(result.usage, { ...partial, ...tokenDetails });
        }
      }
    }
    const f = fixture(kind, { prompt_tokens: 2, completion_tokens: 1, ...tokenDetails });
    const result = (await (await f.handler(request('/api/v1'))).json()) as { usage: unknown };
    assert.deepEqual(result.usage, { ...aggregates, ...tokenDetails });
    assert.equal(f.usage[0]?.usage.totalTokens, 3);
  });

  test(`${kind}: token details keep pre-dispatch denial and required persistence gates`, async () => {
    for (const base of ['/v1', '/api/v1']) {
      for (const [gate, status, calls] of [
        ['auth', 401, 0],
        ['deny', 403, 0],
        ['model', 403, 0],
        ['provider', 403, 0],
        ['limit', 429, 0],
        ['selection', 503, 0],
        ['ledger', 503, 1],
        ['audit', 503, 1],
      ] as const) {
        const f = fixture(kind, { ...aggregates, ...tokenDetails }, gate);
        const response = await f.handler(request(base));
        assert.equal(response.status, status);
        assert.equal(f.calls(), calls);
        assert.equal(f.secrets(), calls);
        assert.equal(f.usage.length, gate === 'audit' ? 1 : 0);
        assert.doesNotMatch(await response.text(), /private|cached_tokens|reasoning_tokens/u);
        assert.doesNotMatch(
          JSON.stringify([f.usage, f.audit]),
          /private|cached_tokens|reasoning_tokens/u,
        );
      }
    }
  });

  test(`${kind}: actual pinned OpenRouter SDK preserves nonstream detail groups on both bases`, async () => {
    for (const base of ['/v1', '/api/v1']) {
      const f = fixture(kind, { ...aggregates, ...tokenDetails }, '', undefined, 'fp_fixture');
      const result = await sdk(f, base);
      assert.ok('choices' in result);
      assert.deepEqual(result.usage?.promptTokensDetails, {
        cachedTokens: 200,
        cacheWriteTokens: 0,
        audioTokens: 5,
        videoTokens: 7,
      });
      assert.deepEqual(result.usage?.completionTokensDetails, {
        reasoningTokens: 100,
        audioTokens: null,
        acceptedPredictionTokens: 0,
        rejectedPredictionTokens: 4,
      });
      assert.equal(result.usage?.totalTokens, 3);
      assert.equal(f.usage[0]?.usage.totalTokens, 3);
    }
  });

  test(`${kind}: actual pinned OpenAI SDK reads supplied detail fields without re-accounting`, async () => {
    for (const base of ['/v1', '/api/v1']) {
      const f = fixture(kind, { ...aggregates, ...tokenDetails });
      const server = createNodeRequestServer(f.handler);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const address = server.address();
        assert.ok(address && typeof address === 'object');
        const client = new OpenAI({
          apiKey: 'fixture',
          baseURL: `http://127.0.0.1:${address.port}${base}`,
          maxRetries: 0,
          timeout: 3000,
        });
        const result = await client.chat.completions.create(input);
        assert.deepEqual(result.usage, { ...aggregates, ...tokenDetails });
        assert.equal(f.usage.length, 1);
        assert.equal(f.usage[0]?.usage.totalTokens, 3);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((e) => (e ? reject(e) : resolve())),
        );
      }
    }
  });
}

test('nonstream category snapshots capture recognized getters once and ignore unknown payloads', () => {
  let promptReads = 0,
    completionReads = 0,
    groupReads = 0;
  const prompt = Object.defineProperties(
    {},
    {
      cached_tokens: { get: () => (++promptReads === 1 ? 2 : 'private changed'), enumerable: true },
      private: { get: () => assert.fail('Unknown metadata must not be read'), enumerable: true },
    },
  );
  const completion = Object.defineProperties(
    {},
    {
      reasoning_tokens: {
        get: () => (++completionReads === 1 ? 1 : { private: 'unchecked' }),
        enumerable: true,
      },
    },
  );
  const usage = normalizeNonstreamChatUsage({
    ...aggregates,
    get prompt_tokens_details() {
      groupReads++;
      return prompt;
    },
    completion_tokens_details: completion,
  });
  assert.deepEqual(usage, {
    ...aggregates,
    prompt_tokens_details: { cached_tokens: 2 },
    completion_tokens_details: { reasoning_tokens: 1 },
  });
  assert.equal(promptReads, 1);
  assert.equal(completionReads, 1);
  assert.equal(groupReads, 1);
  assert.ok(Object.isFrozen(usage));
  assert.ok(Object.isFrozen(usage?.prompt_tokens_details));
  assert.ok(Object.isFrozen(usage?.completion_tokens_details));
});

test('nonstream category snapshots stay immutable and omit unsafe non-JSON numbers independently', () => {
  const details = { cached_tokens: 2 };
  const result = normalizeNonstreamChatUsage({ ...aggregates, prompt_tokens_details: details });
  details.cached_tokens = 99;
  assert.equal(result?.prompt_tokens_details?.cached_tokens, 2);
  assert.equal(Reflect.set(result?.prompt_tokens_details ?? {}, 'cached_tokens', 7), false);
  for (const count of [NaN, Infinity, -Infinity, undefined]) {
    const usage = normalizeNonstreamChatUsage({
      ...aggregates,
      prompt_tokens_details: { cached_tokens: count },
      completion_tokens_details: { reasoning_tokens: null },
    });
    assert.deepEqual(usage, {
      ...aggregates,
      completion_tokens_details: { reasoning_tokens: null },
    });
  }
});

for (const kind of ['anthropic', 'google'] as const)
  test(`${kind}: OpenAI-shaped categories do not enable unimplemented native mappings`, async () => {
    const stats =
      kind === 'anthropic'
        ? { input_tokens: 2, output_tokens: 1, ...tokenDetails }
        : { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3, ...tokenDetails };
    const f = fixture(kind, stats);
    const response = await f.handler(request('/api/v1'));
    assert.equal(response.status, 200);
    assert.deepEqual(((await response.json()) as { usage: unknown }).usage, aggregates);
    assert.equal(f.usage[0]?.usage.totalTokens, 3);
  });
