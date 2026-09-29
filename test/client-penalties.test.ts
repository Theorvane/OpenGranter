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
function assertMapping(
  kind: Kind,
  sent: Record<string, unknown> | undefined,
  fields: Record<string, unknown>,
) {
  assert.ok(sent);
  assert.equal(nativeLimit(kind, sent), 17);
  const config = kind === 'google' ? (sent.generationConfig as Record<string, unknown>) : sent;
  assert.equal(
    config[kind === 'google' ? 'frequencyPenalty' : 'frequency_penalty'],
    fields.frequency_penalty ?? undefined,
  );
  assert.equal(
    config[kind === 'google' ? 'presencePenalty' : 'presence_penalty'],
    fields.presence_penalty ?? undefined,
  );
}
const cases = [
  {},
  { frequency_penalty: null, presence_penalty: null },
  { frequency_penalty: -2 },
  { presence_penalty: 2 },
  { frequency_penalty: 0, presence_penalty: 0 },
  { frequency_penalty: 1.25, presence_penalty: -0.5 },
];
for (const kind of kinds) {
  test(`${kind}: penalties preserve null/default and independent/combined native values`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
      for (const fields of cases) {
        const f = httpFixture(kind);
        const unsupported =
          kind === 'anthropic' && Object.values(fields).some((value) => value !== null);
        const response = await f.handler(request(path, fields));
        assert.equal(response.status, unsupported ? 502 : 200);
        if (unsupported) {
          assert.equal(f.secrets(), 0);
          assert.equal(f.sent.length, 0);
          assert.equal(f.usage.length, 0);
        } else {
          assertMapping(kind, f.sent[0], fields);
          assert.equal(f.usage.length, 1);
        }
        assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private prompt|fixture-key/u);
      }
  });
  test(`${kind}: actual SDK penalty controls pass both configured base paths`, async () => {
    const f = httpFixture(kind);
    const server = createNodeRequestServer(f.handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      for (const base of ['/v1', '/api/v1']) {
        const fields =
          kind === 'anthropic'
            ? { frequency_penalty: null, presence_penalty: null }
            : { frequency_penalty: -0.25, presence_penalty: 0 };
        const sdk = new OpenAI({
          apiKey: 'fixture',
          baseURL: `http://127.0.0.1:${address.port}${base}`,
          maxRetries: 0,
        });
        const result = await sdk.chat.completions.create(
          input(fields) as OpenAI.ChatCompletionCreateParamsNonStreaming,
        );
        assert.equal(result.choices[0]?.message.content, 'reply');
        assertMapping(kind, f.sent.at(-1), fields);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}
test('HTTP/native penalty scalars remain captured during credential resolution', async () => {
  for (const kind of ['openai', 'google', 'openrouter'] as const) {
    const payload: Record<string, unknown> = input({
      frequency_penalty: -1,
      presence_penalty: 0.5,
    });
    const f = adapter(kind, undefined, () => {
      payload.frequency_penalty = 2;
      payload.presence_penalty = -2;
    });
    await f.call(payload as unknown as ChatRequest);
    assertMapping(kind, f.sent[0], { frequency_penalty: -1, presence_penalty: 0.5 });
    const shared: Record<string, unknown> = input({ frequency_penalty: 0, presence_penalty: 1 });
    const http = httpFixture(kind, {
      mutate: () => {
        shared.frequency_penalty = 2;
        shared.presence_penalty = -2;
      },
    });
    const req = request('/api/v1/chat/completions', shared);
    assert.equal((await http.handler(req)).status, 200);
    assertMapping(kind, http.sent[0], { frequency_penalty: 0, presence_penalty: 1 });
  }
});
const invalids = [-2.001, 2.001, 'private value', true, [], {}];
test('malformed HTTP penalties reject before route/secret with safe denial audit', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const field of ['frequency_penalty', 'presence_penalty'])
      for (const value of invalids) {
        const f = httpFixture('openrouter');
        const response = await f.handler(request(path, { [field]: value }));
        assert.equal(response.status, 400);
        assert.equal(f.routes(), 0);
        assert.equal(f.secrets(), 0);
        assert.equal(f.usage.length, 0);
        assert.doesNotMatch(await response.text(), /private/u);
        assert.doesNotMatch(JSON.stringify(f.audits), /private/u);
      }
});
test('native invalid/nonfinite and unsupported Anthropic penalties reject before credentials', async () => {
  for (const kind of kinds)
    for (const field of ['frequency_penalty', 'presence_penalty'])
      for (const value of [
        ...invalids,
        NaN,
        Infinity,
        -Infinity,
        ...(kind === 'anthropic' ? [-2, 0, 2] : []),
      ]) {
        const f = adapter(kind);
        await assert.rejects(
          () => f.call(input({ [field]: value }) as unknown as ChatRequest),
          (error: unknown) =>
            error instanceof Error && 'possiblyBilled' in error && error.possiblyBilled === false,
        );
        assert.equal(f.secrets(), 0);
        assert.equal(f.sent.length, 0);
      }
});
test('Google penalty-only settings create generationConfig without injecting other defaults', async () => {
  for (const fields of [
    { frequency_penalty: 0 },
    { presence_penalty: -2 },
    { frequency_penalty: 2, presence_penalty: 1 },
  ]) {
    const f = adapter('google');
    await f.call({
      model: 'chat',
      messages: [{ role: 'user', content: 'hi' }],
      ...fields,
    } as ChatRequest);
    assert.deepEqual(f.sent[0]?.generationConfig, {
      ...('frequency_penalty' in fields ? { frequencyPenalty: fields.frequency_penalty } : {}),
      ...('presence_penalty' in fields ? { presencePenalty: fields.presence_penalty } : {}),
    });
  }
});
test('penalties preserve IAM/limits/required audit on both paths', async () => {
  for (const kind of kinds)
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
      for (const [options, status] of [
        [{ deny: true }, 403],
        [{ explicitDeny: true }, 403],
        [{ limit: true }, 429],
        [{ audit: true }, 503],
      ] as const) {
        const f = httpFixture(kind, options);
        assert.equal(
          (await f.handler(request(path, { frequency_penalty: 0, presence_penalty: 1 }))).status,
          status,
        );
        assert.equal(f.secrets(), 0);
        assert.equal(f.sent.length, 0);
        assert.equal(f.usage.length, 0);
      }
});
test('penalties retain safe failed-provider audit and usage', async () => {
  for (const kind of kinds) {
    const f = httpFixture(kind, { fail: true });
    const fields =
      kind === 'anthropic'
        ? { frequency_penalty: null }
        : { frequency_penalty: 1, presence_penalty: -1 };
    const response = await f.handler(request('/api/v1/chat/completions', fields));
    assert.equal(response.status, 502);
    assert.equal(f.usage.length, 1);
    assert.doesNotMatch(await response.text(), /private prompt|fixture-key/u);
    assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private prompt|fixture-key/u);
  }
});

test('combined response format and penalty controls survive both HTTP paths and SDK serialization', async () => {
  for (const kind of ['openai', 'google', 'openrouter'] as const) {
    const f = httpFixture(kind);
    const server = createNodeRequestServer(f.handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      for (const base of ['/v1', '/api/v1'])
        for (const type of ['text', 'json_object'] as const) {
          const fields = {
            frequency_penalty: -0.25,
            presence_penalty: 0,
            response_format: { type },
          };
          const sdk = new OpenAI({
            apiKey: 'fixture',
            baseURL: `http://127.0.0.1:${address.port}${base}`,
            maxRetries: 0,
          });
          const result = await sdk.chat.completions.create(
            input(fields) as OpenAI.ChatCompletionCreateParamsNonStreaming,
          );
          assert.equal(result.choices[0]?.message.content, 'reply');
          const sent = f.sent.at(-1);
          assert.ok(sent);
          assertMapping(kind, sent, fields);
          if (kind === 'google') {
            assert.equal(
              (sent.generationConfig as Record<string, unknown>).responseMimeType,
              type === 'text' ? 'text/plain' : 'application/json',
            );
          } else assert.deepEqual(sent?.response_format, { type });
        }
      assert.equal(f.usage.length, 4);
      assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private prompt|fixture-key/u);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
});

test('combined native format and penalties are captured before credential awaits', async () => {
  for (const kind of ['openai', 'google', 'openrouter'] as const) {
    const format = { type: 'json_object' };
    const payload: Record<string, unknown> = input({
      response_format: format,
      frequency_penalty: 0.5,
      presence_penalty: -1,
    });
    const f = adapter(kind, undefined, () => {
      format.type = 'text';
      payload.frequency_penalty = -2;
      payload.presence_penalty = 2;
    });
    await f.call(payload as unknown as ChatRequest);
    const sent = f.sent[0];
    assert.ok(sent);
    assertMapping(kind, sent, { frequency_penalty: 0.5, presence_penalty: -1 });
    if (kind === 'google')
      assert.equal(
        (sent.generationConfig as Record<string, unknown>).responseMimeType,
        'application/json',
      );
    else assert.deepEqual(f.sent[0]?.response_format, { type: 'json_object' });
  }
});

test('Anthropic combined controls preserve null omission and reject unsupported semantics before secrets', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const [fields, status] of [
      [{ response_format: { type: 'text' }, frequency_penalty: null, presence_penalty: null }, 200],
      [{ response_format: { type: 'text' }, frequency_penalty: 0 }, 502],
      [{ response_format: { type: 'text' }, presence_penalty: 0 }, 502],
      [{ response_format: { type: 'json_object' }, frequency_penalty: null }, 502],
    ] as const) {
      const f = httpFixture('anthropic');
      assert.equal((await f.handler(request(path, fields))).status, status);
      assert.equal(f.secrets(), status === 200 ? 1 : 0);
      assert.equal(f.sent.length, status === 200 ? 1 : 0);
      assert.equal(f.usage.length, status === 200 ? 1 : 0);
    }
});
