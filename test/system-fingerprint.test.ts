import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import { createOpenRouterChatInvoker } from '../src/providers/openrouter-chat.ts';

function fixture(
  kind: 'openai' | 'openrouter',
  content: unknown,
  refusal: unknown,
  finish = 'stop',
  gate = '',
  fingerprint?: unknown,
) {
  let calls = 0;
  const audits: unknown[] = [];
  const usage: unknown[] = [];
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json({
      id: 'completion',
      created: 1,
      model: 'model',
      ...(fingerprint === undefined ? {} : { system_fingerprint: fingerprint }),
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content, ...(refusal === undefined ? {} : { refusal }) },
          finish_reason: finish,
        },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    });
  };
  const candidate = {
    id: 'candidate',
    kind: 'managed' as const,
    providerId: 'provider',
    upstreamModelId: 'model',
  };
  const resolveSecret = async () => 'fixture-key';
  const direct = createDirectChatInvoker({
    registrations: [{ providerId: 'provider', kind: 'openai', credentialRef: 'secret/reference' }],
    resolveSecret,
    fetcher,
  });
  const delegated = createOpenRouterChatInvoker({
    credentialRef: 'secret/reference',
    resolveSecret,
    fetcher,
  });
  const handler = createChatHandler({
    newRequestId: () => 'request',
    authenticate: async () => ({
      id: 'user',
      active: true,
      credentialId: 'credential',
      policyVersions: [],
      statements:
        gate === 'deny'
          ? []
          : [
              { effect: 'Allow', actions: ['*'], resources: ['*'] },
              ...(gate === 'explicit'
                ? [{ effect: 'Deny' as const, actions: ['*'], resources: ['*'] }]
                : []),
            ],
    }),
    resolveRoute: async () =>
      kind === 'openai'
        ? { version: 'v1', candidates: [candidate] }
        : {
            kind: 'delegated',
            version: 'v1',
            credentialRef: 'secret/reference',
            candidates: [{ ...candidate, kind: 'delegated' }],
          },
    checkLimit: async () => gate !== 'limit',
    resolveSecret,
    writeAudit: async (event) => {
      if (gate === 'audit') throw new Error('private audit');
      audits.push(event);
    },
    writeUsage: async (record) => {
      usage.push(record);
    },
    invokeDirect: async (_, request) => direct(candidate, request),
    invokeOpenRouter: async (_, __, request) =>
      delegated({ upstreamModelId: 'model', authorizedProviderSlugs: ['provider'] }, request),
    resolveVerifiedProviderSlug: async () => 'provider',
  });
  return { handler, audits, usage, calls: () => calls };
}
const input = { model: 'chat', messages: [{ role: 'user' as const, content: 'private prompt' }] };
function request(path: string) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}
for (const kind of ['openai', 'openrouter'] as const) {
  test(`${kind}: exact optional fingerprints survive both prefixes and blocked outcomes`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
      for (const fingerprint of [undefined, null, '', 'fp-private-backend', '백엔드'])
        for (const [content, refusal, finish] of [
          ['private response', undefined, 'stop'],
          [null, 'private refusal', 'stop'],
          [null, undefined, 'content_filter'],
        ] as const) {
          const f = fixture(kind, content, refusal, finish, '', fingerprint);
          const response = await f.handler(request(path));
          assert.equal(response.status, 200);
          const body = (await response.json()) as Record<string, unknown>;
          const compatible = path.startsWith('/api/v1/');
          assert.equal(
            body.system_fingerprint,
            compatible && fingerprint === undefined ? null : fingerprint,
          );
          assert.equal(
            Object.hasOwn(body, 'system_fingerprint'),
            compatible || fingerprint !== undefined,
          );
          assert.equal(f.usage.length, 1);
          assert.doesNotMatch(
            JSON.stringify([f.audits, f.usage]),
            /fp-private-backend|private response|private refusal|private prompt|fixture-key/u,
          );
        }
  });
  test(`${kind}: installed SDK retains fingerprint on both bases`, async () => {
    const f = fixture(kind, 'response', undefined, 'stop', '', 'fp-private-backend');
    const server = createNodeRequestServer(f.handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      for (const base of ['/v1', '/api/v1']) {
        const sdk = new OpenAI({
          apiKey: 'fixture',
          baseURL: `http://127.0.0.1:${address.port}${base}`,
          maxRetries: 0,
        });
        const result = await sdk.chat.completions.create(
          input as OpenAI.ChatCompletionCreateParamsNonStreaming,
        );
        assert.equal(result.system_fingerprint, 'fp-private-backend');
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  test(`${kind}: malformed upstream fingerprint fails safely after response with accounting`, async () => {
    for (const value of [true, 3, [], {}, { private: 'fp-private-backend' }])
      for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
        const f = fixture(kind, 'private response', undefined, 'stop', '', value);
        const response = await f.handler(request(path));
        assert.equal(response.status, 502);
        assert.equal(f.calls(), 1);
        assert.equal(f.usage.length, 1);
        assert.equal((f.usage[0] as { possiblyBilled: boolean }).possiblyBilled, true);
        assert.doesNotMatch(
          await response.text(),
          /fp-private-backend|private response|fixture-key/u,
        );
        assert.doesNotMatch(
          JSON.stringify([f.audits, f.usage]),
          /fp-private-backend|private response|fixture-key/u,
        );
      }
  });
  test(`${kind}: security denials never reach fingerprint-bearing upstream`, async () => {
    for (const [gate, status] of [
      ['deny', 403],
      ['explicit', 403],
      ['limit', 429],
      ['audit', 503],
    ] as const)
      for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
        const f = fixture(kind, 'private response', undefined, 'stop', gate, 'fp-private-backend');
        const response = await f.handler(request(path));
        assert.equal(response.status, status);
        assert.equal(f.calls(), 0);
        assert.equal(f.usage.length, 0);
        assert.doesNotMatch(await response.text(), /fp-private-backend/u);
      }
  });
}
for (const kind of ['anthropic', 'google'] as const) {
  test(`${kind}: native responses never fabricate OpenAI backend fingerprints`, async () => {
    const invoke = createDirectChatInvoker({
      registrations: [
        {
          providerId: 'provider',
          kind,
          credentialRef: 'secret/reference',
          ...(kind === 'anthropic' ? { maxOutputTokens: 100 } : {}),
        },
      ],
      resolveSecret: async () => 'fixture-key',
      fetcher: async () =>
        Response.json(
          kind === 'anthropic'
            ? {
                id: 'completion',
                content: [{ type: 'text', text: 'reply' }],
                stop_reason: 'end_turn',
                usage: { input_tokens: 2, output_tokens: 1 },
                system_fingerprint: 'fp-private-backend',
              }
            : {
                candidates: [{ content: { parts: [{ text: 'reply' }] }, finishReason: 'STOP' }],
                usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
                system_fingerprint: 'fp-private-backend',
              },
        ),
    });
    const result = await invoke(
      { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'model' },
      { ...input, max_tokens: 17 },
    );
    assert.equal(Object.hasOwn(result, 'system_fingerprint'), false);
    const handler = projectionFixture(Object.freeze(result));
    const compatible = await handler(request('/api/v1/chat/completions'));
    assert.equal(compatible.status, 200);
    assert.equal(((await compatible.json()) as Record<string, unknown>).system_fingerprint, null);
    const legacy = await handler(request('/v1/chat/completions'));
    assert.equal(Object.hasOwn((await legacy.json()) as object, 'system_fingerprint'), false);
    assert.equal(Object.hasOwn(result, 'system_fingerprint'), false);
  });
}

function projectionFixture(response: unknown) {
  return createChatHandler({
    newRequestId: () => 'request',
    authenticate: async () => ({
      id: 'user',
      active: true,
      credentialId: 'credential',
      policyVersions: [],
      statements: [{ effect: 'Allow', actions: ['*'], resources: ['*'] }],
    }),
    resolveRoute: async () => ({
      version: 'v1',
      candidates: [
        {
          id: 'candidate',
          kind: 'managed',
          providerId: 'provider',
          upstreamModelId: 'model',
        },
      ],
    }),
    checkLimit: async () => true,
    resolveSecret: async () => 'fixture-key',
    writeAudit: async () => {},
    writeUsage: async () => {},
    invokeDirect: async () => response,
    invokeOpenRouter: async () => response,
  });
}

test('compatible projection clones completions and preserves opaque responses', async () => {
  for (const response of [
    Object.freeze({ object: 'chat.completion', id: 'completion' }),
    Object.freeze({ id: 'opaque' }),
    Object.freeze({ object: 'other' }),
    ['opaque'],
    null,
    'opaque',
  ]) {
    const handler = projectionFixture(response);
    const result = await handler(request('/api/v1/chat/completions'));
    assert.equal(result.status, 200);
    const expected =
      response &&
      typeof response === 'object' &&
      'object' in response &&
      response.object === 'chat.completion'
        ? { ...response, system_fingerprint: null }
        : response;
    assert.deepEqual(await result.json(), expected);
    if (response && typeof response === 'object')
      assert.equal(Object.hasOwn(response, 'system_fingerprint'), false);
  }
});

test('compatible managed/delegated unknown fingerprints are explicit null while legacy omits', async () => {
  for (const kind of ['openai', 'openrouter'] as const) {
    const f = fixture(kind, 'private answer', undefined);
    const compatible = await f.handler(request('/api/v1/chat/completions'));
    assert.equal(compatible.status, 200);
    assert.equal(((await compatible.json()) as Record<string, unknown>).system_fingerprint, null);
    const legacy = await f.handler(request('/v1/chat/completions'));
    assert.equal(Object.hasOwn((await legacy.json()) as object, 'system_fingerprint'), false);
    assert.equal(f.usage.length, 2);
  }
});

for (const kind of ['openai', 'openrouter'] as const) {
  test(`${kind}: official OpenRouter SDK accepts compatible unknown fingerprint`, async () => {
    const f = fixture(kind, 'response', undefined);
    const server = createNodeRequestServer(f.handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const sdk = new OpenRouter({
        apiKey: 'fixture',
        serverURL: `http://127.0.0.1:${address.port}/api/v1`,
        retryConfig: { strategy: 'none' },
        timeoutMs: 3000,
      });
      const result = await sdk.chat.send({ chatRequest: input });
      assert.ok('choices' in result);
      assert.equal(result.systemFingerprint, null);
      assert.equal(result.usage?.totalTokens, 3);
      assert.equal(f.usage.length, 1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}
