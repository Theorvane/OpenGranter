import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
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
      if (options.audit || (options.outcomeAudit && event.kind === 'delegated-attempt'))
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

test('delegated reasoning_effort passes both public bases with exact forwarding', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const f = httpFixture('openrouter');
    const response = await f.handler(request(path, { reasoning_effort: 'high' }));
    assert.equal(response.status, 200);
    assert.equal(f.sent[0]?.reasoning_effort, 'high');
  }
});

for (const kind of kinds)
  test(`${kind}: reasoning_effort defaults, enum and destination support stay explicit`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
      for (const value of [
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
        const f = httpFixture(kind),
          unsupported = kind !== 'openrouter' && value !== undefined && value !== null;
        const response = await f.handler(
          request(path, value === undefined ? {} : { reasoning_effort: value }),
        );
        assert.equal(response.status, unsupported ? 502 : 200);
        assert.equal(f.secrets(), unsupported ? 0 : 1);
        assert.equal(f.sent.length, unsupported ? 0 : 1);
        assert.equal(f.usage.length, unsupported ? 0 : 1);
        if (!unsupported) assert.equal(f.sent[0]?.reasoning_effort, value ?? undefined);
      }
  });
const invalids = ['', 'LOW', 'private invalid', 0, 1, true, [], {}];
test('malformed reasoning_effort rejects before routing and native credential access', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const value of invalids) {
      const f = httpFixture('openrouter'),
        response = await f.handler(request(path, { reasoning_effort: value }));
      assert.equal(response.status, 400);
      assert.equal(f.routes(), 0);
      assert.equal(f.secrets(), 0);
      assert.equal(f.usage.length, 0);
      assert.doesNotMatch(await response.text(), /private/u);
      assert.doesNotMatch(JSON.stringify(f.audits), /private/u);
    }
  for (const kind of kinds)
    for (const value of [
      ...invalids,
      NaN,
      Infinity,
      -Infinity,
      ...(kind === 'openrouter'
        ? []
        : ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
    ]) {
      const f = adapter(kind);
      await assert.rejects(
        () => f.call(input({ reasoning_effort: value }) as unknown as ChatRequest),
        (error: unknown) =>
          error instanceof Error && 'possiblyBilled' in error && error.possiblyBilled === false,
      );
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
    }
});
test('delegated reasoning_effort is captured once before asynchronous credential resolution', async () => {
  const mutable = { ...input(), reasoning_effort: 'high' };
  const f = adapter('openrouter', undefined, () => {
    mutable.reasoning_effort = 'max';
  });
  await f.call(mutable as unknown as ChatRequest);
  assert.equal(f.sent[0]?.reasoning_effort, 'high');
  let reads = 0;
  const getter = Object.defineProperty(input(), 'reasoning_effort', {
    get: () => {
      reads++;
      return reads === 1 ? 'low' : 'private invalid';
    },
  });
  const observed = adapter('openrouter');
  await observed.call(getter as unknown as ChatRequest);
  assert.equal(observed.sent[0]?.reasoning_effort, 'low');
  assert.equal(reads, 1);
});
test('reasoning_effort retains denial, limit, safe transport failure and accounting boundaries', async () => {
  for (const options of [
    { deny: true },
    { explicitDeny: true },
    { limit: true },
    { audit: true },
  ]) {
    const f = httpFixture('openrouter', options),
      response = await f.handler(request('/api/v1/chat/completions', { reasoning_effort: 'low' }));
    assert.equal(response.status, options.limit ? 429 : options.audit ? 503 : 403);
    assert.equal(f.secrets(), 0);
    assert.equal(f.sent.length, 0);
    assert.equal(f.usage.length, 0);
  }
  const f = httpFixture('openrouter', { fail: true });
  const response = await f.handler(
    request('/api/v1/chat/completions', { reasoning_effort: 'low' }),
  );
  assert.equal(response.status, 502);
  assert.equal(f.usage.length, 1);
  assert.doesNotMatch(await response.text(), /private|fixture-key/u);
  assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private prompt|fixture-key/u);
});
test('actual OpenAI and OpenRouter SDKs forward reasoning effort on both bases', async () => {
  const f = httpFixture('openrouter'),
    server = createNodeRequestServer(f.handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    for (const base of ['/v1', '/api/v1']) {
      const url = `http://127.0.0.1:${address.port}${base}`;
      const openai = new OpenAI({ apiKey: 'fixture', baseURL: url, maxRetries: 0 });
      const result = await openai.chat.completions.create(
        input({ reasoning_effort: 'low' }) as OpenAI.ChatCompletionCreateParamsNonStreaming,
      );
      assert.equal(result.choices[0]?.message.content, 'reply');
      assert.equal(f.sent.at(-1)?.reasoning_effort, 'low');
      const router = new OpenRouter({
        apiKey: 'fixture',
        serverURL: url,
        retryConfig: { strategy: 'none' },
      });
      const completion = await router.chat.send({
        chatRequest: {
          model: 'chat',
          messages: [{ role: 'user', content: 'text' }],
          reasoningEffort: 'high',
        } as Parameters<typeof router.chat.send>[0]['chatRequest'],
      });
      assert.ok('choices' in completion);
      assert.equal(completion.choices[0]?.message.content, 'reply');
      assert.equal(f.sent.at(-1)?.reasoning_effort, 'high');
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('delegated reasoning_effort cannot return success before required ledger and outcome audit', async () => {
  for (const options of [{ ledger: true }, { outcomeAudit: true }]) {
    const f = httpFixture('openrouter', options),
      response = await f.handler(request('/api/v1/chat/completions', { reasoning_effort: 'low' }));
    assert.equal(response.status, 503);
    assert.equal(f.sent.length, 1);
    assert.equal(f.usage.length, options.ledger ? 0 : 1);
    assert.doesNotMatch(await response.text(), /private|fixture-key/u);
  }
});

test('delegated reasoning_effort forwards all values through controlled HTTP text streaming on both bases', async () => {
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
      const f = httpFixture('openrouter');
      const response = await f.handler(request(path, { stream: true, reasoning_effort }));
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.ok(body.endsWith('data: [DONE]\n\n'));
      assert.equal(f.sent[0]?.reasoning_effort, reasoning_effort ?? undefined);
      assert.equal(
        Object.hasOwn(f.sent[0] ?? {}, 'reasoning_effort'),
        reasoning_effort !== undefined && reasoning_effort !== null,
      );
      assert.deepEqual(f.sent[0]?.provider, { only: ['provider'] });
      assert.equal(f.usage.length, 1);
      assert.doesNotMatch(
        JSON.stringify([f.audits, f.usage]),
        /reasoning_effort|private prompt|fixture-key/u,
      );
    }
  }
});

test('native streaming reasoning_effort captures once before credentials and fails invalid values before dispatch', async () => {
  const mutable = input({ reasoning_effort: 'max' }) as unknown as ChatRequest;
  const f = adapter('openrouter', undefined, () =>
    Object.assign(mutable, { reasoning_effort: 'low' }),
  );
  await f.stream(
    { upstreamModelId: 'model', authorizedProviderSlugs: ['provider'] },
    mutable,
    () => {},
  );
  assert.equal(f.sent[0]?.reasoning_effort, 'max');
  for (const reasoning_effort of invalids) {
    const invalid = adapter('openrouter');
    await assert.rejects(() =>
      invalid.stream(
        { upstreamModelId: 'model', authorizedProviderSlugs: ['provider'] },
        input({ reasoning_effort }) as unknown as ChatRequest,
        () => {},
      ),
    );
    assert.equal(invalid.secrets(), 0);
    assert.equal(invalid.sent.length, 0);
  }
});

test('reasoning_effort preserves function-tool continuation history on both delegated bases', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const f = httpFixture('openrouter');
    const messages = [
      { role: 'user', content: 'private prompt' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call-1', content: 'private tool result' },
    ];
    const response = await f.handler(request(path, { reasoning_effort: 'high', messages }));
    assert.equal(response.status, 200);
    assert.deepEqual(f.sent[0]?.messages, messages);
    assert.equal(f.sent[0]?.reasoning_effort, 'high');
    assert.equal(f.sent[0]?.temperature, 0.4);
    assert.equal(f.sent[0]?.top_p, 0.7);
    assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /reasoning_effort|private/u);
  }
});

test('reasoning_effort text streams retain denial and required usage/audit terminal gates', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    for (const options of [
      { deny: true },
      { explicitDeny: true },
      { limit: true },
      { audit: true },
      { ledger: true },
      { outcomeAudit: true },
    ]) {
      const f = httpFixture('openrouter', options);
      const response = await f.handler(request(path, { reasoning_effort: 'max', stream: true }));
      const started = 'ledger' in options || 'outcomeAudit' in options;
      assert.equal(
        response.status,
        started ? 200 : 'limit' in options ? 429 : 'audit' in options ? 503 : 403,
      );
      const body = await response.text();
      assert.equal(body.includes('[DONE]'), false);
      assert.equal(f.sent.length, started ? 1 : 0);
      assert.doesNotMatch(body, /private|fixture-key/u);
      assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /reasoning_effort|private/u);
    }
  }
});

test('structured reasoning and include_reasoning remain rejected without inferring shorthand precedence', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    for (const extra of [
      { reasoning: { effort: 'high' } },
      { reasoning: { effort: 'low' } },
      { reasoning: null },
      { include_reasoning: true },
    ]) {
      const f = httpFixture('openrouter');
      assert.equal(
        (await f.handler(request(path, { reasoning_effort: 'high', ...extra }))).status,
        400,
      );
      assert.equal(f.routes(), 0);
      assert.equal(f.secrets(), 0);
    }
  }
});

test('actual SDK sockets preserve delegated reasoning effort for text streaming and reject unknown SDK strings', async () => {
  const f = httpFixture('openrouter');
  const server = createNodeRequestServer(f.handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    for (const base of ['/v1', '/api/v1']) {
      const url = `http://127.0.0.1:${address.port}${base}`;
      const openai = new OpenAI({ apiKey: 'fixture', baseURL: url, maxRetries: 0 });
      const router = new OpenRouter({
        apiKey: 'fixture',
        serverURL: url,
        retryConfig: { strategy: 'none' },
      });
      for (const sdk of ['openai', 'openrouter'] as const) {
        for (const effort of [
          'none',
          'minimal',
          'low',
          'medium',
          'high',
          'xhigh',
          'max',
        ] as const) {
          const stream =
            sdk === 'openai'
              ? await openai.chat.completions.create({
                  ...input({ reasoning_effort: effort }),
                  stream: true,
                } as OpenAI.ChatCompletionCreateParamsStreaming)
              : await router.chat.send({
                  chatRequest: {
                    model: 'chat',
                    messages: [{ role: 'user', content: 'text' }],
                    stream: true,
                    reasoningEffort: effort,
                  },
                });
          assert.ok(Symbol.asyncIterator in stream);
          const values = [];
          for await (const value of stream) values.push(value);
          assert.equal(values.length, 3);
          assert.equal(f.sent.at(-1)?.reasoning_effort, effort);
          assert.deepEqual(f.sent.at(-1)?.provider, { only: ['provider'] });
        }
      }
      const before = f.sent.length;
      await assert.rejects(() =>
        router.chat.send({
          chatRequest: {
            model: 'chat',
            messages: [{ role: 'user', content: 'text' }],
            reasoningEffort: 'private invalid' as never,
          },
        }),
      );
      assert.equal(f.sent.length, before);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('combined verbosity and reasoning effort retain independent delegated HTTP controls', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    for (const stream of [false, true]) {
      const f = httpFixture('openrouter');
      const response = await f.handler(
        request(path, {
          verbosity: 'max',
          reasoning_effort: 'none',
          ...(stream ? { stream: true } : {}),
        }),
      );
      assert.equal(response.status, 200);
      await response.text();
      assert.equal(f.sent.length, 1);
      assert.equal(f.sent[0]?.verbosity, 'max');
      assert.equal(f.sent[0]?.reasoning_effort, 'none');
      assert.equal(f.usage.length, 1);
      assert.equal(
        JSON.stringify({ audit: f.audits, usage: f.usage }).includes('reasoning_effort'),
        false,
      );
      assert.equal(
        JSON.stringify({ audit: f.audits, usage: f.usage }).includes('verbosity'),
        false,
      );
    }
  }
});
