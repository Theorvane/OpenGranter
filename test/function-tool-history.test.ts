import assert from 'node:assert/strict';
import { test } from 'node:test';
import OpenAI from 'openai';
import { type ChatRequest, createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import { createOpenRouterChatInvoker } from '../src/providers/openrouter-chat.ts';

const kinds = ['openai', 'anthropic', 'google', 'openrouter'] as const;
type Kind = (typeof kinds)[number];
function body(kind: Kind) {
  if (kind === 'anthropic')
    return {
      id: 'completion',
      content: [{ type: 'text', text: 'reply' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 2, output_tokens: 1 },
    };
  if (kind === 'google')
    return {
      responseId: 'completion',
      candidates: [{ content: { parts: [{ text: 'reply' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 },
    };
  return {
    id: 'completion',
    created: 1,
    model: 'model',
    choices: [
      { index: 0, message: { role: 'assistant', content: 'reply' }, finish_reason: 'stop' },
    ],
    usage: { prompt_tokens: 2, completion_tokens: 1 },
  };
}
function adapter(
  kind: Kind,
  cap?: number,
  mutate?: () => void,
  transportFails = false,
  responses?: readonly object[],
) {
  const sent: Record<string, unknown>[] = [];
  let secrets = 0;
  const resolveSecret = async () => {
    secrets++;
    mutate?.();
    return 'fixture-key';
  };
  const fetcher: typeof fetch = async (_, init) => {
    sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return transportFails
      ? new Response('private fixture upstream error', { status: 400 })
      : Response.json(responses?.[sent.length - 1] ?? body(kind));
  };
  const candidate = {
    id: 'candidate',
    kind: kind === 'openrouter' ? ('delegated' as const) : ('managed' as const),
    providerId: 'provider',
    upstreamModelId: 'model',
  };
  const invoke =
    kind === 'openrouter'
      ? createOpenRouterChatInvoker({ credentialRef: 'secret/reference', resolveSecret, fetcher })
      : createDirectChatInvoker({
          registrations: [
            {
              providerId: 'provider',
              kind,
              credentialRef: 'secret/reference',
              ...(cap !== undefined || kind === 'anthropic' ? { maxOutputTokens: cap ?? 128 } : {}),
            },
          ],
          resolveSecret,
          fetcher,
        });
  return {
    candidate,
    sent,
    secrets: () => secrets,
    call: (request: ChatRequest) =>
      kind === 'openrouter'
        ? (invoke as ReturnType<typeof createOpenRouterChatInvoker>)(
            { upstreamModelId: 'model', authorizedProviderSlugs: ['provider'] },
            request,
          )
        : (invoke as ReturnType<typeof createDirectChatInvoker>)(candidate, request),
  };
}
function httpFixture(
  kind: Kind,
  options: {
    deny?: boolean;
    explicitDeny?: boolean;
    limit?: boolean;
    audit?: boolean;
    fail?: boolean;
    mutate?: () => void;
    responses?: readonly object[];
  } = {},
) {
  const f = adapter(kind, undefined, options.mutate, options.fail, options.responses);
  const audits: unknown[] = [];
  const usage: unknown[] = [];
  let routes = 0;
  const handler = createChatHandler({
    newRequestId: () => 'request',
    authenticate: async () => ({
      id: 'user',
      active: true,
      credentialId: 'credential',
      policyVersions: [],
      statements: options.deny
        ? []
        : [
            { effect: 'Allow', actions: ['*'], resources: ['*'] },
            ...(options.explicitDeny
              ? [{ effect: 'Deny' as const, actions: ['*'], resources: ['*'] }]
              : []),
          ],
    }),
    resolveRoute: async () => {
      routes++;
      return kind === 'openrouter'
        ? {
            kind: 'delegated',
            version: 'v1',
            credentialRef: 'secret/reference',
            candidates: [f.candidate],
          }
        : { version: 'v1', candidates: [f.candidate] };
    },
    checkLimit: async () => !options.limit,
    resolveSecret: async () => 'unused',
    writeAudit: async (event) => {
      if (options.audit) throw new Error('private fixture');
      audits.push(event);
    },
    writeUsage: async (record) => {
      usage.push(record);
    },
    invokeDirect: async (_, chat) => f.call(chat),
    invokeOpenRouter: async (_, __, chat) => f.call(chat),
    resolveVerifiedProviderSlug: async () => 'provider',
  });
  return { ...f, handler, audits, usage, routes: () => routes };
}
function input(fields: Record<string, unknown> = {}) {
  return {
    model: 'chat',
    messages: [{ role: 'user', content: 'private prompt' }],
    max_tokens: 17,
    temperature: 0.4,
    top_p: 0.7,
    n: 1,
    stop: ['marker'],
    response_format: { type: 'text' },
    ...fields,
  };
}
function request(path: string, fields: Record<string, unknown> = {}) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    body: JSON.stringify(input(fields)),
  });
}
const history = [
  { role: 'user', content: 'private prompt' },
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call_one',
        type: 'function',
        function: { name: 'lookup', arguments: '{"query":"private value"}' },
      },
      { id: 'call_two', type: 'function', function: { name: 'summarize', arguments: '{}' } },
    ],
  },
  {
    role: 'tool',
    tool_call_id: 'call_two',
    content: [{ type: 'text', text: 'private result two' }],
  },
  { role: 'tool', tool_call_id: 'call_one', content: 'private result one' },
];
test('assistant tool-call history may omit content and normalizes it to null', async () => {
  const messages = [
    history[0],
    { role: 'assistant', tool_calls: history[1]?.tool_calls },
    history[2],
    history[3],
  ];
  for (const kind of ['openai', 'openrouter'] as const) {
    const f = httpFixture(kind);
    const response = await f.handler(request('/api/v1/chat/completions', { messages }));
    assert.equal(response.status, 200);
    const forwarded = f.sent[0]?.messages as readonly { content: string | null }[] | undefined;
    assert.ok(forwarded);
    assert.equal(forwarded[1]?.content, null);
  }
});
test('an empty assistant tool-call list preserves ordinary text history', async () => {
  for (const kind of ['openai', 'openrouter'] as const) {
    const f = httpFixture(kind);
    const response = await f.handler(
      request('/api/v1/chat/completions', {
        messages: [
          { role: 'user', content: 'private prompt' },
          { role: 'assistant', content: 'private text', tool_calls: [] },
          { role: 'user', content: 'continue' },
        ],
      }),
    );
    assert.equal(response.status, 200);
    const forwarded = f.sent[0]?.messages as readonly { tool_calls?: unknown[] }[] | undefined;
    assert.ok(forwarded);
    assert.deepEqual(forwarded[1]?.tool_calls, []);
  }
});
for (const kind of kinds) {
  test(`${kind}: complete tool history crosses both HTTP paths`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      const f = httpFixture(kind);
      const response = await f.handler(request(path, { messages: history }));
      const supported = kind !== 'google';
      assert.equal(response.status, supported ? 200 : 502);
      assert.equal(f.secrets(), supported ? 1 : 0);
      assert.equal(f.sent.length, supported ? 1 : 0);
      if (supported) {
        assert.deepEqual(
          f.sent[0]?.messages,
          kind === 'anthropic'
            ? [
                history[0],
                {
                  role: 'assistant',
                  content: [
                    {
                      type: 'tool_use',
                      id: 'call_one',
                      name: 'lookup',
                      input: { query: 'private value' },
                    },
                    { type: 'tool_use', id: 'call_two', name: 'summarize', input: {} },
                  ],
                },
                {
                  role: 'user',
                  content: [
                    { type: 'tool_result', tool_use_id: 'call_two', content: 'private result two' },
                    { type: 'tool_result', tool_use_id: 'call_one', content: 'private result one' },
                  ],
                },
              ]
            : [
                ...history.slice(0, 2),
                { role: 'tool', tool_call_id: 'call_two', content: 'private result two' },
                history[3],
              ],
        );
        assert.equal(f.usage.length, 1);
      }
      assert.doesNotMatch(
        JSON.stringify([f.audits, f.usage]),
        /private value|private result|private prompt|fixture-key/u,
      );
    }
  });
  test(`${kind}: malformed histories reject before HTTP routing and native secrets`, async () => {
    for (const messages of [
      [
        ...history.slice(0, 2),
        { role: 'tool', tool_call_id: 'missing', content: 'private result' },
      ],
      [...history.slice(0, 2), history[2], history[2], history[3]],
      [...history.slice(0, 2), history[2]],
      [
        ...history.slice(0, 2),
        { role: 'user', content: 'private interrupt' },
        history[2],
        history[3],
      ],
      [{ role: 'tool', tool_call_id: 'call_one', content: 'private orphan' }],
      [
        { role: 'user', content: 'private prompt' },
        {
          ...history[1],
          tool_calls: [
            { id: 'same', type: 'function', function: { name: 'a', arguments: '{}' } },
            { id: 'same', type: 'function', function: { name: 'b', arguments: '{}' } },
          ],
        },
        ...history.slice(2),
      ],
    ]) {
      const f = httpFixture(kind);
      const response = await f.handler(request('/api/v1/chat/completions', { messages }));
      assert.equal(response.status, 400);
      assert.equal(f.routes(), 0);
      assert.equal(f.secrets(), 0);
      const native = adapter(kind);
      await assert.rejects(() => native.call(input({ messages }) as unknown as ChatRequest));
      assert.equal(native.secrets(), 0);
    }
  });
}
test('installed SDK carries function history across both compatible bases', async () => {
  for (const kind of ['openai', 'openrouter'] as const) {
    const f = httpFixture(kind);
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
          input({ messages: history }) as OpenAI.ChatCompletionCreateParamsNonStreaming,
        );
        assert.equal(result.choices[0]?.message.content, 'reply');
        const forwarded = f.sent.at(-1)?.messages as typeof history | undefined;
        assert.ok(forwarded);
        assert.deepEqual(forwarded[1]?.tool_calls, history[1]?.tool_calls);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
});
test('installed SDK completes a non-streaming function call round trip on both routes', async () => {
  for (const kind of ['openai', 'openrouter'] as const) {
    const upstreamCall = {
      id: 'call_one',
      type: 'function',
      function: { name: 'lookup', arguments: '{"query":"private value"}' },
    };
    const firstResponse = {
      id: 'first',
      created: 1,
      model: 'model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: null, tool_calls: [upstreamCall] },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 1 },
    };
    const f = httpFixture(kind, { responses: [firstResponse, body(kind)] });
    const server = createNodeRequestServer(f.handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      for (const base of ['/v1', '/api/v1']) {
        f.sent.length = 0;
        const sdk = new OpenAI({
          apiKey: 'fixture',
          baseURL: `http://127.0.0.1:${address.port}${base}`,
          maxRetries: 0,
        });
        const tools = [
          {
            type: 'function' as const,
            function: { name: 'lookup', parameters: { type: 'object' } },
          },
        ];
        const first = await sdk.chat.completions.create({
          model: 'chat',
          messages: [{ role: 'user', content: 'private prompt' }],
          tools,
        });
        assert.equal(first.choices[0]?.finish_reason, 'tool_calls');
        assert.deepEqual(first.choices[0]?.message.tool_calls, [upstreamCall]);
        const second = await sdk.chat.completions.create({
          model: 'chat',
          tools,
          messages: [
            { role: 'user', content: 'private prompt' },
            {
              role: 'assistant',
              content: first.choices[0]?.message.content ?? null,
              tool_calls: first.choices[0]?.message
                .tool_calls as OpenAI.ChatCompletionMessageToolCall[],
            },
            { role: 'tool', tool_call_id: upstreamCall.id, content: 'private result' },
          ],
        });
        assert.equal(second.choices[0]?.message.content, 'reply');
        const forwarded = f.sent[1]?.messages as typeof history | undefined;
        assert.ok(forwarded);
        assert.equal(forwarded[2]?.tool_call_id, upstreamCall.id);
        assert.equal(f.usage.length, base === '/v1' ? 2 : 4);
        assert.doesNotMatch(
          JSON.stringify([f.audits, f.usage]),
          /private value|private result|private prompt|fixture-key/u,
        );
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
});
test('native assistant call history snapshots arguments before secret await', async () => {
  for (const kind of ['openai', 'openrouter'] as const) {
    const messages = structuredClone([
      ...history.slice(0, 2),
      { role: 'tool', tool_call_id: 'call_two', content: 'private result two' },
      history[3],
    ]);
    const f = adapter(kind, undefined, () => {
      const calls = (messages[1] as { tool_calls: { function: { arguments: string } }[] })
        .tool_calls;
      assert.ok(calls[0]);
      calls[0].function.arguments = 'changed';
    });
    await f.call(input({ messages }) as unknown as ChatRequest);
    const forwarded = f.sent[0]?.messages as
      | readonly { tool_calls?: readonly { function: { arguments: string } }[] }[]
      | undefined;
    assert.ok(forwarded);
    assert.equal(forwarded[1]?.tool_calls?.[0]?.function.arguments, '{"query":"private value"}');
  }
});
test('tool history preserves shared IAM gates and safe failed-attempt accounting', async () => {
  for (const kind of ['openai', 'openrouter'] as const) {
    for (const [options, status] of [
      [{ deny: true }, 403],
      [{ explicitDeny: true }, 403],
      [{ limit: true }, 429],
      [{ audit: true }, 503],
    ] as const) {
      const f = httpFixture(kind, options);
      const response = await f.handler(request('/v1/chat/completions', { messages: history }));
      assert.equal(response.status, status);
      assert.equal(f.secrets(), 0);
    }
    const f = httpFixture(kind, { fail: true });
    const response = await f.handler(request('/v1/chat/completions', { messages: history }));
    assert.equal(response.status, 502);
    assert.equal((f.usage[0] as { possiblyBilled: boolean }).possiblyBilled, true);
    assert.doesNotMatch(
      JSON.stringify([f.audits, f.usage, await response.text()]),
      /private value|private result|private prompt|fixture-key/u,
    );
  }
});
test('direct and delegated invokers forward matched single-captured function history before credential mutation', async () => {
  for (const kind of ['openai', 'openrouter'] as const) {
    let argumentsReads = 0;
    let resultReads = 0;
    const operation = Object.defineProperty({ name: 'lookup' }, 'arguments', {
      enumerable: true,
      get: () => {
        argumentsReads++;
        return argumentsReads === 1 ? 'private original' : 42;
      },
    });
    const result = Object.defineProperty(
      { role: 'tool', content: 'private result' },
      'tool_call_id',
      {
        enumerable: true,
        get: () => {
          resultReads++;
          return resultReads <= 2 ? 'call' : 'different';
        },
      },
    );
    const messages = [
      { role: 'assistant', tool_calls: [{ id: 'call', type: 'function', function: operation }] },
      result,
    ];
    const f = adapter(kind, undefined, () => {
      operation.name = 'changed';
    });
    await f.call(input({ messages }) as unknown as ChatRequest);
    assert.equal(argumentsReads, 1);
    assert.equal(resultReads, 1);
    assert.deepEqual(f.sent[0]?.messages, [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call',
            type: 'function',
            function: { name: 'lookup', arguments: 'private original' },
          },
        ],
      },
      { role: 'tool', content: 'private result', tool_call_id: 'call' },
    ]);
    assert.equal(f.secrets(), 1);
  }
});
test('malformed first function captures and throwing accessors fail safely before native credentials', async () => {
  for (const kind of kinds)
    for (const throwing of [false, true]) {
      let reads = 0;
      const operation = Object.defineProperty({ name: 'lookup' }, 'arguments', {
        enumerable: true,
        get: () => {
          reads++;
          if (throwing) throw new Error('private accessor fixture-key');
          return reads === 1 ? 42 : '{}';
        },
      });
      const messages = [
        { role: 'assistant', tool_calls: [{ id: 'call', type: 'function', function: operation }] },
        { role: 'tool', content: 'private result', tool_call_id: 'call' },
      ];
      const f = adapter(kind);
      await assert.rejects(
        () => f.call(input({ messages }) as unknown as ChatRequest),
        (error: unknown) => {
          assert.doesNotMatch(JSON.stringify(error), /private|fixture-key/u);
          assert.doesNotMatch(error instanceof Error ? error.message : '', /private|fixture-key/u);
          return true;
        },
      );
      assert.equal(reads, 1);
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
    }
});
