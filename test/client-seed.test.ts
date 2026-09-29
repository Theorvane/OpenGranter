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
function nativeLimit(kind: Kind, sent: Record<string, unknown> | undefined): unknown {
  assert.ok(sent, 'Expected a captured upstream request');
  return kind === 'google'
    ? (sent.generationConfig as Record<string, unknown> | undefined)?.maxOutputTokens
    : sent.max_tokens;
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
function assertSeed(kind: Kind, sent: Record<string, unknown> | undefined, seed?: unknown) {
  assert.ok(sent);
  assert.equal(nativeLimit(kind, sent), 17);
  const config = kind === 'google' ? (sent.generationConfig as Record<string, unknown>) : sent;
  assert.equal(config.seed, seed ?? undefined);
  if (kind === 'google') assert.equal(config.responseMimeType, 'text/plain');
  else if (kind !== 'anthropic') assert.deepEqual(sent.response_format, { type: 'text' });
}
for (const kind of kinds) {
  test(`${kind}: seed preserves omission, null, signed values and destination bounds`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
      for (const fields of [
        {},
        { seed: null },
        { seed: -2147483648 },
        { seed: 2147483647 },
        { seed: 0 },
        { seed: -1 },
        { seed: Number.MAX_SAFE_INTEGER },
        { seed: Number.MIN_SAFE_INTEGER },
      ]) {
        const seed = 'seed' in fields ? fields.seed : undefined;
        const unsupported =
          seed !== undefined &&
          seed !== null &&
          (kind === 'anthropic' ||
            (kind === 'google' && (seed > 2147483647 || seed < -2147483648)));
        const f = httpFixture(kind);
        assert.equal((await f.handler(request(path, fields))).status, unsupported ? 502 : 200);
        assert.equal(f.secrets(), unsupported ? 0 : 1);
        assert.equal(f.sent.length, unsupported ? 0 : 1);
        assert.equal(f.usage.length, unsupported ? 0 : 1);
        if (!unsupported) assertSeed(kind, f.sent[0], seed);
      }
  });
  test(`${kind}: actual SDK seed controls pass both client bases`, async () => {
    const f = httpFixture(kind),
      server = createNodeRequestServer(f.handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      for (const base of ['/v1', '/api/v1']) {
        const seed = kind === 'anthropic' ? null : 0;
        const sdk = new OpenAI({
          apiKey: 'fixture',
          baseURL: `http://127.0.0.1:${address.port}${base}`,
          maxRetries: 0,
        });
        const result = await sdk.chat.completions.create(
          input({ seed }) as OpenAI.ChatCompletionCreateParamsNonStreaming,
        );
        assert.equal(result.choices[0]?.message.content, 'reply');
        assertSeed(kind, f.sent.at(-1), seed);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}
const invalids = [
  0.1,
  Number.MAX_SAFE_INTEGER + 1,
  Number.MIN_SAFE_INTEGER - 1,
  'private value',
  true,
  [],
  {},
];
test('malformed HTTP seeds reject before routing with safe audit', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const seed of invalids) {
      const f = httpFixture('openrouter');
      const response = await f.handler(request(path, { seed }));
      assert.equal(response.status, 400);
      assert.equal(f.routes(), 0);
      assert.equal(f.secrets(), 0);
      assert.equal(f.usage.length, 0);
      assert.doesNotMatch(await response.text(), /private/u);
      assert.doesNotMatch(JSON.stringify(f.audits), /private/u);
    }
});
test('native invalid seeds and unsupported destinations fail before credentials', async () => {
  for (const kind of kinds)
    for (const seed of [
      ...invalids,
      NaN,
      Infinity,
      -Infinity,
      ...(kind === 'anthropic' ? [-1, 0, 1] : kind === 'google' ? [-2147483649, 2147483648] : []),
    ]) {
      const f = adapter(kind);
      await assert.rejects(
        () => f.call(input({ seed }) as unknown as ChatRequest),
        (error: unknown) =>
          error instanceof Error && 'possiblyBilled' in error && error.possiblyBilled === false,
      );
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
    }
});
test('native seed capture preserves supplied zero during credential await', async () => {
  for (const kind of ['openai', 'google', 'openrouter'] as const) {
    const payload: Record<string, unknown> = input({ seed: 0 });
    const f = adapter(kind, undefined, () => {
      payload.seed = 42;
    });
    await f.call(payload as unknown as ChatRequest);
    assertSeed(kind, f.sent[0], 0);
  }
});
test('Google seed-only settings create generationConfig without defaults', async () => {
  const f = adapter('google');
  await f.call({
    model: 'chat',
    messages: [{ role: 'user', content: 'hi' }],
    seed: 0,
  } as ChatRequest);
  assert.deepEqual(f.sent[0]?.generationConfig, { seed: 0 });
});
test('seed retains IAM, limits and required audit on both paths', async () => {
  for (const kind of kinds)
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
      for (const [options, status] of [
        [{ deny: true }, 403],
        [{ explicitDeny: true }, 403],
        [{ limit: true }, 429],
        [{ audit: true }, 503],
      ] as const) {
        const f = httpFixture(kind, options);
        assert.equal((await f.handler(request(path, { seed: 0 }))).status, status);
        assert.equal(f.secrets(), 0);
        assert.equal(f.sent.length, 0);
        assert.equal(f.usage.length, 0);
      }
});
test('seed retains safe failed-provider audit and usage', async () => {
  for (const kind of kinds) {
    const f = httpFixture(kind, { fail: true });
    const response = await f.handler(
      request('/api/v1/chat/completions', { seed: kind === 'anthropic' ? null : 1 }),
    );
    assert.equal(response.status, 502);
    assert.equal(f.usage.length, 1);
    assert.doesNotMatch(await response.text(), /private prompt|fixture-key/u);
    assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private prompt|fixture-key/u);
  }
});
