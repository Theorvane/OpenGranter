import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
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

test('delegated top_a passes both public bases with exact forwarding', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const f = httpFixture('openrouter');
    const response = await f.handler(request(path, { top_a: 0.25 }));
    assert.equal(response.status, 200);
    assert.equal(f.sent[0]?.top_a, 0.25);
  }
});

for (const kind of kinds)
  test(`${kind}: top_a defaults, range and destination support stay explicit`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
      for (const value of [undefined, null, 0, 0.25, 1]) {
        const f = httpFixture(kind),
          unsupported = kind !== 'openrouter' && value !== undefined && value !== null;
        const response = await f.handler(
          request(path, value === undefined ? {} : { top_a: value }),
        );
        assert.equal(response.status, unsupported ? 502 : 200);
        assert.equal(f.secrets(), unsupported ? 0 : 1);
        assert.equal(f.sent.length, unsupported ? 0 : 1);
        assert.equal(f.usage.length, unsupported ? 0 : 1);
        if (!unsupported) assert.equal(f.sent[0]?.top_a, value ?? undefined);
      }
  });
const invalids = [-0.1, 1.1, 'private invalid', true, [], {}];
test('malformed top_a rejects before routing and native credential access', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const value of invalids) {
      const f = httpFixture('openrouter'),
        response = await f.handler(request(path, { top_a: value }));
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
      ...(kind === 'openrouter' ? [] : [0, 1]),
    ]) {
      const f = adapter(kind);
      await assert.rejects(
        () => f.call(input({ top_a: value }) as unknown as ChatRequest),
        (error: unknown) =>
          error instanceof Error && 'possiblyBilled' in error && error.possiblyBilled === false,
      );
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
    }
});
test('delegated top_a is captured once before asynchronous credential resolution', async () => {
  const mutable = { ...input(), top_a: 0.25 };
  const f = adapter('openrouter', undefined, () => {
    mutable.top_a = 0.9;
  });
  await f.call(mutable as unknown as ChatRequest);
  assert.equal(f.sent[0]?.top_a, 0.25);
  let reads = 0;
  const getter = Object.defineProperty(input(), 'top_a', {
    get: () => {
      reads++;
      return reads === 1 ? 0.3 : -1;
    },
  });
  const observed = adapter('openrouter');
  await observed.call(getter as unknown as ChatRequest);
  assert.equal(observed.sent[0]?.top_a, 0.3);
  assert.equal(reads, 1);
});
test('top_a retains denial, limit, safe transport failure and accounting boundaries', async () => {
  for (const options of [
    { deny: true },
    { explicitDeny: true },
    { limit: true },
    { audit: true },
  ]) {
    const f = httpFixture('openrouter', options),
      response = await f.handler(request('/api/v1/chat/completions', { top_a: 0.2 }));
    assert.equal(response.status, options.limit ? 429 : options.audit ? 503 : 403);
    assert.equal(f.secrets(), 0);
    assert.equal(f.sent.length, 0);
    assert.equal(f.usage.length, 0);
  }
  const f = httpFixture('openrouter', { fail: true });
  const response = await f.handler(request('/api/v1/chat/completions', { top_a: 0.2 }));
  assert.equal(response.status, 502);
  assert.equal(f.usage.length, 1);
  assert.doesNotMatch(await response.text(), /private|fixture-key/u);
  assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private prompt|fixture-key/u);
});
test('actual OpenRouter and OpenAI SDK sockets forward delegated top_a on both bases', async () => {
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
        input({ top_a: 0 }) as OpenAI.ChatCompletionCreateParamsNonStreaming,
      );
      assert.equal(result.choices[0]?.message.content, 'reply');
      assert.equal(f.sent.at(-1)?.top_a, 0);
      const router = new OpenRouter({
        apiKey: 'fixture',
        serverURL: url,
        retryConfig: { strategy: 'none' },
      });
      const completion = await router.chat.send({
        chatRequest: { model: 'chat', messages: [{ role: 'user', content: 'text' }], topA: 0.25 },
      });
      assert.ok('choices' in completion);
      assert.equal(completion.choices[0]?.message.content, 'reply');
      assert.equal(f.sent.at(-1)?.top_a, 0.25);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('delegated top_a cannot return success before required ledger and outcome audit', async () => {
  for (const options of [{ ledger: true }, { outcomeAudit: true }]) {
    const f = httpFixture('openrouter', options),
      response = await f.handler(request('/api/v1/chat/completions', { top_a: 0.2 }));
    assert.equal(response.status, 503);
    assert.equal(f.sent.length, 1);
    assert.equal(f.usage.length, options.ledger ? 0 : 1);
    assert.doesNotMatch(await response.text(), /private|fixture-key/u);
  }
});
