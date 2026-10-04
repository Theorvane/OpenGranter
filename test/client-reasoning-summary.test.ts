import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import { type ChatRequest, createChatHandler } from '../src/gateway/chat-handler.ts';
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

function safe(f: ReturnType<typeof httpFixture>) {
  assert.doesNotMatch(
    JSON.stringify([f.audits, f.usage]),
    /reasoning|summary|private|fixture-key/u,
  );
}
test('delegated reasoning summary preserves omission empty null and exact enums on both bases and modes', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const stream of [false, true])
      for (const reasoning of [
        undefined,
        {},
        { summary: null },
        { summary: 'auto' },
        { summary: 'concise' },
        { summary: 'detailed' },
      ]) {
        const f = httpFixture('openrouter');
        const response = await f.handler(
          request(path, {
            stream,
            ...(reasoning === undefined ? {} : { reasoning }),
            reasoning_effort: 'low',
          }),
        );
        assert.equal(response.status, 200);
        if (stream) assert.ok((await response.text()).endsWith('data: [DONE]\n\n'));
        assert.deepEqual(f.sent[0]?.reasoning, reasoning);
        assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'reasoning'), reasoning !== undefined);
        assert.equal(f.sent[0]?.reasoning_effort, 'low');
        assert.deepEqual(f.sent[0]?.provider, { only: ['provider'] });
        assert.equal(f.usage.length, 1);
        safe(f);
      }
});
test('malformed summary and unsupported structured controls reject before routing or native credentials', async () => {
  const values = [
    null,
    false,
    [],
    'private',
    { summary: 'none' },
    { summary: 'AUTO' },
    { summary: 1 },
    { summary: {} },
    { summary: 'auto', enabled: 'private' },
    { max_tokens: 100 },
    { summary: 'auto', provider: 'private' },
  ];
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const reasoning of values) {
      const f = httpFixture('openrouter');
      const response = await f.handler(request(path, { reasoning }));
      assert.equal(response.status, 400);
      assert.equal(f.routes(), 0);
      assert.equal(f.secrets(), 0);
      assert.doesNotMatch(await response.text(), /private/u);
      safe(f);
    }
  for (const kind of kinds)
    for (const reasoning of [...values, { summary: undefined }]) {
      const f = adapter(kind);
      await assert.rejects(() => f.call(input({ reasoning }) as unknown as ChatRequest));
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
    }
});
test('direct OpenAI Anthropic Gemini reject all supplied summary configurations before secrets', async () => {
  for (const kind of ['openai', 'anthropic', 'google'] as const)
    for (const reasoning of [
      {},
      { summary: null },
      { summary: 'auto' },
      { summary: 'concise' },
      { summary: 'detailed' },
    ]) {
      const f = httpFixture(kind);
      assert.equal(
        (await f.handler(request('/api/v1/chat/completions', { reasoning }))).status,
        502,
      );
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
      assert.equal(f.usage.length, 0);
      safe(f);
    }
});
test('summary capture reads each getter once and survives nested mutation during credentials', async () => {
  let reads = 0,
    innerReads = 0;
  const config = Object.defineProperty({}, 'summary', {
    enumerable: true,
    get: () => {
      innerReads++;
      return innerReads === 1 ? 'concise' : 'private invalid';
    },
  });
  const getter = Object.defineProperty(input(), 'reasoning', {
    enumerable: true,
    get: () => {
      reads++;
      return reads === 1 ? config : null;
    },
  });
  const f = adapter('openrouter');
  await f.call(getter as unknown as ChatRequest);
  assert.deepEqual(f.sent[0]?.reasoning, { summary: 'concise' });
  assert.equal(reads, 1);
  assert.equal(innerReads, 1);
  const mutable = { summary: 'detailed' };
  const req: Record<string, unknown> = input({ reasoning: mutable });
  const observed = adapter('openrouter', undefined, () => {
    mutable.summary = 'private changed';
    req.reasoning = { exclude: true };
  });
  await observed.call(req as unknown as ChatRequest);
  assert.deepEqual(observed.sent[0]?.reasoning, { summary: 'detailed' });
});
test('summary configuration composes with complete function and opaque reasoning history', async () => {
  const messages = [
    { role: 'user', content: 'private prompt' },
    {
      role: 'assistant',
      content: null,
      reasoning: 'private scalar',
      reasoning_details: [{ type: 'reasoning.encrypted', data: 'private opaque' }],
      tool_calls: [{ id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } }],
    },
    { role: 'tool', content: 'private result', tool_call_id: 'call' },
  ];
  const f = httpFixture('openrouter');
  assert.equal(
    (
      await f.handler(
        request('/v1/chat/completions', {
          messages,
          reasoning: { summary: 'concise', effort: 'high' },
          reasoning_effort: 'high',
        }),
      )
    ).status,
    200,
  );
  assert.deepEqual(f.sent[0]?.messages, messages);
  assert.deepEqual(f.sent[0]?.reasoning, { summary: 'concise', effort: 'high' });
  assert.equal(f.sent[0]?.reasoning_effort, 'high');
  safe(f);
});
test('summary control retains auth independent Deny limits persistence and failure accounting', async () => {
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
      const response = await f.handler(request(path, { reasoning: { summary: 'auto' } }));
      assert.equal(response.status, status);
      assert.equal(f.secrets(), dispatched ? 1 : 0);
      assert.equal(f.sent.length, dispatched ? 1 : 0);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
      safe(f);
      if ('fail' in options) {
        assert.equal(f.usage.length, 1);
        assert.equal((f.usage[0] as { possiblyBilled: boolean }).possiblyBilled, true);
        assert.equal((f.usage[0] as { outcome: string }).outcome, 'failed');
      }
      if ('outcomeFail' in options)
        assert.equal((f.usage[0] as { outcome: string }).outcome, 'succeeded');
    }
});
test('actual OpenRouter SDK carries summary configuration through both bases and text streams', async () => {
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
      for (const stream of [false, true])
        for (const summary of [undefined, null, 'auto', 'concise', 'detailed'] as const) {
          const reasoning = summary === undefined ? {} : { summary };
          const result = await sdk.chat.send({
            chatRequest: {
              model: 'chat',
              messages: [{ role: 'user', content: 'private prompt' }],
              reasoning,
              reasoningEffort: 'high',
              stream,
            },
          });
          if (stream) {
            assert.ok(Symbol.asyncIterator in result);
            let reply = '',
              usage = 0;
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
          assert.deepEqual(f.sent.at(-1)?.reasoning, reasoning);
          assert.equal(f.sent.at(-1)?.reasoning_effort, 'high');
        }
    }
    assert.equal(f.usage.length, 20);
    safe(f);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('summary streams retain provider Deny and withhold final success on persistence failure', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const denied = httpFixture('openrouter', { denyAction: 'llm:UseProvider' });
    assert.equal(
      (await denied.handler(request(path, { stream: true, reasoning: { summary: 'concise' } })))
        .status,
      403,
    );
    assert.equal(denied.secrets(), 0);
    safe(denied);
    for (const options of [{ usageFail: true }, { outcomeFail: true }]) {
      const f = httpFixture('openrouter', options);
      const response = await f.handler(
        request(path, { stream: true, reasoning: { summary: 'concise' } }),
      );
      assert.equal(response.status, 200);
      const wire = await response.text();
      assert.match(wire, /"error"/u);
      assert.doesNotMatch(wire, /\[DONE\]|private|fixture-key/u);
      assert.equal(f.secrets(), 1);
      assert.equal(f.sent.length, 1);
      assert.equal(f.usage.length, 'usageFail' in options ? 0 : 1);
      safe(f);
    }
  }
});

test('summary getter failures are fixed safe errors before credential access on every adapter', async () => {
  for (const kind of kinds) {
    let reads = 0;
    const req = Object.defineProperty(input(), 'reasoning', {
      get: () => {
        reads++;
        throw new Error('private summary fixture-key');
      },
    });
    const f = adapter(kind);
    await assert.rejects(
      () => f.call(req as unknown as ChatRequest),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /private|fixture-key/u);
        assert.ok('possiblyBilled' in error && error.possiblyBilled === false);
        return true;
      },
    );
    assert.equal(reads, 1);
    assert.equal(f.secrets(), 0);
    assert.equal(f.sent.length, 0);
  }
});
