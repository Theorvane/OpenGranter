import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
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

const details = [
  { type: 'reasoning.summary', summary: 'private summary 思考', id: null, index: 2, format: null },
  {
    type: 'reasoning.text',
    text: 'private text\n\ndata: forged',
    signature: 'private signature',
    index: 0,
  },
  { type: 'reasoning.encrypted', data: 'private opaque encrypted', id: 'private id', index: 1 },
];
const calls = [{ id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } }];
function messages(message: object) {
  return [
    { role: 'user', content: 'private prompt' },
    { role: 'assistant', ...message },
    { role: 'user', content: 'continue' },
  ];
}
function safe(f: ReturnType<typeof httpFixture>) {
  assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private|fixture-key|forged/u);
}
test('delegated detail histories retain payload order omission empty arrays metadata and scalar coexistence', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const value of [undefined, [], [{ type: 'reasoning.text', signature: null }], details]) {
      const history = messages({
        content: 'private answer',
        reasoning: 'private scalar',
        ...(value === undefined ? {} : { reasoning_details: value }),
      });
      const f = httpFixture('openrouter');
      assert.equal((await f.handler(request(path, { messages: history }))).status, 200);
      assert.deepEqual(f.sent[0]?.messages, history);
      assert.equal(f.usage.length, 1);
      safe(f);
    }
});
test('nonempty validated detail payload permits missing null and normalized text-part content', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const value of details)
      for (const content of [undefined, null, [{ type: 'text', text: 'private answer' }]]) {
        const f = httpFixture('openrouter');
        assert.equal(
          (
            await f.handler(
              request(path, {
                messages: messages({
                  ...(content === undefined ? {} : { content }),
                  reasoning_details: [value],
                }),
              }),
            )
          ).status,
          200,
        );
        assert.deepEqual((f.sent[0]?.messages as unknown[] | undefined)?.[1], {
          role: 'assistant',
          content: Array.isArray(content) ? 'private answer' : null,
          reasoning_details: [value],
        });
        safe(f);
      }
});
test('complete function history preserves original detail blocks and requires matching tool results', async () => {
  const history = [
    { role: 'user', content: 'private prompt' },
    { role: 'assistant', content: null, tool_calls: calls, reasoning_details: details },
    { role: 'tool', tool_call_id: 'call', content: 'private result' },
  ];
  const f = httpFixture('openrouter');
  assert.equal(
    (await f.handler(request('/v1/chat/completions', { messages: history }))).status,
    200,
  );
  assert.deepEqual(f.sent[0]?.messages, history);
  safe(f);
  for (const invalid of [
    history.slice(0, 2),
    [...history.slice(0, 2), { role: 'user', content: 'continue' }],
    [...history.slice(0, 2), { role: 'tool', tool_call_id: 'wrong', content: 'private result' }],
  ]) {
    const rejected = httpFixture('openrouter');
    assert.equal(
      (await rejected.handler(request('/v1/chat/completions', { messages: invalid }))).status,
      400,
    );
    assert.equal(rejected.routes(), 0);
  }
  const stream = httpFixture('openrouter');
  assert.equal(
    (await stream.handler(request('/v1/chat/completions', { messages: history, stream: true })))
      .status,
    400,
  );
  assert.equal(stream.secrets(), 0);
});
test('malformed non-assistant and content-free metadata histories reject before routing and secrets', async () => {
  const invalid = [
    null,
    {},
    [null],
    [{ type: 'reasoning.text', text: 1 }],
    [{ type: 'reasoning.text', index: 0.5 }],
    [{ type: 'reasoning.text', signature: {} }],
    [{ type: 'reasoning.summary', summary: null }],
    [{ type: 'reasoning.encrypted' }],
    [{ type: 'reasoning.text', extra: 'private' }],
    [{ type: 'server_tool_call', id: 'private' }],
  ];
  for (const value of invalid) {
    const f = httpFixture('openrouter');
    const response = await f.handler(
      request('/api/v1/chat/completions', {
        messages: messages({ content: 'private answer', reasoning_details: value }),
      }),
    );
    assert.equal(response.status, 400);
    assert.equal(f.routes(), 0);
    assert.equal(f.secrets(), 0);
    assert.doesNotMatch(await response.text(), /private/u);
    safe(f);
  }
  for (const value of [
    [],
    [{ type: 'reasoning.text', signature: 'private signature' }],
    [{ type: 'reasoning.text', text: '' }],
    [{ type: 'reasoning.summary', summary: '' }],
    [{ type: 'reasoning.encrypted', data: '' }],
  ]) {
    const f = httpFixture('openrouter');
    assert.equal(
      (
        await f.handler(
          request('/v1/chat/completions', {
            messages: messages({ content: null, reasoning_details: value }),
          }),
        )
      ).status,
      400,
    );
    assert.equal(f.routes(), 0);
  }
  for (const role of ['system', 'developer', 'user', 'tool']) {
    const f = httpFixture('openrouter');
    assert.equal(
      (
        await f.handler(
          request('/v1/chat/completions', {
            messages: [{ role, content: 'private', reasoning_details: details }],
          }),
        )
      ).status,
      400,
    );
    assert.equal(f.routes(), 0);
  }
  for (const value of [undefined, new Array(1), [{ type: 'reasoning.text', text: undefined }]]) {
    const f = adapter('openrouter');
    await assert.rejects(() =>
      f.call(
        input({
          messages: messages({ content: 'private', reasoning_details: value }),
        }) as unknown as ChatRequest,
      ),
    );
    assert.equal(f.secrets(), 0);
  }
  assert.throws(() =>
    snapshotChatMessages([
      { role: 'assistant', content: null, ...Object.create({ reasoning_details: details }) },
    ]),
  );
});
test('direct OpenAI Anthropic Gemini reject every detail marker before credentials', async () => {
  for (const kind of ['openai', 'anthropic', 'google'] as const)
    for (const value of [[], [{ type: 'reasoning.text', signature: null }], details]) {
      const f = httpFixture(kind);
      assert.equal(
        (
          await f.handler(
            request('/api/v1/chat/completions', {
              messages: messages({ content: 'private', reasoning_details: value }),
            }),
          )
        ).status,
        502,
      );
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
      assert.equal(f.usage.length, 0);
      safe(f);
    }
});
test('detail snapshots capture getters once freeze nested records and survive secret-await mutation', async () => {
  let arrayReads = 0;
  let payloadReads = 0;
  const entry = Object.defineProperty({ type: 'reasoning.encrypted' }, 'data', {
    enumerable: true,
    get: () => {
      payloadReads++;
      return payloadReads === 1 ? 'private opaque' : 5;
    },
  });
  const assistant = Object.defineProperty(
    { role: 'assistant', content: null },
    'reasoning_details',
    {
      enumerable: true,
      get: () => {
        arrayReads++;
        return arrayReads === 1 ? [entry] : null;
      },
    },
  );
  const snapshot = snapshotChatMessages([assistant]);
  assert.equal(arrayReads, 1);
  assert.equal(payloadReads, 1);
  assert.deepEqual(snapshot[0]?.reasoning_details, [
    { type: 'reasoning.encrypted', data: 'private opaque' },
  ]);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot[0]));
  assert.ok(Object.isFrozen(snapshot[0]?.reasoning_details));
  assert.ok(Object.isFrozen(snapshot[0]?.reasoning_details?.[0]));
  for (const http of [false, true]) {
    const value = { type: 'reasoning.encrypted', data: 'private original' };
    const values = [value];
    const history = messages({ content: null, reasoning_details: values });
    const mutate = () => {
      value.data = 'private changed';
      values.push({ type: 'reasoning.encrypted', data: 'private forged' });
    };
    const f = adapter('openrouter', undefined, mutate);
    let sent = f.sent;
    if (http) {
      const h = httpFixture('openrouter', { mutate });
      sent = h.sent;
      const req = request('/v1/chat/completions', { messages: history });
      assert.equal((await h.handler(req)).status, 200);
    } else await f.call(input({ messages: history }) as unknown as ChatRequest);
    assert.deepEqual(
      (sent[0]?.messages as Record<string, unknown>[] | undefined)?.[1]?.reasoning_details,
      [{ type: 'reasoning.encrypted', data: 'private original' }],
    );
  }
});
test('detail history retains independent Deny limits persistence and possible-billing failure paths', async () => {
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
      const response = await f.handler(
        request(path, { messages: messages({ content: null, reasoning_details: details }) }),
      );
      assert.equal(response.status, status);
      assert.equal(f.secrets(), dispatched ? 1 : 0);
      assert.equal(f.sent.length, dispatched ? 1 : 0);
      assert.doesNotMatch(await response.text(), /private|fixture-key|forged/u);
      safe(f);
      if ('fail' in options) {
        assert.equal(f.usage.length, 1);
        assert.equal((f.usage[0] as { possiblyBilled: boolean }).possiblyBilled, true);
        assert.equal((f.usage[0] as { outcome: string }).outcome, 'failed');
      }
      if ('outcomeFail' in options) {
        assert.equal(f.usage.length, 1);
        assert.equal((f.usage[0] as { outcome: string }).outcome, 'succeeded');
      }
    }
});
test('actual SDK replays response details unchanged through both bases and ordinary delegated streams', async () => {
  const responseBody = body('openrouter');
  const f = httpFixture('openrouter', {
    responses: Array.from({ length: 8 }, () => ({
      ...responseBody,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: null, reasoning_details: details },
          finish_reason: 'stop',
        },
      ],
    })),
  });
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
      const first = await sdk.chat.send({
        chatRequest: { model: 'chat', messages: [{ role: 'user', content: 'private prompt' }] },
      });
      assert.ok('choices' in first);
      const original = first.choices[0]?.message;
      assert.ok(original?.reasoningDetails);
      for (const stream of [false, true]) {
        const result: Awaited<ReturnType<typeof sdk.chat.send>> = await sdk.chat.send({
          chatRequest: {
            model: 'chat',
            messages: [
              { role: 'user', content: 'private prompt' },
              original,
              { role: 'user', content: 'continue' },
            ],
            stream,
          },
        });
        if (stream) {
          assert.ok(Symbol.asyncIterator in result);
          let reply = '';
          let usage = 0;
          for await (const event of result) {
            reply += event.choices[0]?.delta.content ?? '';
            if (event.usage) usage++;
          }
          assert.equal(reply, 'reply');
          assert.equal(usage, 1);
        } else {
          assert.ok('choices' in result);
          assert.deepEqual(result.choices[0]?.message.reasoningDetails, original.reasoningDetails);
        }
        assert.deepEqual((f.sent.at(-1)?.messages as unknown[] | undefined)?.[1], {
          role: 'assistant',
          content: null,
          reasoning_details: details,
        });
      }
    }
    assert.equal(f.usage.length, 6);
    safe(f);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
