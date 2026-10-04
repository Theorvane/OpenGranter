import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
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
      if (options.outcomeFail && (event.kind === 'delegated-attempt' || event.kind === 'attempt'))
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
const refusal = 'private refusal 拒否\n\ndata: forged';
const calls = [{ id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } }];
test('assistant refusal histories preserve nullable empty and Unicode fields on both routes and bases', async () => {
  for (const kind of ['openai', 'openrouter'] as const)
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
      for (const value of [null, '', refusal])
        for (const content of [undefined, null, 'private text']) {
          const f = httpFixture(kind);
          const fields = { ...(content === undefined ? {} : { content }), refusal: value };
          assert.equal((await f.handler(request(path, { messages: history(fields) }))).status, 200);
          assert.deepEqual((f.sent[0]?.messages as unknown[] | undefined)?.[1], {
            role: 'assistant',
            content: content ?? null,
            refusal: value,
          });
          safe(f);
        }
});
test('refusal retains complete tool groups and rejects incomplete or non-assistant history', async () => {
  for (const kind of ['openai', 'openrouter'] as const) {
    const messages = [
      { role: 'user', content: 'private' },
      { role: 'assistant', refusal, tool_calls: calls },
      { role: 'tool', tool_call_id: 'call', content: 'private result' },
    ];
    const f = httpFixture(kind);
    assert.equal((await f.handler(request('/v1/chat/completions', { messages }))).status, 200);
    assert.deepEqual((f.sent[0]?.messages as unknown[] | undefined)?.[1], {
      role: 'assistant',
      content: null,
      refusal,
      tool_calls: calls,
    });
    safe(f);
    for (const bad of [
      messages.slice(0, 2),
      [messages[0], messages[1], { role: 'assistant', content: null, refusal }],
    ]) {
      const denied = httpFixture(kind);
      assert.equal(
        (await denied.handler(request('/v1/chat/completions', { messages: bad }))).status,
        400,
      );
      assert.equal(denied.routes(), 0);
      assert.equal(denied.secrets(), 0);
    }
    for (const value of [1, true, {}, []]) {
      const bad = httpFixture(kind);
      assert.equal(
        (
          await bad.handler(
            request('/v1/chat/completions', {
              messages: history({ content: 'private', refusal: value }),
            }),
          )
        ).status,
        400,
      );
      assert.equal(bad.routes(), 0);
    }
    for (const role of ['system', 'developer', 'user', 'tool']) {
      const bad = httpFixture(kind);
      assert.equal(
        (
          await bad.handler(
            request('/v1/chat/completions', { messages: [{ role, content: 'private', refusal }] }),
          )
        ).status,
        400,
      );
      assert.equal(bad.secrets(), 0);
    }
  }
});
test('refusal history captures getters once and remains immutable during credentials', async () => {
  for (const kind of ['openai', 'openrouter'] as const) {
    let reads = 0;
    const message = Object.defineProperty({ role: 'assistant', content: 'private' }, 'refusal', {
      enumerable: true,
      get: () => {
        reads++;
        return reads === 1 ? refusal : 42;
      },
    });
    const f = adapter(kind);
    await f.call(input({ messages: [message] }) as unknown as ChatRequest);
    assert.equal(reads, 1);
    assert.equal((f.sent[0]?.messages as { refusal: string }[] | undefined)?.[0]?.refusal, refusal);
    const mutable = { role: 'assistant', content: null, refusal };
    const captured = snapshotChatMessages([mutable]);
    const late = adapter(kind, undefined, () => {
      mutable.refusal = 'private late';
    });
    await late.call(input({ messages: captured }) as unknown as ChatRequest);
    assert.equal(
      (late.sent[0]?.messages as { refusal: string }[] | undefined)?.[0]?.refusal,
      refusal,
    );
    for (const marker of [
      { refusal: undefined },
      Object.defineProperty({}, 'refusal', {
        enumerable: true,
        get: () => {
          throw Error('private');
        },
      }),
    ]) {
      const failed = adapter(kind);
      await assert.rejects(() =>
        failed.call(
          input({
            messages: [
              Object.defineProperties(
                { role: 'assistant', content: 'private' },
                Object.getOwnPropertyDescriptors(marker),
              ),
            ],
          }) as unknown as ChatRequest,
        ),
      );
      assert.equal(failed.secrets(), 0);
    }
  }
});
test('unsupported native refusal histories reject before credentials including null and visible content', async () => {
  for (const kind of ['anthropic', 'google'] as const)
    for (const value of [null, '', refusal]) {
      const f = httpFixture(kind);
      assert.equal(
        (
          await f.handler(
            request('/api/v1/chat/completions', {
              messages: history({ content: 'private', refusal: value }),
            }),
          )
        ).status,
        502,
      );
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
      safe(f);
    }
});
test('refusal histories retain auth IAM limits persistence privacy and failure accounting', async () => {
  for (const kind of ['openai', 'openrouter'] as const)
    for (const [options, status] of [
      [{ auth: true }, 401],
      [{ deny: true }, 403],
      [{ explicitDeny: true }, 403],
      [{ denyAction: 'llm:InvokeModel' }, 403],
      [{ denyAction: 'llm:UseProvider' }, 403],
      [{ limit: true }, 429],
      [{ audit: true }, 503],
      [{ usageFail: true }, 503],
      [{ outcomeFail: true }, 503],
      [{ fail: true }, 502],
    ] as const) {
      const f = httpFixture(kind, options);
      const response = await f.handler(
        request('/api/v1/chat/completions', { messages: history({ content: null, refusal }) }),
      );
      assert.equal(response.status, status);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
      if (!options.fail && !options.usageFail && !options.outcomeFail) assert.equal(f.secrets(), 0);
      if (options.fail) assert.equal(f.usage.length, 1);
      safe(f);
    }
});
test('actual OpenAI and OpenRouter SDK sockets replay refusal histories through both bases', async () => {
  for (const kind of ['openai', 'openrouter'] as const) {
    const f = httpFixture(kind);
    const server = createNodeRequestServer(f.handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    try {
      for (const base of ['/v1', '/api/v1'])
        for (const value of [null, '', refusal]) {
          const url = `http://127.0.0.1:${address.port}${base}`;
          if (kind === 'openai') {
            const sdk = new OpenAI({ apiKey: 'fixture', baseURL: url, maxRetries: 0 });
            const result = await sdk.chat.completions.create({
              model: 'chat',
              messages: [{ role: 'assistant', content: null, refusal: value }],
            });
            assert.equal(result.choices[0]?.message.content, 'reply');
          } else {
            const sdk = new OpenRouter({
              apiKey: 'fixture',
              serverURL: url,
              retryConfig: { strategy: 'none' },
              timeoutMs: 3000,
            });
            for (const stream of [false, true]) {
              const result = await sdk.chat.send({
                chatRequest: {
                  model: 'chat',
                  messages: [{ role: 'assistant', refusal: value }],
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
            }
          }
          assert.deepEqual((f.sent.at(-1)?.messages as unknown[] | undefined)?.[0], {
            role: 'assistant',
            content: null,
            refusal: value,
          });
          safe(f);
        }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
});
test('delegated refusal history coexists with reasoning and retains stream failure and unknown usage gates', async () => {
  const fields = {
    content: null,
    refusal,
    reasoning: 'private reasoning',
    reasoning_details: [{ type: 'reasoning.text', text: 'private detail' }],
  };
  const f = httpFixture('openrouter');
  assert.equal(
    (await f.handler(request('/v1/chat/completions', { messages: history(fields) }))).status,
    200,
  );
  assert.deepEqual((f.sent[0]?.messages as unknown[] | undefined)?.[1], {
    role: 'assistant',
    ...fields,
  });
  safe(f);
  for (const [options, status] of [
    [{ auth: true }, 401],
    [{ deny: true }, 403],
    [{ explicitDeny: true }, 403],
    [{ denyAction: 'llm:UseProvider' }, 403],
    [{ limit: true }, 429],
    [{ audit: true }, 503],
    [{ fail: true }, 502],
    [{ usageFail: true }, 200],
    [{ outcomeFail: true }, 200],
  ] as const) {
    const blocked = httpFixture('openrouter', options);
    const response = await blocked.handler(
      request('/api/v1/chat/completions', { messages: history(fields), stream: true }),
    );
    assert.equal(response.status, status);
    const text = await response.text();
    if (options.usageFail || options.outcomeFail) {
      assert.match(text, /error/u);
      assert.doesNotMatch(text, /\[DONE\]/u);
    }
    assert.doesNotMatch(text, /private|fixture-key/u);
    safe(blocked);
  }
  for (const kind of ['openai', 'openrouter'] as const) {
    const { usage: _usage, ...missing } = body(kind) as Record<string, unknown>;
    const unknown = httpFixture(kind, { responses: [missing] });
    assert.equal(
      (
        await unknown.handler(
          request('/v1/chat/completions', { messages: history({ content: null, refusal }) }),
        )
      ).status,
      200,
    );
    const usage = (unknown.usage[0] as { usage: { status: string; totalTokens: number | null } })
      .usage;
    assert.equal(usage.status, 'missing');
    assert.equal(usage.totalTokens, null);
    safe(unknown);
  }
  const inherited = Object.assign(Object.create({ refusal }), {
    role: 'assistant',
    content: 'private',
  });
  assert.deepEqual(snapshotChatMessages([inherited]), [{ role: 'assistant', content: 'private' }]);
});
