import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import { type ChatRequest, createChatHandler } from '../src/gateway/chat-handler.ts';
import { snapshotChatMessages } from '../src/gateway/chat-messages.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import { createOpenRouterChatInvoker } from '../src/providers/openrouter-chat.ts';
import { createOpenRouterTextStreamInvoker } from '../src/providers/openrouter-stream.ts';

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
    system_fingerprint: 'fp_fixture',
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
    if (!transportFails && sent.at(-1)?.stream) {
      const chunk = (delta: object, finish_reason: string | null, extra: object = {}) =>
        'data: ' +
        JSON.stringify({
          id: 'gen',
          created: 1,
          object: 'chat.completion.chunk',
          model: 'model',
          system_fingerprint: 'fp_fixture',
          choices: [{ index: 0, delta, finish_reason }],
          ...extra,
        }) +
        '\n\n';
      return new Response(
        chunk({ content: 'reply' }, null) +
          chunk({}, 'stop') +
          chunk({}, 'stop', { usage: { prompt_tokens: 2, completion_tokens: 1 } }) +
          'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }
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
    stream: createOpenRouterTextStreamInvoker({
      credentialRef: 'secret/reference',
      resolveSecret,
      fetcher,
    }),
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
    auth?: boolean;
    usageFail?: boolean;
    outcomeFail?: boolean;
    deny?: boolean;
    explicitDeny?: boolean;
    denyAction?: 'llm:InvokeModel' | 'llm:UseProvider';
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
    authenticate: async () =>
      options.auth
        ? undefined
        : {
            id: 'user',
            active: true,
            credentialId: 'credential',
            policyVersions: [],
            statements: options.deny
              ? []
              : [
                  { effect: 'Allow', actions: ['*'], resources: ['*'] },
                  ...(options.explicitDeny || options.denyAction
                    ? [
                        {
                          effect: 'Deny' as const,
                          actions: [options.denyAction ?? '*'],
                          resources: ['*'],
                        },
                      ]
                    : []),
                ],
          },
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
      if (options.outcomeFail && event.kind === 'delegated-attempt')
        throw new Error('private history audit');
      if (options.audit) throw new Error('private fixture');
      audits.push(event);
    },
    writeUsage: async (record) => {
      if (options.usageFail) throw new Error('private history usage');
      usage.push(record);
    },
    invokeOpenRouterTextStream: (_ref, ...args) => f.stream(...args),
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

const reasoning = 'private reasoning 思考\n\ndata: forged';
const calls = [{ id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } }];
function messages(message: object) {
  return [
    { role: 'user', content: 'private prompt' },
    { role: 'assistant', ...message },
    { role: 'user', content: 'continue' },
  ];
}
function safe(f: ReturnType<typeof httpFixture>) {
  assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private|fixture-key|forged/u);
}
test('delegated assistant scalar reasoning history preserves omission null empty and Unicode on both prefixes', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const value of [undefined, null, '', reasoning]) {
      const history = messages({
        content: 'private answer',
        ...(value === undefined ? {} : { reasoning: value }),
      });
      const f = httpFixture('openrouter');
      const response = await f.handler(request(path, { messages: history }));
      assert.equal(response.status, 200);
      assert.deepEqual(f.sent[0]?.messages, history);
      assert.equal(f.usage.length, 1);
      safe(f);
    }
});
test('delegated reasoning-only and text-part assistant history retain exact reasoning and normalized content', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const content of [
      undefined,
      null,
      [
        { type: 'text', text: 'private ' },
        { type: 'text', text: 'answer' },
      ],
    ]) {
      const history = messages({ ...(content === undefined ? {} : { content }), reasoning });
      const f = httpFixture('openrouter');
      const response = await f.handler(request(path, { messages: history }));
      assert.equal(response.status, 200);
      assert.deepEqual((f.sent[0]?.messages as unknown[] | undefined)?.[1], {
        role: 'assistant',
        content: Array.isArray(content) ? 'private answer' : null,
        reasoning,
      });
      safe(f);
    }
});
test('delegated scalar reasoning preserves complete function history without executing or bypassing pending results', async () => {
  const history = [
    { role: 'user', content: 'private prompt' },
    { role: 'assistant', reasoning, tool_calls: calls },
    { role: 'tool', tool_call_id: 'call', content: 'private result' },
  ];
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const f = httpFixture('openrouter');
    assert.equal((await f.handler(request(path, { messages: history }))).status, 200);
    assert.deepEqual((f.sent[0]?.messages as unknown[] | undefined)?.[1], {
      role: 'assistant',
      content: null,
      reasoning,
      tool_calls: calls,
    });
    safe(f);
    for (const bad of [
      history.slice(0, 2),
      [history[0], history[1], { role: 'user', content: 'interrupt' }, history[2]],
    ]) {
      const denied = httpFixture('openrouter');
      assert.equal((await denied.handler(request(path, { messages: bad }))).status, 400);
      assert.equal(denied.routes(), 0);
      assert.equal(denied.secrets(), 0);
    }
  }
});
test('invalid reasoning history fails before routing or credentials without content disclosure', async () => {
  const invalid = [
    ...[true, 42, [], {}].map((reasoning) => messages({ content: 'private answer', reasoning })),
    ...[null, ''].map((reasoning) => messages({ content: null, reasoning })),
    ...['user', 'system', 'developer', 'tool'].map((role) => [
      { role, content: 'private prompt', reasoning },
    ]),
    messages({ content: null }),
    messages({ content: false, reasoning }),
  ];
  for (const history of invalid) {
    const f = httpFixture('openrouter');
    const response = await f.handler(request('/api/v1/chat/completions', { messages: history }));
    assert.equal(response.status, 400);
    assert.equal(f.routes(), 0);
    assert.equal(f.secrets(), 0);
    assert.doesNotMatch(await response.text(), /private/u);
    safe(f);
  }
  const f = adapter('openrouter');
  await assert.rejects(() =>
    f.call(
      input({
        messages: messages({ content: 'private answer', reasoning: undefined }),
      }) as unknown as ChatRequest,
    ),
  );
  assert.equal(f.secrets(), 0);
});
test('unsupported direct adapters reject every supplied history reasoning marker before secrets', async () => {
  for (const kind of ['openai', 'anthropic', 'google'] as const)
    for (const value of [null, '', reasoning]) {
      const f = httpFixture(kind);
      const response = await f.handler(
        request('/api/v1/chat/completions', {
          messages: messages({ content: 'private answer', reasoning: value }),
        }),
      );
      assert.equal(response.status, 502);
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
      assert.equal(f.usage.length, 0);
      safe(f);
    }
});
test('history snapshots capture scalar getters once and resist secret-await mutation', async () => {
  let reads = 0;
  const captured = snapshotChatMessages([
    { role: 'user', content: 'private prompt' },
    Object.defineProperty({ role: 'assistant', content: null }, 'reasoning', {
      enumerable: true,
      get: () => {
        reads++;
        return reads === 1 ? reasoning : true;
      },
    }),
  ]);
  assert.equal(reads, 1);
  assert.equal(captured[1]?.reasoning, reasoning);
  assert.ok(Object.isFrozen(captured));
  assert.ok(Object.isFrozen(captured[1]));
  for (const http of [false, true]) {
    const assistant = { role: 'assistant', content: null, reasoning };
    const history = [{ role: 'user', content: 'private prompt' }, assistant];
    const mutate = () => {
      assistant.reasoning = 'changed';
    };
    if (http) {
      const f = httpFixture('openrouter', { mutate });
      const req = request('/api/v1/chat/completions', { messages: history });
      Object.defineProperty(req, 'json', { value: async () => input({ messages: history }) });
      assert.equal((await f.handler(req)).status, 200);
      assert.equal(
        (f.sent[0]?.messages as readonly Record<string, unknown>[] | undefined)?.[1]?.reasoning,
        reasoning,
      );
    } else {
      const f = adapter('openrouter', undefined, mutate);
      await f.call(input({ messages: history }) as unknown as ChatRequest);
      assert.equal(
        (f.sent[0]?.messages as readonly Record<string, unknown>[] | undefined)?.[1]?.reasoning,
        reasoning,
      );
    }
  }
});
test('reasoning history retains auth Deny limits persistence and possibly-billed failure accounting', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const [options, status, dispatched] of [
      [{ auth: true }, 401, false],
      [{ deny: true }, 403, false],
      [{ explicitDeny: true }, 403, false],
      [{ denyAction: 'llm:InvokeModel' }, 403, false],
      [{ denyAction: 'llm:UseProvider' }, 403, false],
      [{ limit: true }, 429, false],
      [{ audit: true }, 503, false],
      [{ usageFail: true }, 503, true],
      [{ outcomeFail: true }, 503, true],
      [{ fail: true }, 502, true],
    ] as const) {
      const f = httpFixture('openrouter', options);
      const response = await f.handler(
        request(path, { messages: messages({ content: null, reasoning }) }),
      );
      assert.equal(response.status, status);
      assert.equal(f.secrets(), dispatched ? 1 : 0);
      assert.equal(f.sent.length, dispatched ? 1 : 0);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
      safe(f);
      if ('fail' in options) {
        assert.equal(f.usage.length, 1);
        assert.equal(
          (f.usage[0] as { possiblyBilled: boolean; outcome: string }).possiblyBilled,
          true,
        );
        assert.equal((f.usage[0] as { outcome: string }).outcome, 'failed');
      }
      if ('outcomeFail' in options) {
        assert.equal(f.usage.length, 1);
        assert.equal((f.usage[0] as { outcome: string }).outcome, 'succeeded');
      }
    }
});
test('official OpenRouter SDK continues scalar reasoning history across both bases and delegated streams', async () => {
  const f = httpFixture('openrouter');
  const server = createNodeRequestServer(f.handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    for (const base of ['/v1', '/api/v1']) {
      const sdk = new OpenRouter({
        apiKey: 'fixture',
        serverURL: `http://127.0.0.1:${address.port}${base}`,
        retryConfig: { strategy: 'none' },
        timeoutMs: 3000,
      });
      for (const stream of [false, true]) {
        const result = await sdk.chat.send({
          chatRequest: {
            model: 'chat',
            messages: [
              { role: 'user', content: 'private prompt' },
              { role: 'assistant', content: null, reasoning },
              { role: 'user', content: 'continue' },
            ],
            stream,
          },
        });
        if (stream) {
          assert.ok(Symbol.asyncIterator in result);
          let reply = '';
          let usage = 0;
          for await (const event of result) {
            reply += event.choices[0]?.delta.content ?? '';
            if (event.usage) usage++;
          }
          assert.equal(reply, 'reply');
          assert.equal(usage, 1);
        } else {
          assert.ok('choices' in result);
          assert.equal(result.choices[0]?.message.content, 'reply');
        }
        assert.deepEqual((f.sent.at(-1)?.messages as unknown[] | undefined)?.[1], {
          role: 'assistant',
          content: null,
          reasoning,
        });
      }
    }
    assert.equal(f.usage.length, 4);
    safe(f);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
