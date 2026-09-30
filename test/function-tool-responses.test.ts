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
  const sent: Record<string, unknown>[] = [];
  const audits: unknown[] = [];
  const usage: unknown[] = [];
  const fetcher: typeof fetch = async (_, init) => {
    calls++;
    sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
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
  return { handler, audits, usage, sent, calls: () => calls };
}
const input = { model: 'chat', messages: [{ role: 'user', content: 'private prompt' }] };
function request(path: string) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}
const firstCall = {
  id: 'call_one',
  type: 'function',
  function: { name: 'lookup', arguments: '{"query":"private value"}' },
};
const secondCall = {
  id: 'call_two',
  type: 'function',
  function: { name: 'summarize', arguments: '{}' },
};
for (const kind of ['openai', 'openrouter'] as const) {
  test(`${kind}: valid tool calls preserve data and finish reason on both HTTP paths`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
      for (const content of [null, 'private prelude', Symbol('omitted content')]) {
        const f = fixture(kind, content, undefined, 'tool_calls', '', {
          tool_calls: [firstCall, secondCall],
        });
        const response = await f.handler(request(path));
        assert.equal(response.status, 200);
        const body = (await response.json()) as {
          choices: { finish_reason: string; message: Record<string, unknown> }[];
        };
        assert.equal(body.choices[0]?.finish_reason, 'tool_calls');
        assert.equal(
          body.choices[0]?.message.content,
          typeof content === 'symbol' ? null : content,
        );
        assert.deepEqual(body.choices[0]?.message.tool_calls, [firstCall, secondCall]);
        assert.equal(f.usage.length, 1);
        assert.doesNotMatch(
          JSON.stringify([f.audits, f.usage]),
          /private value|lookup|summarize|private prelude|fixture-key/u,
        );
      }
  });
  test(`${kind}: installed SDK reads tool calls through both base paths`, async () => {
    const f = fixture(kind, null, undefined, 'tool_calls', '', { tool_calls: [firstCall] });
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
        const result = await sdk.chat.completions.create({
          ...input,
          tools: [
            { type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } },
          ],
          tool_choice: { type: 'function', function: { name: 'lookup' } },
        } as OpenAI.ChatCompletionCreateParamsNonStreaming);
        assert.equal(result.choices[0]?.finish_reason, 'tool_calls');
        assert.deepEqual(result.choices[0]?.message.tool_calls, [firstCall]);
        assert.deepEqual(f.sent.at(-1)?.tools, [
          { type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } },
        ]);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  test(`${kind}: malformed or mismatched calls remain safe billed failures`, async () => {
    for (const [calls, finish, extra] of [
      [[firstCall], 'stop', {}],
      [[], 'tool_calls', {}],
      [[{ ...firstCall, id: '' }], 'tool_calls', {}],
      [[{ ...firstCall, function: { name: 'lookup', arguments: {} } }], 'tool_calls', {}],
      [[firstCall, firstCall], 'tool_calls', {}],
      [[firstCall], 'tool_calls', { function_call: firstCall.function }],
      [[firstCall], 'tool_calls', { refusal: 'private refusal' }],
    ] as const) {
      const f = fixture(kind, null, undefined, finish, '', { tool_calls: calls, ...extra });
      const response = await f.handler(request('/api/v1/chat/completions'));
      assert.equal(response.status, 502);
      assert.equal((f.usage[0] as { possiblyBilled: boolean }).possiblyBilled, true);
      assert.doesNotMatch(
        JSON.stringify([f.audits, f.usage, await response.text()]),
        /private value|lookup|fixture-key/u,
      );
    }
  });
  test(`${kind}: tool outputs remain behind IAM, limit and audit gates`, async () => {
    for (const [gate, status] of [
      ['deny', 403],
      ['explicit', 403],
      ['limit', 429],
      ['audit', 503],
    ] as const)
      for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
        const f = fixture(kind, null, undefined, 'tool_calls', gate, { tool_calls: [firstCall] });
        const response = await f.handler(request(path));
        assert.equal(response.status, status);
        assert.equal(f.calls(), 0);
        assert.equal(f.usage.length, 0);
      }
  });
}
