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

function history(fields: object = {}) {
  return [
    { role: 'user', content: 'private prompt' },
    { role: 'assistant', ...fields },
    { role: 'user', content: 'continue' },
  ];
}
function safe(f: ReturnType<typeof httpFixture>) {
  assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private|fixture-key/u);
}
test('delegated no-text assistant history normalizes omission and preserves empty metadata', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const fields of [
      {},
      { content: null },
      { reasoning: null },
      { reasoning: '' },
      { reasoning_details: [] },
      { reasoning_details: [{ type: 'reasoning.text', signature: 'private signature' }] },
      { tool_calls: [] },
    ]) {
      const f = httpFixture('openrouter');
      assert.equal((await f.handler(request(path, { messages: history(fields) }))).status, 200);
      assert.deepEqual((f.sent[0]?.messages as unknown[])?.[1], {
        role: 'assistant',
        content: null,
        ...fields,
      });
      assert.equal(f.usage.length, 1);
      safe(f);
    }
});
test('direct providers reject bare no-text histories before secrets while delegated snapshots resist mutation', async () => {
  for (const kind of ['openai', 'anthropic', 'google'] as const)
    for (const fields of [{}, { content: null }, { content: null, tool_calls: [] }]) {
      const f = adapter(kind);
      await assert.rejects(() =>
        f.call(input({ messages: history(fields) }) as unknown as ChatRequest),
      );
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
      const h = httpFixture(kind);
      assert.equal(
        (await h.handler(request('/v1/chat/completions', { messages: history(fields) }))).status,
        502,
      );
      assert.equal(h.secrets(), 0);
      safe(h);
    }
  const message: { role: string; content: null | string } = { role: 'assistant', content: null };
  const f = httpFixture('openrouter', {
    mutate: () => {
      message.content = 'private late';
    },
  });
  const captured = snapshotChatMessages([{ role: 'user', content: 'private' }, message]);
  await f.call(input({ messages: captured }) as unknown as ChatRequest);
  assert.equal((f.sent[0]?.messages as { content: unknown }[] | undefined)?.[1]?.content, null);
});
test('no-text history preserves non-assistant field and tool-result integrity rejection', async () => {
  const call = { id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } };
  for (const messages of [
    ...['user', 'system', 'developer', 'tool'].map((role) => [{ role, content: null }]),
    history({ content: 42 }),
    history({ refusal: 42 }),
    history({ reasoning: 42 }),
    [{ role: 'assistant', tool_calls: [call] }],
    [
      { role: 'assistant', tool_calls: [call] },
      { role: 'assistant', content: null },
    ],
    [
      { role: 'assistant', content: null },
      { role: 'tool', tool_call_id: 'call', content: 'private' },
    ],
  ]) {
    const f = httpFixture('openrouter');
    assert.equal((await f.handler(request('/v1/chat/completions', { messages }))).status, 400);
    assert.equal(f.routes(), 0);
    assert.equal(f.secrets(), 0);
    safe(f);
  }
});
test('no-text histories retain auth policy limits and required persistence gates', async () => {
  for (const stream of [false, true])
    for (const [options, status] of [
      [{ auth: true }, 401],
      [{ deny: true }, 403],
      [{ explicitDeny: true }, 403],
      [{ denyAction: 'llm:InvokeModel' }, 403],
      [{ denyAction: 'llm:UseProvider' }, 403],
      [{ limit: true }, 429],
      [{ audit: true }, 503],
      [{ fail: true }, 502],
      [{ usageFail: true }, 503],
      [{ outcomeFail: true }, 503],
    ] as const) {
      const f = httpFixture('openrouter', options);
      const response = await f.handler(
        request('/api/v1/chat/completions', { messages: history({ content: null }), stream }),
      );
      if (stream && (options.usageFail || options.outcomeFail)) {
        assert.equal(response.status, 200);
        assert.match(await response.text(), /error/u);
      } else assert.equal(response.status, status);
      if (!options.fail && !options.usageFail && !options.outcomeFail) assert.equal(f.secrets(), 0);
      if (options.fail) assert.equal(f.usage.length, 1);
      safe(f);
    }
});
test('actual OpenRouter SDK replays omitted and null histories on both bases and ordinary streams', async () => {
  const f = httpFixture('openrouter');
  const server = createNodeRequestServer(f.handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    for (const base of ['/v1', '/api/v1'])
      for (const stream of [false, true])
        for (const content of [undefined, null]) {
          const sdk = new OpenRouter({
            apiKey: 'fixture',
            serverURL: `http://127.0.0.1:${address.port}${base}`,
            retryConfig: { strategy: 'none' },
            timeoutMs: 3000,
          });
          const result = await sdk.chat.send({
            chatRequest: {
              model: 'chat',
              messages: [
                { role: 'user', content: 'private' },
                { role: 'assistant', ...(content === undefined ? {} : { content }) },
                { role: 'user', content: 'continue' },
              ],
              stream,
            },
          });
          if (stream) {
            assert.ok(Symbol.asyncIterator in result);
            let text = '';
            for await (const event of result) text += event.choices[0]?.delta.content ?? '';
            assert.equal(text, 'reply');
          } else {
            assert.ok('choices' in result);
            assert.equal(result.choices[0]?.message.content, 'reply');
          }
          assert.deepEqual((f.sent.at(-1)?.messages as unknown[] | undefined)?.[1], {
            role: 'assistant',
            content: null,
          });
        }
    assert.equal(f.usage.length, 8);
    safe(f);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
test('no-text history does not infer missing usage or enable empty-call streams', async () => {
  const responseBody = body('openrouter');
  const { usage: _usage, ...missing } = responseBody as Record<string, unknown>;
  const f = httpFixture('openrouter', { responses: [missing] });
  assert.equal(
    (await f.handler(request('/v1/chat/completions', { messages: history() }))).status,
    200,
  );
  assert.equal(
    (f.usage[0] as { usage: { status: string }; totalTokens: unknown }).usage.status,
    'missing',
  );
  assert.equal((f.usage[0] as { usage: { totalTokens: unknown } }).usage.totalTokens, null);
  safe(f);
  const denied = httpFixture('openrouter');
  assert.equal(
    (
      await denied.handler(
        request('/v1/chat/completions', { messages: history({ tool_calls: [] }), stream: true }),
      )
    ).status,
    400,
  );
  assert.equal(denied.routes(), 0);
  assert.equal(denied.secrets(), 0);
});
