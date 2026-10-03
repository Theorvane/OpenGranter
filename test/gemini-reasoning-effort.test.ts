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
function adapter(
  kind: Kind,
  cap?: number,
  mutate?: () => void,
  transportFails = false,
  thought?: unknown,
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
    if (kind === 'google' && thought !== undefined) {
      const response = body(kind) as { candidates: { content: { parts: object[] } }[] };
      const candidate = response.candidates[0];
      assert.ok(candidate);
      candidate.content.parts = [{ text: 'private thought', thought }, { text: 'reply' }];
      return Response.json(response);
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
    thought?: unknown;
  } = {},
) {
  const f = adapter(kind, undefined, options.mutate, options.fail, options.thought);
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

function generation(f: ReturnType<typeof adapter>) {
  return f.sent.at(-1)?.generationConfig as Record<string, unknown> | undefined;
}
const levels = ['minimal', 'low', 'medium', 'high'] as const;
test('direct Gemini preserves optional thinking levels and existing generation controls', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    for (const value of [undefined, null, ...levels]) {
      const f = httpFixture('google');
      const response = await f.handler(
        request(path, { reasoning_effort: value, top_k: 3, seed: 4 }),
      );
      assert.equal(response.status, 200);
      assert.deepEqual(
        generation(f)?.thinkingConfig,
        value == null ? undefined : { thinkingLevel: value },
      );
      assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'reasoning_effort'), false);
      assert.equal(generation(f)?.maxOutputTokens, 17);
      assert.equal(generation(f)?.temperature, 0.4);
      assert.equal(generation(f)?.topP, 0.7);
      assert.equal(generation(f)?.topK, 3);
      assert.equal(generation(f)?.seed, 4);
      assert.deepEqual(generation(f)?.stopSequences, ['marker']);
      assert.equal(f.usage.length, 1);
      assert.doesNotMatch(
        JSON.stringify([f.audits, f.usage]),
        /reasoning_effort|thinking|private|fixture-key/u,
      );
    }
  }
});
test('direct Gemini effort captures once before asynchronous credentials', async () => {
  const mutable = input({ reasoning_effort: 'high' });
  const f = adapter('google', undefined, () => Object.assign(mutable, { reasoning_effort: 'low' }));
  await f.call(mutable as unknown as ChatRequest);
  assert.deepEqual(generation(f)?.thinkingConfig, { thinkingLevel: 'high' });
  let reads = 0;
  const getter = Object.defineProperty(input(), 'reasoning_effort', {
    get: () => (++reads === 1 ? 'medium' : 'private invalid'),
  });
  const observed = adapter('google');
  await observed.call(getter as unknown as ChatRequest);
  assert.deepEqual(generation(observed)?.thinkingConfig, { thinkingLevel: 'medium' });
  assert.equal(reads, 1);
});
test('Gemini effort-only requests preserve omission defaults and configured output caps', async () => {
  for (const value of [undefined, null, ...levels]) {
    const f = adapter('google');
    await f.call({
      model: 'chat',
      messages: [{ role: 'user', content: 'text' }],
      ...(value == null ? {} : { reasoning_effort: value }),
    });
    assert.deepEqual(f.sent[0], {
      contents: [{ role: 'user', parts: [{ text: 'text' }] }],
      ...(value == null ? {} : { generationConfig: { thinkingConfig: { thinkingLevel: value } } }),
    });
  }
  const f = adapter('google', 8);
  await f.call(input({ reasoning_effort: 'high' }) as unknown as ChatRequest);
  assert.equal(generation(f)?.maxOutputTokens, 8);
  assert.deepEqual(generation(f)?.thinkingConfig, { thinkingLevel: 'high' });
});
test('unsupported Gemini levels and all Anthropic levels reject before secrets', async () => {
  for (const kind of ['google', 'anthropic'] as const) {
    for (const value of kind === 'google'
      ? ['none', 'xhigh', 'max']
      : ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
      const f = httpFixture(kind);
      assert.equal(
        (await f.handler(request('/api/v1/chat/completions', { reasoning_effort: value }))).status,
        502,
      );
      assert.equal(f.sent.length, 0);
      assert.equal(f.secrets(), 0);
      assert.equal(f.usage.length, 0);
    }
  }
});
test('Gemini effort rejects hidden and malformed thought parts with safe failed usage', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    for (const thought of [true, 'private invalid', 1, null, {}])
      for (const effort of [undefined, 'high']) {
        const f = httpFixture('google', { thought });
        const response = await f.handler(request(path, { reasoning_effort: effort }));
        assert.equal(response.status, 502);
        assert.doesNotMatch(await response.text(), /private|thinking|reasoning_effort/u);
        assert.equal(f.usage.length, 1);
        assert.equal((f.usage[0] as { outcome: string }).outcome, 'failed');
        assert.equal((f.usage[0] as { possiblyBilled: boolean }).possiblyBilled, true);
        assert.doesNotMatch(
          JSON.stringify([f.audits, f.usage]),
          /private|thinking|reasoning_effort/u,
        );
      }
  }
  const f = httpFixture('google', { thought: false });
  assert.equal(
    (await f.handler(request('/api/v1/chat/completions', { reasoning_effort: 'low' }))).status,
    200,
  );
});
test('Gemini effort retains deny limits required accounting and safe upstream failures', async () => {
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
      const f = httpFixture('google', options);
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
        assert.equal((f.usage[0] as { outcome: string }).outcome, 'failed');
        assert.equal((f.usage[0] as { possiblyBilled: boolean }).possiblyBilled, true);
      }
      assert.doesNotMatch(await response.text(), /private|thinking|reasoning_effort|fixture-key/u);
    }
  }
});
test('actual OpenAI SDK preserves Gemini thinking-level requests through both bases', async () => {
  const f = httpFixture('google');
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
      for (const value of [null, ...levels]) {
        const result = await sdk.chat.completions.create(
          input({ reasoning_effort: value }) as OpenAI.ChatCompletionCreateParamsNonStreaming,
        );
        assert.equal(result.choices[0]?.message.content, 'reply');
        assert.deepEqual(
          generation(f)?.thinkingConfig,
          value == null ? undefined : { thinkingLevel: value },
        );
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
