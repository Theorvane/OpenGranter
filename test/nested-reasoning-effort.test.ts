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

const efforts = ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none'] as const;
function safe(f: ReturnType<typeof httpFixture>) {
  assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /reasoning|effort|private|fixture-key/u);
}
test('nested effort preserves null omission and named values alongside summary on both bases and modes', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const stream of [false, true])
      for (const effort of [undefined, null, ...efforts]) {
        const reasoning = { summary: 'concise', ...(effort === undefined ? {} : { effort }) };
        const f = httpFixture('openrouter');
        const response = await f.handler(
          request(path, { stream, reasoning, reasoning_effort: null }),
        );
        assert.equal(response.status, 200);
        if (stream) assert.ok((await response.text()).endsWith('data: [DONE]\n\n'));
        assert.deepEqual(f.sent[0]?.reasoning, reasoning);
        assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'reasoning_effort'), false);
        assert.deepEqual(f.sent[0]?.provider, { only: ['provider'] });
        assert.equal(f.usage.length, 1);
        safe(f);
      }
});
test('identical aliases survive unchanged while differing strings and unresolved null mix reject early', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const stream of [false, true])
      for (const top of efforts)
        for (const nested of [null, ...efforts]) {
          const f = httpFixture('openrouter');
          const response = await f.handler(
            request(path, { stream, reasoning_effort: top, reasoning: { effort: nested } }),
          );
          assert.equal(response.status, top === nested ? 200 : 400);
          if (top === nested) {
            if (stream) await response.text();
            assert.equal(f.sent[0]?.reasoning_effort, top);
            assert.deepEqual(f.sent[0]?.reasoning, { effort: nested });
            assert.equal(f.usage.length, 1);
          } else {
            assert.equal(f.routes(), 0);
            assert.equal(f.secrets(), 0);
          }
          safe(f);
        }
  for (const [top, effort] of [
    ['low', 'high'],
    ['high', null],
  ] as const) {
    const f = adapter('openrouter');
    await assert.rejects(() =>
      f.call(input({ reasoning_effort: top, reasoning: { effort } }) as unknown as ChatRequest),
    );
    assert.equal(f.secrets(), 0);
    assert.equal(f.sent.length, 0);
  }
});
test('malformed nested effort and remaining unsupported controls reject before dispatch', async () => {
  for (const effort of ['', 'LOW', 'private', true, 1, [], {}]) {
    const f = httpFixture('openrouter');
    const response = await f.handler(
      request('/api/v1/chat/completions', { reasoning: { effort } }),
    );
    assert.equal(response.status, 400);
    assert.equal(f.routes(), 0);
    assert.equal(f.secrets(), 0);
    assert.doesNotMatch(await response.text(), /private/u);
    safe(f);
  }
  for (const reasoning of [
    { effort: undefined },
    { effort: 'low', max_tokens: 100 },
    { effort: 'low', exclude: false },
    { effort: 'low', enabled: true },
  ]) {
    const f = adapter('openrouter');
    await assert.rejects(() => f.call(input({ reasoning }) as unknown as ChatRequest));
    assert.equal(f.secrets(), 0);
  }
});
test('all direct providers reject nested effort before credentials and accounting', async () => {
  for (const kind of ['openai', 'anthropic', 'google'] as const)
    for (const effort of [null, ...efforts]) {
      const f = httpFixture(kind);
      assert.equal(
        (await f.handler(request('/v1/chat/completions', { reasoning: { effort } }))).status,
        502,
      );
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
      assert.equal(f.usage.length, 0);
      safe(f);
    }
});
test('alias and nested getters are captured once and late mutation cannot change agreement', async () => {
  let topReads = 0,
    objectReads = 0,
    effortReads = 0;
  const config = Object.defineProperty({ summary: 'concise' }, 'effort', {
    enumerable: true,
    get: () => {
      effortReads++;
      return effortReads === 1 ? 'high' : 'low';
    },
  });
  const req = Object.defineProperties(input(), {
    reasoning_effort: {
      get: () => {
        topReads++;
        return topReads === 1 ? 'high' : 'low';
      },
    },
    reasoning: {
      get: () => {
        objectReads++;
        return objectReads === 1 ? config : { effort: 'low' };
      },
    },
  });
  const f = adapter('openrouter');
  await f.call(req as unknown as ChatRequest);
  assert.equal(topReads, 1);
  assert.equal(objectReads, 1);
  assert.equal(effortReads, 1);
  assert.deepEqual(f.sent[0]?.reasoning, { effort: 'high', summary: 'concise' });
  assert.equal(f.sent[0]?.reasoning_effort, 'high');
  const reasoning = { effort: 'low', summary: 'auto' };
  const mutable = { ...input(), reasoning, reasoning_effort: 'low' };
  const late = adapter('openrouter', undefined, () => {
    reasoning.effort = 'private changed';
    mutable.reasoning_effort = 'high';
  });
  await late.call(mutable as unknown as ChatRequest);
  assert.deepEqual(late.sent[0]?.reasoning, { effort: 'low', summary: 'auto' });
  assert.equal(late.sent[0]?.reasoning_effort, 'low');
});
test('nested effort retains IAM persistence privacy and possible-billing outcomes including streams', async () => {
  for (const [options, status, dispatched] of [
    [{ auth: true }, 401, false],
    [{ deny: true }, 403, false],
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
      request('/api/v1/chat/completions', { reasoning: { effort: 'high' } }),
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
      request('/v1/chat/completions', { stream: true, reasoning: { effort: 'low' } }),
    );
    assert.equal(response.status, 200);
    const wire = await response.text();
    assert.match(wire, /"error"/u);
    assert.doesNotMatch(wire, /\[DONE\]|private|fixture-key/u);
    safe(f);
  }
});
test('actual SDK forwards nested and equal effort aliases through both bases and ordinary streams', async () => {
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
        for (const effort of [null, ...efforts]) {
          const reasoning = { effort, summary: 'concise' as const };
          const result = await sdk.chat.send({
            chatRequest: {
              model: 'chat',
              messages: [{ role: 'user', content: 'private' }],
              reasoning,
              ...(effort === null ? {} : { reasoningEffort: effort }),
              stream,
            },
          });
          if (stream) {
            assert.ok(Symbol.asyncIterator in result);
            let reply = '';
            for await (const event of result) reply += event.choices[0]?.delta.content ?? '';
            assert.equal(reply, 'reply');
          } else {
            assert.ok('choices' in result);
            assert.equal(result.choices[0]?.message.content, 'reply');
          }
          assert.deepEqual(f.sent.at(-1)?.reasoning, reasoning);
          assert.equal(f.sent.at(-1)?.reasoning_effort, effort ?? undefined);
        }
      const before = f.sent.length;
      await assert.rejects(() =>
        sdk.chat.send({
          chatRequest: {
            model: 'chat',
            messages: [{ role: 'user', content: 'private' }],
            reasoning: { effort: 'high' },
            reasoningEffort: 'low',
          },
        }),
      );
      assert.equal(f.sent.length, before);
    }
    assert.equal(f.usage.length, 32);
    safe(f);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
