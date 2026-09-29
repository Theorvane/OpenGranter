import assert from 'node:assert/strict';
import { test } from 'node:test';
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
  extra: Record<string, unknown> = {},
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
      choices: [
        {
          index: 0,
          message: {
            ...extra,
            role: 'assistant',
            content,
            ...(refusal === undefined ? {} : { refusal }),
          },
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
const input = { model: 'chat', messages: [{ role: 'user', content: 'private prompt' }] };
function request(path: string) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}
const tool = {
  id: 'call',
  type: 'function',
  function: { name: 'private-function', arguments: 'private-arguments' },
};
const unsupported: readonly [Record<string, unknown>, string][] = [
  [{ tool_calls: [tool] }, 'stop'],
  [{ tool_calls: {} }, 'stop'],
  [{ tool_calls: 'private-arguments' }, 'stop'],
  [{ tool_calls: false }, 'stop'],
  [{ tool_calls: [null] }, 'stop'],
  [{ function_call: tool.function }, 'stop'],
  [{ function_call: [] }, 'stop'],
  [{ function_call: false }, 'stop'],
  [{}, 'tool_calls'],
  [{}, 'function_call'],
  [{ tool_calls: [] }, 'tool_calls'],
  [{ function_call: null }, 'function_call'],
];
for (const kind of ['openai', 'openrouter'] as const) {
  test(`${kind}: unsupported invocation outputs fail through both HTTP prefixes with safe accounting`, async () => {
    for (const [extra, finish] of unsupported)
      for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
        const f = fixture(kind, 'private response', undefined, finish, '', extra);
        const response = await f.handler(request(path));
        assert.equal(response.status, 502);
        assert.equal(f.calls(), 1);
        assert.equal(f.usage.length, 1);
        assert.equal((f.usage[0] as { possiblyBilled: boolean }).possiblyBilled, true);
        assert.doesNotMatch(
          await response.text(),
          /private-function|private-arguments|private response|fixture-key/u,
        );
        assert.doesNotMatch(
          JSON.stringify([f.audits, f.usage]),
          /private-function|private-arguments|private response|fixture-key/u,
        );
      }
  });
  test(`${kind}: no-invocation defaults preserve text/refusal/filter outcomes`, async () => {
    for (const extra of [
      {},
      { tool_calls: null },
      { tool_calls: [] },
      { function_call: null },
      { tool_calls: [], function_call: null },
    ])
      for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
        for (const [content, refusal, finish] of [
          ['reply', undefined, 'stop'],
          [null, 'refusal', 'stop'],
          [null, undefined, 'content_filter'],
        ] as const) {
          const f = fixture(kind, content, refusal, finish, '', extra);
          const response = await f.handler(request(path));
          assert.equal(response.status, 200);
          const body = (await response.json()) as {
            choices: { message: Record<string, unknown> }[];
          };
          assert.equal(body.choices[0]?.message.content, content);
          assert.equal(Object.hasOwn(body.choices[0]?.message ?? {}, 'tool_calls'), false);
          assert.equal(f.usage.length, 1);
        }
  });
  test(`${kind}: actual SDK sees safe tool failure on both bases`, async () => {
    const f = fixture(kind, 'private response', undefined, 'tool_calls', '', {
      tool_calls: [tool],
    });
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
        await assert.rejects(
          () => sdk.chat.completions.create(input as OpenAI.ChatCompletionCreateParamsNonStreaming),
          (error) =>
            error instanceof OpenAI.APIError &&
            error.status === 502 &&
            !/private-function|private-arguments|private response/u.test(error.message),
        );
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  test(`${kind}: unsupported outputs do not bypass IAM limits or audit gates`, async () => {
    for (const [gate, status] of [
      ['deny', 403],
      ['explicit', 403],
      ['limit', 429],
      ['audit', 503],
    ] as const)
      for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
        const f = fixture(kind, 'private response', undefined, 'tool_calls', gate, {
          tool_calls: [tool],
        });
        const response = await f.handler(request(path));
        assert.equal(response.status, status);
        assert.equal(f.calls(), 0);
        assert.equal(f.usage.length, 0);
      }
  });
}
