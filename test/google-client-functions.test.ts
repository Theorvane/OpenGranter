import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { type ChatRequest, createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import {
  createDirectChatInvoker,
  createDirectChatTransport,
} from '../src/providers/direct-chat.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

const candidate = {
  id: 'one',
  kind: 'managed' as const,
  providerId: 'google',
  upstreamModelId: 'gemini-exact',
};
const registrations = [
  {
    providerId: 'google',
    kind: 'google' as const,
    credentialRef: 'secret/google',
    maxOutputTokens: 64,
  },
];
const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'lookup',
      description: 'private schema',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
      strict: false,
    },
  },
];
const calls = [
  {
    id: 'call_a',
    type: 'function' as const,
    function: { name: 'lookup', arguments: '{"query":"private input"}' },
  },
  { id: 'call_b', type: 'function' as const, function: { name: 'lookup', arguments: '{}' } },
];
const history = [
  { role: 'user', content: 'private prompt' },
  { role: 'assistant', content: 'private answer', tool_calls: calls },
  { role: 'tool', tool_call_id: 'call_b', content: 'private result b' },
  { role: 'tool', tool_call_id: 'call_a', content: 'private result a' },
];
const nativeParts = [
  { text: 'private answer' },
  ...calls.map((c) => ({
    functionCall: {
      id: c.id,
      name: c.function.name,
      args: JSON.parse(c.function.arguments) as unknown,
    },
  })),
];
function body(
  parts: readonly object[] = nativeParts,
  finishReason = 'STOP',
  usage: unknown = { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 7 },
) {
  return {
    responseId: 'native',
    modelVersion: 'gemini-exact',
    candidates: [{ index: 0, content: { role: 'model', parts }, finishReason }],
    usageMetadata: usage,
  };
}
const toolBody = body(),
  textBody = body([{ text: 'done' }]);
const nativeHistory = [
  { role: 'user', parts: [{ text: 'private prompt' }] },
  { role: 'model', parts: nativeParts },
  {
    role: 'user',
    parts: [
      {
        functionResponse: {
          id: 'call_a',
          name: 'lookup',
          response: { output: 'private result a' },
        },
      },
      {
        functionResponse: {
          id: 'call_b',
          name: 'lookup',
          response: { output: 'private result b' },
        },
      },
    ],
  },
];

function fixture(
  options: {
    body?: unknown;
    mutate?: () => void;
    deny?: boolean;
    limit?: boolean;
    usageFail?: boolean;
    auditFail?: boolean;
    upstreamFail?: boolean;
  } = {},
) {
  let keys = 0;
  const sent: Record<string, unknown>[] = [],
    usage: UsageRecord[] = [],
    audits: unknown[] = [];
  const ports = {
    registrations,
    resolveSecret: async () => {
      keys++;
      options.mutate?.();
      return 'fixture-provider-key';
    },
    fetcher: (async (url, init) => {
      assert.equal(
        String(url),
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-exact:generateContent',
      );
      assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'fixture-provider-key');
      assert.equal(init?.redirect, 'error');
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return options.upstreamFail
        ? new Response('private upstream fixture-provider-key', { status: 400 })
        : Response.json(options.body ?? (sent.length === 1 ? toolBody : textBody));
    }) as typeof fetch,
  };
  const invoke = createDirectChatInvoker(ports);
  const handler = createChatHandler({
    newRequestId: () => 'request',
    authenticate: async () => ({
      id: 'user',
      active: true,
      credentialId: 'credential',
      policyVersions: [],
      statements: [
        { effect: 'Allow', actions: ['llm:*'], resources: ['*'] },
        ...(options.deny
          ? [
              {
                effect: 'Deny' as const,
                actions: ['llm:UseProvider'],
                resources: ['provider:google'],
              },
            ]
          : []),
      ],
    }),
    resolveRoute: async () => ({ kind: 'managed', version: 'v1', candidates: [candidate] }),
    checkLimit: async () => !options.limit,
    resolveSecret: async () => {
      assert.fail('unexpected delegated credential');
    },
    invokeDirect: invoke,
    writeUsage: async (record) => {
      if (options.usageFail) throw new Error('private usage');
      usage.push(record);
    },
    writeAudit: async (event) => {
      if (options.auditFail) throw new Error('private audit');
      audits.push(event);
    },
  });
  return { ports, invoke, handler, keys: () => keys, sent, usage, audits };
}
function input(fields: Record<string, unknown> = {}) {
  return {
    model: 'chat',
    messages: [{ role: 'user', content: 'private prompt' }],
    tools,
    max_tokens: 100,
    ...fields,
  };
}
function request(base: string, fields: Record<string, unknown> = {}) {
  return new Request(`http://gateway${base}/chat/completions`, {
    method: 'POST',
    headers: { authorization: 'Bearer proxy', 'content-type': 'application/json' },
    body: JSON.stringify(input(fields)),
  });
}
for (const base of ['/v1', '/api/v1']) {
  test(`Gemini ${base} maps declarations choice mixed calls and reported totals`, async () => {
    const f = fixture(),
      response = await f.handler(
        request(base, { tool_choice: 'required', parallel_tool_calls: true }),
      );
    assert.equal(response.status, 200);
    const result = (await response.json()) as {
      choices: { message: unknown; finish_reason: string }[];
      system_fingerprint: unknown;
    };
    assert.deepEqual(result.choices[0]?.message, {
      role: 'assistant',
      content: 'private answer',
      tool_calls: calls,
    });
    assert.equal(result.choices[0]?.finish_reason, 'tool_calls');
    assert.equal(result.system_fingerprint, null);
    assert.deepEqual(f.sent[0]?.tools, [
      {
        functionDeclarations: [
          {
            name: 'lookup',
            description: 'private schema',
            parametersJsonSchema: tools[0]?.function.parameters,
          },
        ],
      },
    ]);
    assert.deepEqual(f.sent[0]?.toolConfig, { functionCallingConfig: { mode: 'ANY' } });
    assert.deepEqual(f.sent[0]?.generationConfig, {
      maxOutputTokens: 64,
      thinkingConfig: { thinkingBudget: 0 },
    });
    assert.deepEqual(f.usage[0]?.usage, {
      status: 'reported',
      promptTokens: 3,
      completionTokens: 2,
      totalTokens: 7,
    });
    assert.equal(f.usage[0]?.actualInferenceProviderId, 'google');
    assert.doesNotMatch(JSON.stringify([f.usage, f.audits]), /private|fixture-provider-key/u);
  });
  test(`Gemini ${base} groups results in original call order with exact names`, async () => {
    const f = fixture({ body: textBody });
    assert.equal((await f.handler(request(base, { messages: history }))).status, 200);
    assert.deepEqual(f.sent[0]?.contents, nativeHistory);
  });
  for (const [options, status] of [
    [{ deny: true }, 403],
    [{ limit: true }, 429],
    [{ auditFail: true }, 503],
    [{ usageFail: true }, 503],
    [{ upstreamFail: true }, 502],
  ] as const)
    test(`Gemini ${base} retains security failure gates ${JSON.stringify(options)}`, async () => {
      const f = fixture(options),
        response = await f.handler(request(base, { messages: history }));
      assert.equal(response.status, status);
      if (options.deny || options.limit || options.auditFail) assert.equal(f.keys(), 0);
      if (options.upstreamFail) assert.equal(f.usage[0]?.possiblyBilled, true);
      assert.doesNotMatch(
        JSON.stringify([await response.text(), f.usage, f.audits]),
        /private|fixture-provider-key/u,
      );
    });
}
for (const [choice, parallel, expected] of [
  [undefined, undefined, undefined],
  ['none', false, { mode: 'NONE' }],
  ['auto', true, { mode: 'AUTO' }],
  ['required', undefined, { mode: 'ANY' }],
  [
    { type: 'function', function: { name: 'lookup' } },
    true,
    { mode: 'ANY', allowedFunctionNames: ['lookup'] },
  ],
] as const)
  test(`Gemini native tool choice ${JSON.stringify(choice)}`, async () => {
    const f = fixture({ body: textBody });
    await f.invoke(
      candidate,
      input({ tool_choice: choice, parallel_tool_calls: parallel }) as ChatRequest,
    );
    assert.deepEqual(
      f.sent[0]?.toolConfig,
      expected === undefined ? undefined : { functionCallingConfig: expected },
    );
  });
test('Gemini omitted schemas nullable strict and absent description keep native omission', async () => {
  const f = fixture({ body: textBody });
  await f.invoke(
    candidate,
    input({
      tools: [{ type: 'function', function: { name: 'lookup', strict: null } }],
    }) as ChatRequest,
  );
  assert.deepEqual(f.sent[0]?.tools, [
    { functionDeclarations: [{ name: 'lookup', description: '' }] },
  ]);
});
for (const fields of [
  { tools: [{ type: 'function', function: { name: 'lookup', strict: true } }] },
  { parallel_tool_calls: false },
  { reasoning_effort: 'low' },
  { tools: [{ type: 'function', function: { name: 'bad name' } }] },
  { tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'array' } } }] },
  { tool_choice: { type: 'function', function: { name: 'bad name' } } },
  ...['null', '[]', '1', 'private invalid', '{"x":1e999}'].map((argumentsValue) => ({
    messages: [
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ ...calls[0], function: { name: 'lookup', arguments: argumentsValue } }],
      },
      { role: 'tool', tool_call_id: 'call_a', content: 'private result' },
    ],
  })),
])
  test('Gemini rejects unsupported controls or malformed object history before keys', async () => {
    const f = fixture();
    await assert.rejects(
      () => f.invoke(candidate, input(fields) as ChatRequest),
      (error) => {
        assert.doesNotMatch(String(error), /private|fixture-provider-key/u);
        return true;
      },
    );
    assert.equal(f.keys(), 0);
    assert.equal(f.sent.length, 0);
  });
for (const nativeBody of [
  body(nativeParts, 'MAX_TOKENS'),
  body(nativeParts, 'SAFETY'),
  body([
    { functionCall: { id: 'same', name: 'lookup', args: {} } },
    { functionCall: { id: 'same', name: 'lookup', args: {} } },
  ]),
  ...[null, [], 1, 'private'].map((args) =>
    body([{ functionCall: { id: 'call', name: 'lookup', args } }]),
  ),
  body([{ functionCall: { id: '', name: 'lookup', args: {} } }]),
  body([{ functionCall: { name: 'bad name', args: {} } }]),
  body([
    {
      functionCall: { id: 'call', name: 'lookup', args: {} },
      thoughtSignature: 'private signature',
    },
  ]),
  body([{ text: 'private answer', thoughtSignature: 'private signature' }]),
  body([{ functionCall: { id: 'call', name: 'lookup', args: {} }, thought: true }]),
  body([{ functionCall: { id: 'call', name: 'lookup', args: {} }, text: 'private text' }]),
  body([{ toolCall: { name: 'private server' } }]),
  body([{ functionCall: { id: 'call', name: 'lookup', args: {}, extra: 'private' } }]),
  body([{ functionCall: { id: 'call', name: 'lookup', args: { x: Array(20_001).fill(0) } } }]),
])
  test('Gemini malformed or signature-bearing functions fail safely possibly billed', async () => {
    const f = fixture({ body: nativeBody }),
      response = await f.handler(request('/v1'));
    assert.equal(response.status, 502);
    assert.equal(f.keys(), 1);
    assert.equal(f.usage[0]?.possiblyBilled, true);
    assert.doesNotMatch(
      JSON.stringify([await response.text(), f.usage, f.audits]),
      /private|fixture-provider-key/u,
    );
  });
test('Gemini id-less calls receive reserved local IDs and omit native IDs on replay', async () => {
  const f = fixture({ body: body([{ functionCall: { name: 'lookup' } }]) });
  const first = await f.invoke(candidate, input() as ChatRequest);
  const returned = first.choices[0].message.tool_calls;
  assert.ok(returned?.[0]);
  assert.match(returned[0].id, /^og_google_missing_id_[0-9a-f-]{36}$/u);
  assert.equal(returned[0].function.arguments, '{}');
  await f.invoke(
    candidate,
    input({
      messages: [
        { role: 'user', content: 'private prompt' },
        { role: 'assistant', content: null, tool_calls: returned },
        { role: 'tool', tool_call_id: returned[0].id, content: '{"private":"result"}' },
      ],
    }) as ChatRequest,
  );
  assert.deepEqual(f.sent[1]?.contents, [
    { role: 'user', parts: [{ text: 'private prompt' }] },
    { role: 'model', parts: [{ functionCall: { name: 'lookup', args: {} } }] },
    {
      role: 'user',
      parts: [
        { functionResponse: { name: 'lookup', response: { output: '{"private":"result"}' } } },
      ],
    },
  ]);
});
test('Gemini snapshots object schemas and history before key resolution', async () => {
  const messages = structuredClone(history),
    declarations = structuredClone(tools);
  const call = messages[1]?.tool_calls?.[0];
  const declaration = declarations[0];
  assert.ok(call);
  assert.ok(declaration);
  const f = fixture({
    body: textBody,
    mutate: () => {
      call.function.arguments = 'private changed';
      declaration.function.parameters.type = 'array';
    },
  });
  await f.invoke(candidate, input({ messages, tools: declarations }) as unknown as ChatRequest);
  assert.deepEqual(f.sent[0]?.contents, nativeHistory);
  assert.equal(
    (
      f.sent[0]?.tools as { functionDeclarations: { parametersJsonSchema: { type: string } }[] }[]
    )?.[0]?.functionDeclarations[0]?.parametersJsonSchema.type,
    'object',
  );
});
for (const usage of [
  undefined,
  { promptTokenCount: 3, candidatesTokenCount: 2 },
  { promptTokenCount: -1, candidatesTokenCount: 2, totalTokenCount: 7 },
])
  test('Gemini functions retain missing partial invalid reported-only usage', async () => {
    const f = fixture({ body: { ...toolBody, usageMetadata: usage } });
    assert.equal((await f.handler(request('/v1'))).status, 200);
    assert.equal(
      f.usage[0]?.usage.status,
      usage === undefined ? 'missing' : usage.promptTokenCount === -1 ? 'invalid' : 'partial',
    );
    if (usage?.promptTokenCount === 3) assert.equal(f.usage[0]?.usage.totalTokens, null);
  });
test('Gemini text stream mode remains tool-free', async () => {
  const f = fixture();
  await assert.rejects(() =>
    createDirectChatTransport(f.ports)(candidate, input() as ChatRequest, 'google-text'),
  );
  assert.equal(f.keys(), 0);
});
for (const sdkKind of ['openai', 'openrouter'] as const)
  for (const base of ['/v1', '/api/v1'])
    test(`${sdkKind} ${base} Gemini function round trip and fresh Deny`, async () => {
      const options = { deny: false },
        f = fixture(options),
        server = createNodeRequestServer(f.handler);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const address = server.address();
        assert.ok(address && typeof address === 'object');
        const url = `http://127.0.0.1:${address.port}${base}`;
        if (sdkKind === 'openai') {
          const sdk = new OpenAI({ apiKey: 'fixture', maxRetries: 0, baseURL: url });
          const first = await sdk.chat.completions.create(
            input() as OpenAI.ChatCompletionCreateParamsNonStreaming,
          );
          assert.deepEqual(first.choices[0]?.message.tool_calls, calls);
          const second = await sdk.chat.completions.create(
            input({ messages: history }) as OpenAI.ChatCompletionCreateParamsNonStreaming,
          );
          assert.equal(second.choices[0]?.message.content, 'done');
          options.deny = true;
          await assert.rejects(() =>
            sdk.chat.completions.create(
              input({ messages: history }) as OpenAI.ChatCompletionCreateParamsNonStreaming,
            ),
          );
        } else {
          const sdk = new OpenRouter({
            apiKey: 'fixture',
            retryConfig: { strategy: 'none' },
            serverURL: url,
          });
          const first = await sdk.chat.send({
            chatRequest: {
              model: 'chat',
              tools,
              messages: [{ role: 'user', content: 'private prompt' }],
              stream: false,
            },
          });
          assert.ok('choices' in first);
          const returned = first.choices[0]?.message.toolCalls;
          assert.deepEqual(returned, calls);
          assert.ok(returned);
          const continuation = {
            model: 'chat',
            tools,
            stream: false as const,
            messages: [
              { role: 'user' as const, content: 'private prompt' },
              {
                role: 'assistant' as const,
                content: first.choices[0]?.message.content ?? null,
                toolCalls: returned,
              },
              ...returned.map((call) => ({
                role: 'tool' as const,
                toolCallId: call.id,
                content: 'private result',
              })),
            ],
          };
          const second = await sdk.chat.send({ chatRequest: continuation });
          assert.ok('choices' in second);
          assert.equal(second.choices[0]?.message.content, 'done');
          options.deny = true;
          await assert.rejects(() => sdk.chat.send({ chatRequest: continuation }));
        }
        assert.equal(f.keys(), 2);
        assert.equal(f.sent.length, 2);
        assert.equal(f.usage.length, 2);
        assert.doesNotMatch(JSON.stringify([f.usage, f.audits]), /private|fixture-provider-key/u);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    });
test('Gemini reserved local ID namespace cannot impersonate a provider-reported ID', async () => {
  const f = fixture({
    body: body([
      {
        functionCall: {
          id: 'og_google_missing_id_11111111-1111-4111-8111-111111111111',
          name: 'lookup',
          args: {},
        },
      },
    ]),
  });
  assert.equal((await f.handler(request('/v1'))).status, 502);
  assert.equal(f.usage[0]?.possiblyBilled, true);
});
test('Gemini tool candidate must be a native model content envelope', async () => {
  const f = fixture({
    body: {
      ...toolBody,
      candidates: [{ ...toolBody.candidates[0], content: { role: 'user', parts: nativeParts } }],
    },
  });
  assert.equal((await f.handler(request('/v1'))).status, 502);
});
