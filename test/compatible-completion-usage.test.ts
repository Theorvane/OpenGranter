import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import { createOpenRouterChatInvoker } from '../src/providers/openrouter-chat.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

type Kind = 'openai' | 'openrouter' | 'anthropic' | 'google';
const input = { model: 'chat', messages: [{ role: 'user' as const, content: 'private prompt' }] };
function fixture(kind: Kind, stats: unknown, gate = '', opaque?: { response: unknown }) {
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
    const base = { id: 'completion', created: 1, model: 'model' };
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
async function sdk(f: ReturnType<typeof fixture>) {
  const server = createNodeRequestServer(f.handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const client = new OpenRouter({
      apiKey: 'fixture',
      serverURL: `http://127.0.0.1:${address.port}/api/v1`,
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
