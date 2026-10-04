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

function upstream(message: object, known = true, finish: string | null = 'length') {
  return {
    ...body('openrouter'),
    choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finish }],
    ...(known ? {} : { usage: undefined }),
  };
}
function safe(f: ReturnType<typeof httpFixture>) {
  assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /reasoning|private|fixture-key/u);
}
test('length completions preserve canonical null content without requiring reasoning payload on both bases and routes', async () => {
  for (const kind of ['openai', 'openrouter'] as const)
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
      for (const content of [undefined, null, ''])
        for (const extra of [
          {},
          { reasoning: null },
          { reasoning: '' },
          { reasoning_details: [] },
          {
            reasoning_details: [
              { type: 'reasoning.text', signature: 'private signature', text: null },
            ],
          },
        ]) {
          const f = httpFixture(kind, {
            responses: [upstream({ ...(content === undefined ? {} : { content }), ...extra })],
          });
          const response = await f.handler(request(path));
          assert.equal(response.status, 200);
          const result = (await response.json()) as {
            choices: { message: Record<string, unknown>; finish_reason: string }[];
          };
          assert.equal(result.choices[0]?.message.content, content ?? null);
          assert.equal(result.choices[0]?.finish_reason, 'length');
          for (const [key, value] of Object.entries(extra))
            assert.deepEqual(result.choices[0]?.message[key], value);
          assert.equal((f.usage[0] as { outcome: string }).outcome, 'succeeded');
          assert.equal(f.usage.length, 1);
          safe(f);
        }
});
test('malformed fields and inconsistent tools still fail while stop without payload remains a local unsupported subset', async () => {
  for (const kind of ['openai', 'openrouter'] as const)
    for (const message of [
      { content: 1 },
      { content: [] },
      { content: {}, reasoning: 'private' },
      { content: null, reasoning: true },
      { content: null, reasoning_details: null },
      { content: null, reasoning_details: [{ type: 'reasoning.summary', summary: null }] },
      { content: null, refusal: {} },
      { role: 'user', content: null },
      {
        content: null,
        tool_calls: [
          { id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } },
        ],
      },
    ]) {
      const f = httpFixture(kind, { responses: [upstream(message)] });
      const response = await f.handler(request('/v1/chat/completions'));
      assert.equal(response.status, 502);
      assert.doesNotMatch(await response.text(), /private/u);
      assert.equal((f.usage[0] as { possiblyBilled: boolean }).possiblyBilled, true);
      safe(f);
    }
  for (const finish of ['stop', null, 'tool_calls', 'function_call', 'unknown']) {
    const f = httpFixture('openrouter', { responses: [upstream({ content: null }, true, finish)] });
    assert.equal((await f.handler(request('/v1/chat/completions'))).status, 502);
    safe(f);
  }
});
test('no-text length retains authentication IAM limits and required audit usage delivery gates', async () => {
  for (const kind of ['openai', 'openrouter'] as const)
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
      const f = httpFixture(kind, { ...options, responses: [upstream({ content: null })] });
      const response = await f.handler(request('/api/v1/chat/completions'));
      assert.equal(response.status, status);
      assert.equal(f.secrets(), dispatched ? 1 : 0);
      assert.equal(f.sent.length, dispatched ? 1 : 0);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
      safe(f);
      if ('fail' in options)
        assert.equal((f.usage[0] as { possiblyBilled: boolean }).possiblyBilled, true);
    }
});
test('no-text length preserves known or missing usage without inferring zero output or billed cost', async () => {
  for (const kind of ['openai', 'openrouter'] as const)
    for (const known of [false, true]) {
      const f = httpFixture(kind, { responses: [upstream({}, known)] });
      const response = await f.handler(request('/v1/chat/completions'));
      assert.equal(response.status, 200);
      const result = (await response.json()) as { usage?: object };
      assert.deepEqual(
        result.usage,
        known ? { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } : undefined,
      );
      assert.equal((f.usage[0] as { outcome: string }).outcome, 'succeeded');
      if (!known) {
        const usage = (f.usage[0] as { usage: { status: string; totalTokens: number | null } })
          .usage;
        assert.equal(usage.status, 'missing');
        assert.equal(usage.totalTokens, null);
      }
      safe(f);
    }
});
test('delegated exclusion budget and legacy controls coexist with no-text length without becoming required', async () => {
  for (const fields of [
    {},
    { reasoning: { exclude: true } },
    { reasoning: { max_tokens: 1024, exclude: true } },
    { include_reasoning: false },
  ]) {
    const f = httpFixture('openrouter', { responses: [upstream({ content: null })] });
    assert.equal((await f.handler(request('/v1/chat/completions', fields))).status, 200);
    assert.equal((f.usage[0] as { outcome: string }).outcome, 'succeeded');
    safe(f);
  }
});
test('actual OpenAI and OpenRouter SDK sockets retain no-text length responses on both bases and routes', async () => {
  for (const kind of ['openai', 'openrouter'] as const)
    for (const message of [{}, { content: null }]) {
      const f = httpFixture(kind, {
        responses: Array.from({ length: 4 }, () => upstream(message)),
      });
      const server = createNodeRequestServer(f.handler);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const address = server.address();
        assert.ok(address && typeof address === 'object');
        for (const base of ['/v1', '/api/v1']) {
          const url = `http://127.0.0.1:${address.port}${base}`;
          const sdk = new OpenAI({ apiKey: 'fixture', baseURL: url, maxRetries: 0 });
          const router = new OpenRouter({
            apiKey: 'fixture',
            serverURL: url,
            retryConfig: { strategy: 'none' },
          });
          const request = {
            model: 'chat',
            messages: [{ role: 'user' as const, content: 'private' }],
          };
          const first = await sdk.chat.completions.create(request);
          assert.equal(first.choices[0]?.message.content, null);
          assert.equal(first.choices[0]?.finish_reason, 'length');
          const second = await router.chat.send({ chatRequest: request });
          assert.ok('choices' in second);
          assert.equal(second.choices[0]?.message.content, null);
          assert.equal(second.choices[0]?.finishReason, 'length');
        }
        assert.equal(f.usage.length, 4);
        safe(f);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
});
