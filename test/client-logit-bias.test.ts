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
      ? new Response('private fixture upstream error', { status: 400 })
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
const supported = ['openai', 'openrouter'] as const;
const selected = JSON.parse('{"50256":-100,"":0,"토큰":1.5,"__proto__":1000}') as Record<
  string,
  number
>;
for (const kind of kinds) {
  test(`${kind}: omission/null and exact map values across both HTTP prefixes`, async () => {
    for (const fields of [{}, { logit_bias: null }, { logit_bias: {} }, { logit_bias: selected }])
      for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
        const f = httpFixture(kind);
        const map = 'logit_bias' in fields ? fields.logit_bias : undefined;
        const unsupported =
          map !== undefined &&
          map !== null &&
          !supported.includes(kind as (typeof supported)[number]);
        const response = await f.handler(request(path, fields));
        assert.equal(response.status, unsupported ? 502 : 200);
        assert.equal(f.secrets(), unsupported ? 0 : 1);
        assert.equal(f.sent.length, unsupported ? 0 : 1);
        assert.equal(f.usage.length, unsupported ? 0 : 1);
        if (!unsupported) {
          assert.equal(f.sent[0]?.logit_bias === undefined, map == null);
          if (map != null) assert.deepEqual(f.sent[0]?.logit_bias, map);
          assert.equal((f.usage[0] as { principalId: string }).principalId, 'user');
        }
        assert.doesNotMatch(
          JSON.stringify([f.audits, f.usage]),
          /private prompt|fixture-key|토큰|50256/u,
        );
      }
  });
  test(`${kind}: installed SDK sends maps or safely rejects unsupported native semantics`, async () => {
    const f = httpFixture(kind);
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
        const call = () =>
          sdk.chat.completions.create(
            input({ logit_bias: selected }) as OpenAI.ChatCompletionCreateParamsNonStreaming,
          );
        if (!supported.includes(kind as (typeof supported)[number]))
          await assert.rejects(
            call,
            (error) =>
              error instanceof OpenAI.APIError &&
              error.status === 502 &&
              !error.message.includes('토큰'),
          );
        else {
          assert.equal((await call()).choices[0]?.message.content, 'reply');
          assert.deepEqual(f.sent.at(-1)?.logit_bias, selected);
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  test(`${kind}: malformed controls reject before HTTP routing and native secrets`, async () => {
    for (const value of [
      true,
      1,
      'private malformed',
      [],
      [1],
      { token: 'private malformed' },
      { token: null },
      { token: Infinity },
      { token: NaN },
    ]) {
      for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
        const f = httpFixture(kind);
        const response = await f.handler(request(path, { logit_bias: value }));
        assert.equal(response.status, 400);
        assert.equal(f.routes(), 0);
        assert.equal(f.secrets(), 0);
        assert.equal(f.usage.length, 0);
        assert.doesNotMatch(await response.text(), /private malformed|fixture-key/u);
      }
      const f = adapter(kind);
      await assert.rejects(() => f.call(input({ logit_bias: value }) as unknown as ChatRequest));
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
    }
  });
  test(`${kind}: IAM, limits and required audit cannot be bypassed by token keys`, async () => {
    for (const [options, status] of [
      [{ deny: true }, 403],
      [{ explicitDeny: true }, 403],
      [{ limit: true }, 429],
      [{ audit: true }, 503],
    ] as const)
      for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
        const f = httpFixture(kind, options);
        const response = await f.handler(request(path, { logit_bias: selected }));
        assert.equal(response.status, status);
        assert.equal(f.secrets(), 0);
        assert.equal(f.usage.length, 0);
      }
  });
}
test('native logit map captures own keys and values before secret await', async () => {
  for (const kind of supported) {
    const mapping: Record<string, number> = { privateToken: 1 };
    const f = adapter(kind, undefined, () => {
      mapping.privateToken = 99;
      mapping.injected = 42;
    });
    await f.call(input({ logit_bias: mapping }) as unknown as ChatRequest);
    assert.deepEqual(f.sent[0]?.logit_bias, { privateToken: 1 });
  }
});
test('logit-bias transport failures preserve safe billed-attempt accounting', async () => {
  for (const kind of supported) {
    const f = httpFixture(kind, { fail: true });
    const response = await f.handler(request('/api/v1/chat/completions', { logit_bias: selected }));
    assert.equal(response.status, 502);
    assert.equal(f.usage.length, 1);
    assert.equal((f.usage[0] as { possiblyBilled: boolean }).possiblyBilled, true);
    assert.doesNotMatch(await response.text(), /토큰|50256|fixture-key|private prompt/u);
    assert.doesNotMatch(
      JSON.stringify([f.audits, f.usage]),
      /토큰|50256|fixture-key|private prompt/u,
    );
  }
});
