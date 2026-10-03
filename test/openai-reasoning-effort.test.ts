import assert from 'node:assert/strict';
import { test } from 'node:test';
import OpenAI from 'openai';
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
function adapter(kind: Kind, cap?: number, mutate?: () => void, transportFails = false) {
  const sent: Record<string, unknown>[] = [];
  let secrets = 0;
  const resolveSecret = async () => {
    secrets++;
    mutate?.();
    return 'fixture-key';
  };
  const fetcher: typeof fetch = async (_, init) => {
    sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const requestBody = sent.at(-1);
    if (!transportFails && requestBody?.stream) {
      const chunk = (delta: object, finish_reason: string | null, extra: object = {}) =>
        'data: ' +
        JSON.stringify({
          id: 'gen',
          created: 1,
          object: 'chat.completion.chunk',
          model: 'model',
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
      ? new Response('private fixture unsupported top_p error', { status: 400 })
      : Response.json(body(kind));
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
  const stream = createOpenRouterTextStreamInvoker({
    credentialRef: 'secret/reference',
    resolveSecret,
    fetcher,
  });
  return {
    stream,
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
    ledger?: boolean;
    outcomeAudit?: boolean;
    fail?: boolean;
    mutate?: () => void;
  } = {},
) {
  const f = adapter(kind, undefined, options.mutate, options.fail);
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
      if (
        options.audit ||
        (options.outcomeAudit && (event.kind === 'delegated-attempt' || event.kind === 'attempt'))
      )
        throw new Error('private fixture');
      audits.push(event);
    },
    writeUsage: async (record) => {
      if (options.ledger) throw new Error('private ledger');
      usage.push(record);
    },
    invokeDirect: async (_, chat) => f.call(chat),
    invokeOpenRouter: async (_, __, chat) => f.call(chat),
    invokeOpenRouterTextStream: (_ref, ...args) => f.stream(...args),
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

test('direct OpenAI preserves exact optional reasoning_effort and existing controls on both HTTP bases', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    for (const reasoning_effort of [
      undefined,
      null,
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]) {
      const f = httpFixture('openai');
      const response = await f.handler(request(path, { reasoning_effort }));
      assert.equal(response.status, 200);
      assert.equal(f.sent[0]?.reasoning_effort, reasoning_effort ?? undefined);
      assert.equal(
        Object.hasOwn(f.sent[0] ?? {}, 'reasoning_effort'),
        reasoning_effort !== undefined && reasoning_effort !== null,
      );
      assert.equal(f.sent[0]?.max_tokens, 17);
      assert.equal(f.sent[0]?.temperature, 0.4);
      assert.equal(f.sent[0]?.top_p, 0.7);
      assert.deepEqual(f.sent[0]?.stop, ['marker']);
      assert.equal(f.usage.length, 1);
      assert.doesNotMatch(
        JSON.stringify([f.audits, f.usage]),
        /reasoning_effort|private|fixture-key/u,
      );
    }
  }
});

test('unsupported reasoning_effort values fail before direct credentials and preserve other native defaults', async () => {
  for (const kind of ['anthropic', 'google'] as const) {
    for (const reasoning_effort of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
      const f = httpFixture(kind);
      assert.equal(
        (await f.handler(request('/api/v1/chat/completions', { reasoning_effort }))).status,
        502,
      );
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
      assert.equal(f.usage.length, 0);
    }
  }
});

test('direct OpenAI reasoning_effort captures once before asynchronous credential resolution', async () => {
  const mutable = input({ reasoning_effort: 'high' });
  const f = adapter('openai', undefined, () => Object.assign(mutable, { reasoning_effort: 'low' }));
  await f.call(mutable as unknown as ChatRequest);
  assert.equal(f.sent[0]?.reasoning_effort, 'high');
  let reads = 0;
  const getter = Object.defineProperty(input(), 'reasoning_effort', {
    get: () => (++reads === 1 ? 'medium' : 'private invalid'),
  });
  const observed = adapter('openai');
  await observed.call(getter as unknown as ChatRequest);
  assert.equal(observed.sent[0]?.reasoning_effort, 'medium');
  assert.equal(reads, 1);
});

test('direct OpenAI reasoning_effort-only request injects no other generation defaults', async () => {
  const f = adapter('openai');
  await f.call({
    model: 'chat',
    messages: [{ role: 'user', content: 'text' }],
    reasoning_effort: 'low',
  });
  assert.deepEqual(f.sent[0], {
    model: 'model',
    messages: [{ role: 'user', content: 'text' }],
    stream: false,
    reasoning_effort: 'low',
  });
});

test('direct reasoning_effort keeps tool history and function request controls intact', async () => {
  const f = httpFixture('openai');
  const messages = [
    { role: 'user', content: 'private prompt' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'call-1', content: 'private result' },
  ];
  const tools = [
    { type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } },
  ];
  const response = await f.handler(
    request('/api/v1/chat/completions', {
      reasoning_effort: 'high',
      messages,
      tools,
      tool_choice: 'auto',
      parallel_tool_calls: false,
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(f.sent[0]?.messages, messages);
  assert.deepEqual(f.sent[0]?.tools, tools);
  assert.equal(f.sent[0]?.tool_choice, 'auto');
  assert.equal(f.sent[0]?.parallel_tool_calls, false);
  assert.equal(f.sent[0]?.reasoning_effort, 'high');
  assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /reasoning_effort|private/u);
});

test('direct reasoning_effort retains denial limits required accounting and safe upstream failures', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    for (const options of [
      { deny: true },
      { explicitDeny: true },
      { limit: true },
      { audit: true },
      { ledger: true },
      { outcomeAudit: true },
      { fail: true },
    ]) {
      const f = httpFixture('openai', options);
      const response = await f.handler(request(path, { reasoning_effort: 'medium' }));
      const dispatched = 'ledger' in options || 'outcomeAudit' in options || 'fail' in options;
      assert.equal(
        response.status,
        'limit' in options
          ? 429
          : 'fail' in options
            ? 502
            : 'audit' in options || 'ledger' in options || 'outcomeAudit' in options
              ? 503
              : 403,
      );
      assert.equal(f.sent.length, dispatched ? 1 : 0);
      if (options.fail) {
        assert.equal(f.usage.length, 1);
        const usage = f.usage[0] as { outcome: string; possiblyBilled: boolean };
        assert.equal(usage.outcome, 'failed');
        assert.equal(usage.possiblyBilled, true);
      }
      assert.doesNotMatch(await response.text(), /reasoning_effort|private|fixture-key/u);
      assert.doesNotMatch(
        JSON.stringify([f.audits, f.usage]),
        /reasoning_effort|private|fixture-key/u,
      );
    }
  }
});

test('actual OpenAI SDK socket preserves direct reasoning_effort through both bases', async () => {
  const f = httpFixture('openai');
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
      for (const reasoning_effort of [
        null,
        'none',
        'minimal',
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
      ] as const) {
        const result = await sdk.chat.completions.create(
          input({ reasoning_effort }) as OpenAI.ChatCompletionCreateParamsNonStreaming,
        );
        assert.equal(result.choices[0]?.message.content, 'reply');
        assert.equal(f.sent.at(-1)?.reasoning_effort, reasoning_effort ?? undefined);
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('direct reasoning effort does not enable unmanaged streaming', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const f = httpFixture('openai');
    const response = await f.handler(request(path, { reasoning_effort: 'high', stream: true }));
    assert.equal(response.status, 400);
    assert.equal(f.sent.length, 0);
    assert.equal(f.secrets(), 0);
    assert.equal(f.usage.length, 0);
  }
});

test('OpenAI preserves distinct verbosity and effort together before credential awaits', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const f = httpFixture('openai');
    const response = await f.handler(
      request(path, { verbosity: 'high', reasoning_effort: 'none' }),
    );
    assert.equal(response.status, 200);
    assert.equal(f.sent[0]?.verbosity, 'high');
    assert.equal(f.sent[0]?.reasoning_effort, 'none');
    assert.equal(f.usage.length, 1);
  }
  const mutable = input({ verbosity: 'low', reasoning_effort: 'minimal' });
  const captured = adapter('openai', undefined, () =>
    Object.assign(mutable, { verbosity: 'high', reasoning_effort: 'none' }),
  );
  await captured.call(mutable as unknown as ChatRequest);
  assert.equal(captured.sent[0]?.verbosity, 'low');
  assert.equal(captured.sent[0]?.reasoning_effort, 'minimal');
});
