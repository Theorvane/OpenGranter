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
  nativeReason?: unknown,
  metadata: { serviceTier?: unknown; reasoning?: unknown } = {},
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
      system_fingerprint: 'fp_fixture',
      ...(metadata.serviceTier === undefined ? {} : { service_tier: metadata.serviceTier }),
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content,
            ...(metadata.reasoning === undefined ? {} : { reasoning: metadata.reasoning }),
            ...(refusal === undefined ? {} : { refusal }),
            ...(finish === 'tool_calls'
              ? {
                  tool_calls: [
                    { id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } },
                  ],
                }
              : {}),
          },
          finish_reason: finish,
          ...(nativeReason === undefined ? {} : { native_finish_reason: nativeReason }),
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
      if (
        gate === 'audit' ||
        (gate === 'outcome' && (event.kind === 'attempt' || event.kind === 'delegated-attempt'))
      )
        throw new Error('private audit');
      audits.push(event);
    },
    writeUsage: async (record) => {
      if (gate === 'ledger') throw Error('private ledger');
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
  test(`${kind}: nonstream native finish reason survives both HTTP bases independently`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
      for (const nativeReason of [
        undefined,
        null,
        '',
        'private-native-reason',
        '종료\n\ndata: forged',
      ])
        for (const [content, refusal, finish] of [
          ['private response', undefined, 'stop'],
          ['private response', undefined, 'length'],
          [null, 'private refusal', 'stop'],
          [null, undefined, 'content_filter'],
          [null, undefined, 'tool_calls'],
        ] as const) {
          const f = fixture(kind, content, refusal, finish, '', nativeReason);
          const response = await f.handler(request(path));
          assert.equal(response.status, 200);
          const result = (await response.json()) as {
            choices: [{ native_finish_reason?: unknown; finish_reason: string | null }];
          };
          assert.equal(result.choices[0].native_finish_reason, nativeReason);
          assert.equal(
            Object.hasOwn(result.choices[0], 'native_finish_reason'),
            nativeReason !== undefined,
          );
          assert.equal(result.choices[0].finish_reason, finish);
          assert.equal(f.usage.length, 1);
          assert.doesNotMatch(
            JSON.stringify([f.audits, f.usage]),
            /private-native-reason|종료|forged|private response|private refusal|private prompt|fixture-key/u,
          );
        }
  });
}

for (const kind of ['openai', 'openrouter'] as const) {
  test(`${kind}: malformed native reasons fail safely after dispatch with accounting`, async () => {
    for (const nativeReason of [true, 3, [], { private: 'private-native-reason' }])
      for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
        const f = fixture(kind, 'private response', undefined, 'stop', '', nativeReason);
        const response = await f.handler(request(path));
        assert.equal(response.status, 502);
        assert.equal(f.calls(), 1);
        assert.equal(f.usage.length, 1);
        assert.equal((f.usage[0] as { possiblyBilled: boolean }).possiblyBilled, true);
        assert.doesNotMatch(await response.text(), /private|fixture-key/u);
        assert.doesNotMatch(
          JSON.stringify([f.audits, f.usage]),
          /private-native-reason|private response|fixture-key/u,
        );
      }
  });
  test(`${kind}: native-reason metadata never bypasses security gates`, async () => {
    for (const [gate, status] of [
      ['deny', 403],
      ['explicit', 403],
      ['limit', 429],
      ['audit', 503],
    ] as const)
      for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
        const f = fixture(kind, 'response', undefined, 'stop', gate, 'private-native-reason');
        const response = await f.handler(request(path));
        assert.equal(response.status, status);
        assert.equal(f.calls(), 0);
        assert.equal(f.usage.length, 0);
      }
  });
  test(`${kind}: required ledger and outcome audit remain success gates`, async () => {
    for (const gate of ['ledger', 'outcome'])
      for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
        const f = fixture(kind, 'response', undefined, 'stop', gate, 'private-native-reason');
        const response = await f.handler(request(path));
        assert.equal(response.status, 503);
        assert.equal(f.calls(), 1);
        assert.equal(f.usage.length, gate === 'ledger' ? 0 : 1);
        assert.doesNotMatch(await response.text(), /private|fixture-key/u);
      }
  });
  test(`${kind}: SDK sockets expose OpenAI JSON retention and the pinned OpenRouter omission`, async () => {
    const f = fixture(kind, 'response', undefined, 'stop', '', 'private-native-reason');
    const server = createNodeRequestServer(f.handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      for (const base of ['/v1', '/api/v1']) {
        const url = `http://127.0.0.1:${address.port}${base}`;
        const sdk = new OpenAI({ apiKey: 'fixture', baseURL: url, maxRetries: 0 });
        const result = await sdk.chat.completions.create(input);
        assert.equal(
          (result.choices[0] as unknown as { native_finish_reason: unknown }).native_finish_reason,
          'private-native-reason',
        );
        const router = new OpenRouter({
          apiKey: 'fixture',
          serverURL: url,
          retryConfig: { strategy: 'none' },
        });
        const chat = await router.chat.send({ chatRequest: input });
        assert.ok('choices' in chat);
        assert.equal(chat.choices[0]?.finishReason, 'stop');
        assert.equal(Object.hasOwn(chat.choices[0] ?? {}, 'nativeFinishReason'), false);
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}
for (const kind of ['anthropic', 'google'] as const)
  test(`${kind}: native mappings do not synthesize documented extension metadata`, async () => {
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
                native_finish_reason: 'private-native-reason',
              }
            : {
                candidates: [
                  {
                    content: { parts: [{ text: 'reply' }] },
                    finishReason: 'STOP',
                    native_finish_reason: 'private-native-reason',
                  },
                ],
                usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
              },
        ),
    });
    const result = await invoke(
      { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'model' },
      { ...input, max_tokens: 17 },
    );
    assert.equal(result.choices[0].finish_reason, 'stop');
    assert.equal(Object.hasOwn(result.choices[0], 'native_finish_reason'), false);
  });

for (const kind of ['openai', 'openrouter'] as const) {
  test(`${kind}: choice metadata is captured once at the response boundary`, async () => {
    let reads = 0;
    const first = Object.defineProperty(
      { index: 0, message: { role: 'assistant', content: 'reply' }, finish_reason: 'stop' },
      'native_finish_reason',
      {
        get: () => {
          reads++;
          return reads === 1 ? 'private-native-reason' : { invalid: true };
        },
      },
    );
    const body = {
      id: 'completion',
      created: 1,
      model: 'model',
      choices: [first],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    };
    const fetcher: typeof fetch = async () => {
      const response = Response.json({});
      Object.defineProperty(response, 'json', { value: async () => body });
      return response;
    };
    const ports = {
      credentialRef: 'secret/reference',
      resolveSecret: async () => 'fixture-key',
      fetcher,
    };
    const result =
      kind === 'openrouter'
        ? await createOpenRouterChatInvoker(ports)(
            { upstreamModelId: 'model', authorizedProviderSlugs: ['provider'] },
            input,
          )
        : await createDirectChatInvoker({
            ...ports,
            registrations: [
              { providerId: 'provider', kind: 'openai', credentialRef: 'secret/reference' },
            ],
          })(
            { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'model' },
            input,
          );
    assert.equal(result.choices[0].native_finish_reason, 'private-native-reason');
    assert.equal(reads, 1);
  });
  test(`${kind}: native reasons cannot legalize unsupported canonical finish reasons`, async () => {
    for (const finish of ['error', 'unknown']) {
      const f = fixture(kind, 'response', undefined, finish, '', 'stop');
      const response = await f.handler(request('/api/v1/chat/completions'));
      assert.equal(response.status, 502);
      assert.equal(f.usage.length, 1);
      assert.equal((f.usage[0] as { possiblyBilled: boolean }).possiblyBilled, true);
    }
  });
}

for (const kind of ['openai', 'openrouter'] as const)
  test(`${kind}: integrated response metadata coexists without operational disclosure`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      const f = fixture(kind, 'private response', undefined, 'stop', '', 'private-native-reason', {
        serviceTier: 'private-tier',
        reasoning: 'private-reasoning',
      });
      const response = await f.handler(request(path));
      assert.equal(response.status, 200);
      const result = (await response.json()) as {
        service_tier: unknown;
        system_fingerprint: unknown;
        choices: [
          {
            native_finish_reason: unknown;
            finish_reason: unknown;
            message: { reasoning: unknown };
          },
        ];
      };
      assert.equal(result.service_tier, 'private-tier');
      assert.equal(result.system_fingerprint, 'fp_fixture');
      assert.equal(result.choices[0].native_finish_reason, 'private-native-reason');
      assert.equal(result.choices[0].finish_reason, 'stop');
      assert.equal(result.choices[0].message.reasoning, 'private-reasoning');
      assert.doesNotMatch(
        JSON.stringify([f.audits, f.usage]),
        /private-tier|private-reasoning|private-native-reason/u,
      );
    }
  });
