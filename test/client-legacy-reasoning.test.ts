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
    /include_reasoning|reasoning|private|fixture-key/u,
  );
}
test('legacy aliases normalize on both bases and modes without default effort or upstream legacy fields', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const stream of [false, true])
      for (const include_reasoning of [undefined, false, true])
        for (const reasoning_effort of [null, 'high']) {
          const f = httpFixture('openrouter');
          const response = await f.handler(
            request(path, {
              stream,
              reasoning_effort,
              ...(include_reasoning === undefined ? {} : { include_reasoning }),
            }),
          );
          assert.equal(response.status, 200);
          if (stream) assert.ok((await response.text()).endsWith('data: [DONE]\n\n'));
          assert.deepEqual(
            f.sent[0]?.reasoning,
            include_reasoning === undefined
              ? undefined
              : include_reasoning
                ? {}
                : { exclude: true },
          );
          assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'include_reasoning'), false);
          assert.equal(f.sent[0]?.reasoning_effort, reasoning_effort ?? undefined);
          assert.deepEqual(f.sent[0]?.provider, { only: ['provider'] });
          assert.equal(f.usage.length, 1);
          safe(f);
        }
});
test('malformed and mixed legacy controls reject before routes and secrets at HTTP and adapter boundaries', async () => {
  for (const fields of [
    ...[null, 'true', 0, [], {}].map((include_reasoning) => ({ include_reasoning })),
    ...[false, true].flatMap((include_reasoning) =>
      [
        null,
        {},
        { exclude: true },
        { effort: 'high' },
        { enabled: true },
        { max_tokens: 2000 },
      ].map((reasoning) => ({ include_reasoning, reasoning })),
    ),
  ]) {
    const f = httpFixture('openrouter');
    assert.equal((await f.handler(request('/api/v1/chat/completions', fields))).status, 400);
    assert.equal(f.routes(), 0);
    assert.equal(f.secrets(), 0);
    safe(f);
    const a = adapter('openrouter');
    await assert.rejects(() => a.call(input(fields) as unknown as ChatRequest));
    assert.equal(a.secrets(), 0);
    assert.equal(a.sent.length, 0);
  }
});
test('legacy getters are captured once and late mutation cannot alter normalization with safe exceptions', async () => {
  let reads = 0;
  const config = Object.defineProperty(input(), 'include_reasoning', {
    enumerable: true,
    get: () => {
      reads++;
      return reads === 1;
    },
  });
  const f = adapter('openrouter');
  await f.call(config as unknown as ChatRequest);
  assert.equal(reads, 1);
  assert.deepEqual(f.sent[0]?.reasoning, {});
  const mutable = { ...input(), include_reasoning: false };
  const late = adapter('openrouter', undefined, () => {
    mutable.include_reasoning = true;
  });
  await late.call(mutable as unknown as ChatRequest);
  assert.deepEqual(late.sent[0]?.reasoning, { exclude: true });
  for (const kind of kinds) {
    const malformed = Object.defineProperty(input(), 'include_reasoning', {
      get: () => {
        throw new Error('private accessor');
      },
    });
    const denied = adapter(kind);
    await assert.rejects(
      () => denied.call(malformed as unknown as ChatRequest),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /private/u);
        return true;
      },
    );
    assert.equal(denied.secrets(), 0);
  }
});
test('native providers reject true and false legacy aliases before secrets or accounting', async () => {
  for (const kind of ['openai', 'anthropic', 'google'] as const)
    for (const include_reasoning of [false, true]) {
      const f = httpFixture(kind);
      assert.equal(
        (await f.handler(request('/v1/chat/completions', { include_reasoning }))).status,
        502,
      );
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
      assert.equal(f.usage.length, 0);
      safe(f);
      const a = adapter(kind);
      await assert.rejects(() => a.call(input({ include_reasoning }) as unknown as ChatRequest));
      assert.equal(a.secrets(), 0);
    }
});
test('legacy aliases retain IAM limits persistence privacy and safe possible-billing failures', async () => {
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
      request('/api/v1/chat/completions', { include_reasoning: false }),
    );
    assert.equal(response.status, status);
    assert.equal(f.secrets(), dispatched ? 1 : 0);
    assert.equal(f.sent.length, dispatched ? 1 : 0);
    assert.doesNotMatch(await response.text(), /private|fixture-key/u);
    safe(f);
    if ('fail' in options) {
      assert.equal((f.usage[0] as { possiblyBilled: boolean }).possiblyBilled, true);
      assert.equal((f.usage[0] as { outcome: string }).outcome, 'failed');
    }
  }
  for (const options of [{ usageFail: true }, { outcomeFail: true }]) {
    const f = httpFixture('openrouter', options);
    const response = await f.handler(
      request('/v1/chat/completions', { stream: true, include_reasoning: true }),
    );
    assert.equal(response.status, 200);
    const wire = await response.text();
    assert.match(wire, /"error"/u);
    assert.doesNotMatch(wire, /\[DONE\]|private|fixture-key/u);
    safe(f);
  }
});
test('normalized aliases coexist with validated history and do not filter returned reasoning or usage', async () => {
  const messages = [
    { role: 'user', content: 'private' },
    {
      role: 'assistant',
      content: null,
      reasoning_details: [{ type: 'reasoning.encrypted', data: 'private opaque' }],
    },
    { role: 'user', content: 'continue' },
  ];
  const upstream = {
    ...body('openrouter'),
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'reply', reasoning: 'private reasoning' },
        finish_reason: 'stop',
      },
    ],
  };
  const f = httpFixture('openrouter', { responses: [upstream] });
  const response = await f.handler(
    request('/v1/chat/completions', { include_reasoning: false, messages }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(f.sent[0]?.messages, messages);
  const result = (await response.json()) as {
    choices: { message: Record<string, unknown> }[];
    usage: object;
  };
  assert.equal(result.choices[0]?.message.reasoning, 'private reasoning');
  assert.deepEqual(result.usage, { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 });
  safe(f);
});
test('actual compatible SDK sends legacy aliases while pinned OpenRouter SDK strips them', async () => {
  const f = httpFixture('openrouter');
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
      const router = new OpenRouter({
        apiKey: 'fixture',
        serverURL: `http://127.0.0.1:${address.port}${base}`,
        retryConfig: { strategy: 'none' },
      });
      for (const include_reasoning of [false, true]) {
        const fields = {
          model: 'chat',
          messages: [{ role: 'user' as const, content: 'private' }],
          include_reasoning,
        };
        const response = await sdk.chat.completions.create({ ...fields, stream: false });
        assert.equal(response.choices[0]?.message.content, 'reply');
        assert.deepEqual(f.sent.at(-1)?.reasoning, include_reasoning ? {} : { exclude: true });
        const stream = await sdk.chat.completions.create({ ...fields, stream: true });
        let reply = '';
        for await (const event of stream) reply += event.choices[0]?.delta.content ?? '';
        assert.equal(reply, 'reply');
        assert.deepEqual(f.sent.at(-1)?.reasoning, include_reasoning ? {} : { exclude: true });
        const result = await router.chat.send({
          chatRequest: { ...fields, reasoningEffort: 'high' },
        });
        assert.ok('choices' in result);
        assert.equal(Object.hasOwn(f.sent.at(-1) ?? {}, 'reasoning'), false);
        assert.equal(f.sent.at(-1)?.reasoning_effort, 'high');
      }
    }
    assert.equal(f.usage.length, 12);
    safe(f);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
