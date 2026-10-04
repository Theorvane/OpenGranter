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
  providerId: 'anthropic',
  upstreamModelId: 'claude-exact',
};
const registrations = [
  {
    providerId: 'anthropic',
    kind: 'anthropic' as const,
    credentialRef: 'secret/anthropic',
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
      strict: true,
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
const toolBody = {
  id: 'native',
  content: [
    { type: 'text', text: 'private answer' },
    ...calls.map((c) => ({
      type: 'tool_use',
      id: c.id,
      name: c.function.name,
      input: JSON.parse(c.function.arguments) as unknown,
    })),
  ],
  stop_reason: 'tool_use',
  usage: { input_tokens: 3, output_tokens: 2 },
};
const textBody = {
  id: 'native',
  content: [{ type: 'text', text: 'done' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 3, output_tokens: 2 },
};
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
      assert.equal(String(url), 'https://api.anthropic.com/v1/messages');
      assert.equal(new Headers(init?.headers).get('x-api-key'), 'fixture-provider-key');
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
                resources: ['provider:anthropic'],
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
  test(`Anthropic ${base} normalizes mixed text and parallel client calls with safe usage`, async () => {
    const f = fixture();
    const response = await f.handler(
      request(base, { tool_choice: 'required', parallel_tool_calls: false }),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      model: string;
      choices: { message: unknown; finish_reason: string }[];
    };
    assert.equal(body.model, 'chat');
    assert.deepEqual(body.choices[0]?.message, {
      role: 'assistant',
      content: 'private answer',
      tool_calls: calls,
    });
    assert.equal(body.choices[0]?.finish_reason, 'tool_calls');
    assert.deepEqual(f.sent[0]?.tools, [
      {
        name: 'lookup',
        description: 'private schema',
        input_schema: tools[0]?.function.parameters,
        strict: true,
      },
    ]);
    assert.deepEqual(f.sent[0]?.tool_choice, { type: 'any', disable_parallel_tool_use: true });
    assert.equal(f.sent[0]?.parallel_tool_calls, undefined);
    assert.equal(f.sent[0]?.max_tokens, 64);
    assert.deepEqual(f.usage[0]?.usage, {
      status: 'reported',
      promptTokens: 3,
      completionTokens: 2,
      totalTokens: 5,
    });
    assert.equal(f.usage[0]?.actualInferenceProviderId, 'anthropic');
    assert.doesNotMatch(JSON.stringify([f.usage, f.audits]), /private|fixture-provider-key/u);
  });
  test(`Anthropic ${base} groups complete correlated results`, async () => {
    const f = fixture({ body: textBody });
    assert.equal((await f.handler(request(base, { messages: history }))).status, 200);
    assert.deepEqual(f.sent[0]?.messages, [
      history[0],
      { role: 'assistant', content: toolBody.content },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_b', content: 'private result b' },
          { type: 'tool_result', tool_use_id: 'call_a', content: 'private result a' },
        ],
      },
    ]);
  });
  for (const [options, status] of [
    [{ deny: true }, 403],
    [{ limit: true }, 429],
    [{ auditFail: true }, 503],
    [{ usageFail: true }, 503],
    [{ upstreamFail: true }, 502],
  ] as const)
    test(`Anthropic ${base} preserves gates ${JSON.stringify(options)}`, async () => {
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
  ['none', false, { type: 'none' }],
  ['none', true, { type: 'none' }],
  ['auto', false, { type: 'auto', disable_parallel_tool_use: true }],
  ['required', true, { type: 'any', disable_parallel_tool_use: false }],
  [undefined, false, { type: 'auto', disable_parallel_tool_use: true }],
  [{ type: 'function', function: { name: 'lookup' } }, undefined, { type: 'tool', name: 'lookup' }],
] as const)
  test(`Anthropic choices ${JSON.stringify(choice)} parallel ${parallel}`, async () => {
    const f = fixture({ body: textBody });
    await f.invoke(
      candidate,
      input({ tool_choice: choice, parallel_tool_calls: parallel }) as ChatRequest,
    );
    assert.deepEqual(f.sent[0]?.tool_choice, expected);
  });
test('Anthropic omitted parameters and nullable strict preserve native defaults', async () => {
  const f = fixture({ body: textBody });
  await f.invoke(
    candidate,
    input({
      tools: [{ type: 'function', function: { name: 'lookup', strict: null } }],
    }) as ChatRequest,
  );
  assert.deepEqual(f.sent[0]?.tools, [{ name: 'lookup', input_schema: { type: 'object' } }]);
});
for (const fields of [
  { tools: [{ type: 'function', function: { name: 'bad.name', parameters: { type: 'object' } } }] },
  { tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'array' } } }] },
  { tool_choice: { type: 'function', function: { name: 'bad.name' } } },
  ...['private invalid', '[]', 'null', '"private"', '1', '{"bad":1e999}'].map((argumentsValue) => ({
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
  test(`Anthropic rejects unsupported native inputs before credentials ${JSON.stringify(fields).slice(0, 90)}`, async () => {
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
for (const body of [
  { ...toolBody, stop_reason: 'end_turn' },
  { ...textBody, stop_reason: 'tool_use' },
  { ...toolBody, content: [toolBody.content[1], toolBody.content[1]] },
  ...[null, [], 'private', 1, { bad: Array(20_001).fill(0) }].map((value) => ({
    ...toolBody,
    content: [{ type: 'tool_use', id: 'call', name: 'lookup', input: value }],
  })),
  ...['thinking', 'server_tool_use', 'image'].map((type) => ({
    ...toolBody,
    content: [{ type, text: 'private response' }],
  })),
  {
    ...toolBody,
    content: [
      {
        type: 'tool_use',
        id: 'call',
        name: 'lookup',
        input: {},
        caller: { type: 'code_execution' },
      },
    ],
  },
])
  test('Anthropic malformed tool responses fail safely after fetch', async () => {
    const f = fixture({ body });
    const response = await f.handler(request('/v1'));
    assert.equal(response.status, 502);
    assert.equal(f.keys(), 1);
    assert.equal(f.usage[0]?.possiblyBilled, true);
    assert.doesNotMatch(
      JSON.stringify([await response.text(), f.usage, f.audits]),
      /private|fixture-provider-key/u,
    );
  });
test('Anthropic captures schemas and history before key mutation', async () => {
  const messageCopy = structuredClone(history),
    toolCopy = structuredClone(tools);
  const f = fixture({
    body: textBody,
    mutate: () => {
      const c = messageCopy[1]?.tool_calls?.[0];
      assert.ok(c);
      c.function.arguments = 'private changed';
      assert.ok(toolCopy[0]);
      toolCopy[0].function.parameters.type = 'array';
    },
  });
  await f.invoke(
    candidate,
    input({ messages: messageCopy, tools: toolCopy }) as unknown as ChatRequest,
  );
  assert.deepEqual(f.sent[0]?.messages, [
    history[0],
    { role: 'assistant', content: toolBody.content },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_b', content: 'private result b' },
        { type: 'tool_result', tool_use_id: 'call_a', content: 'private result a' },
      ],
    },
  ]);
  assert.deepEqual(f.sent[0]?.tools, [
    {
      name: 'lookup',
      description: 'private schema',
      input_schema: tools[0]?.function.parameters,
      strict: true,
    },
  ]);
});
test('Anthropic text and OpenAI function stream modes remain closed to native tools', async () => {
  for (const mode of ['anthropic-text', 'function'] as const) {
    const f = fixture();
    await assert.rejects(() =>
      createDirectChatTransport(f.ports)(candidate, input() as ChatRequest, mode),
    );
    assert.equal(f.keys(), 0);
  }
});
for (const base of ['/v1', '/api/v1'])
  test(`installed OpenAI SDK completes Anthropic parallel tool round trip ${base}`, async () => {
    const f = fixture(),
      server = createNodeRequestServer(f.handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const sdk = new OpenAI({
        apiKey: 'fixture',
        maxRetries: 0,
        baseURL: `http://127.0.0.1:${address.port}${base}`,
      });
      const first = await sdk.chat.completions.create(
        input() as OpenAI.ChatCompletionCreateParamsNonStreaming,
      );
      assert.deepEqual(first.choices[0]?.message.tool_calls, calls);
      const second = await sdk.chat.completions.create(
        input({ messages: history }) as OpenAI.ChatCompletionCreateParamsNonStreaming,
      );
      assert.equal(second.choices[0]?.message.content, 'done');
      assert.equal(f.usage.length, 2);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

for (const base of ['/v1', '/api/v1'])
  test(`installed OpenRouter SDK completes Anthropic tool history and fresh provider Deny ${base}`, async () => {
    const options = { deny: false },
      f = fixture(options),
      server = createNodeRequestServer(f.handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const sdk = new OpenRouter({
        apiKey: 'fixture',
        retryConfig: { strategy: 'none' },
        serverURL: `http://127.0.0.1:${address.port}${base}`,
      });
      const first = await sdk.chat.send({
        chatRequest: {
          model: 'chat',
          messages: [{ role: 'user', content: 'private prompt' }],
          tools,
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
      assert.equal(f.usage.length, 2);
      options.deny = true;
      await assert.rejects(() => sdk.chat.send({ chatRequest: continuation }));
      assert.equal(f.keys(), 2);
      assert.equal(f.sent.length, 2);
      assert.doesNotMatch(JSON.stringify([f.usage, f.audits]), /private|fixture-provider-key/u);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
for (const nativeUsage of [undefined, { input_tokens: 3 }, { input_tokens: -1, output_tokens: 2 }])
  test('Anthropic tool responses preserve missing partial and invalid aggregate usage', async () => {
    const f = fixture({ body: { ...toolBody, usage: nativeUsage } });
    assert.equal((await f.handler(request('/v1'))).status, 200);
    assert.equal(
      f.usage[0]?.usage.status,
      nativeUsage === undefined
        ? 'missing'
        : nativeUsage.input_tokens === -1
          ? 'invalid'
          : 'partial',
    );
  });
