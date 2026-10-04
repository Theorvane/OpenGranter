import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import { chatRequestToJSON } from '@openrouter/sdk/models/chatrequest';
import OpenAI from 'openai';
import { type ChatRequest, createChatHandler } from '../src/gateway/chat-handler.ts';
import { snapshotChatMessages } from '../src/gateway/chat-messages.ts';
import { normalizeClientTextMessages } from '../src/gateway/client-text-messages.ts';
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
function parts(value: string = refusal) {
  return [{ type: 'refusal', refusal: value }];
}
const calls = [{ id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } }];
test('single assistant refusal part normalizes exact values across both bases and routes', async () => {
  for (const kind of ['openai', 'openrouter'] as const)
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
      for (const value of ['', refusal]) {
        const f = httpFixture(kind);
        assert.equal(
          (
            await f.handler(
              request(path, { messages: history({ content: parts(value), name: 'assistant' }) }),
            )
          ).status,
          200,
        );
        assert.deepEqual((f.sent[0]?.messages as unknown[] | undefined)?.[1], {
          role: 'assistant',
          name: 'assistant',
          content: null,
          refusal: value,
        });
        assert.equal(f.usage.length, 1);
        safe(f);
      }
});
test('refusal parts preserve complete function groups and delegated metadata without resolving pending calls', async () => {
  for (const kind of ['openai', 'openrouter'] as const) {
    const messages = [
      { role: 'user', content: 'private' },
      { role: 'assistant', content: parts(), tool_calls: calls },
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
    const bad = httpFixture(kind);
    assert.equal(
      (await bad.handler(request('/v1/chat/completions', { messages: messages.slice(0, 2) })))
        .status,
      400,
    );
    assert.equal(bad.routes(), 0);
  }
  const f = httpFixture('openrouter');
  const metadata = {
    reasoning: 'private reasoning',
    reasoning_details: [{ type: 'reasoning.text', signature: 'private signature' }],
  };
  assert.equal(
    (
      await f.handler(
        request('/api/v1/chat/completions', {
          messages: history({ content: parts(), ...metadata }),
        }),
      )
    ).status,
    200,
  );
  assert.deepEqual((f.sent[0]?.messages as unknown[] | undefined)?.[1], {
    role: 'assistant',
    content: null,
    refusal,
    ...metadata,
  });
  safe(f);
});
test('invalid mixed duplicate conflicting and non-assistant refusal parts reject before routing', async () => {
  for (const fields of [
    { content: [...parts(), { type: 'text', text: 'private' }] },
    { content: [...parts(), ...parts()] },
    { content: [{ type: 'refusal', refusal: null }] },
    { content: [{ type: 'refusal', refusal: 42 }] },
    { content: [{ type: 'refusal' }] },
    { content: [{ type: 'refusal', refusal, extra: 'private' }] },
    ...[null, '', refusal].map((value) => ({ content: parts(), refusal: value })),
  ]) {
    const f = httpFixture('openrouter');
    const response = await f.handler(
      request('/v1/chat/completions', { messages: history(fields) }),
    );
    assert.equal(response.status, 400);
    assert.equal(f.routes(), 0);
    assert.equal(f.secrets(), 0);
    assert.doesNotMatch(await response.text(), /private/u);
    safe(f);
  }
  for (const role of ['system', 'developer', 'user', 'tool']) {
    const f = httpFixture('openrouter');
    assert.equal(
      (await f.handler(request('/v1/chat/completions', { messages: [{ role, content: parts() }] })))
        .status,
      400,
    );
    assert.equal(f.routes(), 0);
  }
});
test('refusal part normalization captures getters once and freezes before credential mutation', async () => {
  let messageReads = 0,
    partReads = 0;
  const part = Object.defineProperty({ type: 'refusal' }, 'refusal', {
    enumerable: true,
    get: () => {
      partReads++;
      return partReads === 1 ? refusal : 42;
    },
  });
  const message = Object.defineProperty({ role: 'assistant' }, 'content', {
    enumerable: true,
    get: () => {
      messageReads++;
      return messageReads === 1 ? [part] : null;
    },
  });
  const normalized = normalizeClientTextMessages([message]);
  assert.equal(messageReads, 1);
  assert.equal(partReads, 1);
  assert.deepEqual(normalized, [{ role: 'assistant', content: null, refusal }]);
  const original = { role: 'assistant', content: parts() };
  const f = adapter('openai', undefined, () => {
    const part = original.content[0];
    if (part) part.refusal = 'private changed';
  });
  await f.call(
    input({ messages: normalizeClientTextMessages([original]) }) as unknown as ChatRequest,
  );
  assert.equal((f.sent[0]?.messages as { refusal: string }[] | undefined)?.[0]?.refusal, refusal);
});
test('refusal parts retain native rejection auth IAM limits persistence failures and unknown usage', async () => {
  for (const kind of ['anthropic', 'google'] as const) {
    const f = httpFixture(kind);
    assert.equal(
      (
        await f.handler(
          request('/v1/chat/completions', { messages: history({ content: parts() }) }),
        )
      ).status,
      502,
    );
    assert.equal(f.secrets(), 0);
    safe(f);
  }
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
        request('/api/v1/chat/completions', { messages: history({ content: parts() }) }),
      );
      assert.equal(response.status, status);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
      if (!options.fail && !options.usageFail && !options.outcomeFail) assert.equal(f.secrets(), 0);
      if (options.fail) assert.equal(f.usage.length, 1);
      safe(f);
    }
  const { usage: _usage, ...missing } = body('openrouter') as Record<string, unknown>;
  const f = httpFixture('openrouter', { responses: [missing] });
  assert.equal(
    (await f.handler(request('/v1/chat/completions', { messages: history({ content: parts() }) })))
      .status,
    200,
  );
  assert.deepEqual(
    (f.usage[0] as { usage: { status: string; totalTokens: null } }).usage.status,
    'missing',
  );
  assert.equal((f.usage[0] as { usage: { totalTokens: null } }).usage.totalTokens, null);
  safe(f);
});
test('actual OpenAI SDK translates refusal parts on both routes and bases while OpenRouter SDK rejects raw arrays', async () => {
  assert.throws(() =>
    chatRequestToJSON({
      model: 'chat',
      messages: [{ role: 'assistant', content: parts() }],
    } as never),
  );
  assert.deepEqual(
    JSON.parse(
      chatRequestToJSON({
        model: 'chat',
        messages: [{ role: 'assistant', content: null, refusal }],
      }),
    ).messages,
    [{ role: 'assistant', content: null, refusal }],
  );
  for (const kind of ['openai', 'openrouter'] as const) {
    const f = httpFixture(kind);
    const server = createNodeRequestServer(f.handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    try {
      for (const base of ['/v1', '/api/v1']) {
        const sdk = new OpenAI({
          apiKey: 'fixture',
          baseURL: `http://127.0.0.1:${address.port}${base}`,
          maxRetries: 0,
        });
        const messages: OpenAI.ChatCompletionMessageParam[] = [
          { role: 'assistant', content: [{ type: 'refusal', refusal }] },
        ];
        const result = await sdk.chat.completions.create({ model: 'chat', messages });
        assert.equal(result.choices[0]?.message.content, 'reply');
        if (kind === 'openrouter') {
          const stream = await sdk.chat.completions.create({
            model: 'chat',
            messages,
            stream: true,
          });
          let text = '';
          for await (const event of stream) text += event.choices[0]?.delta.content ?? '';
          assert.equal(text, 'reply');
        }
        assert.deepEqual((f.sent.at(-1)?.messages as unknown[] | undefined)?.[0], {
          role: 'assistant',
          content: null,
          refusal,
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
