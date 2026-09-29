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
function request(limit?: number): ChatRequest {
  return {
    model: 'chat',
    messages: [{ role: 'user', content: 'fixture' }],
    ...(limit === undefined ? {} : { max_tokens: limit }),
  } as ChatRequest;
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
  } = {},
) {
  const f = adapter(kind, undefined, undefined, options.fail);
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
function developerRequest(): ChatRequest {
  return {
    ...request(),
    messages: [
      { role: 'system', content: 'private system text' },
      { role: 'developer', content: 'private developer text' },
      { role: 'system', content: 'private final instruction' },
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'history' },
      { role: 'user', content: 'followup' },
    ],
    max_tokens: 17,
    temperature: 0.4,
    top_p: 0.7,
    stop: ['marker'],
    n: 1,
  } as unknown as ChatRequest;
}
function assertMessages(kind: Kind, sent: Record<string, unknown> | undefined) {
  assert.ok(sent);
  const expected = developerRequest().messages;
  if (kind === 'openai' || kind === 'openrouter') assert.deepEqual(sent.messages, expected);
  else {
    const instructions = 'private system text\nprivate developer text\nprivate final instruction';
    if (kind === 'anthropic') {
      assert.equal(sent.system, instructions);
      assert.deepEqual(sent.messages, expected.slice(3));
    } else {
      assert.deepEqual(sent.systemInstruction, { parts: [{ text: instructions }] });
      assert.deepEqual(
        sent.contents,
        expected.slice(3).map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
      );
    }
  }
  assert.equal(nativeLimit(kind, sent), 17);
}
const invalidMessages: unknown[] = [
  [],
  [null],
  [{ role: 'developer', content: null }],
  [{ role: 'developer', content: [] }],
  [{ role: 'tool', content: 'private invalid' }],
  [{ role: 'developer', content: 'private invalid', name: 'x' }],
  [
    { role: 'user', content: 'x' },
    { role: 'developer', content: 'private invalid' },
  ],
  [
    { role: 'assistant', content: 'x' },
    { role: 'system', content: 'private invalid' },
  ],
  Array(2),
];
for (const kind of kinds) {
  test(`${kind}: preserves or translates developer prefix and combined native settings`, async () => {
    const f = adapter(kind);
    await f.call(developerRequest());
    assertMessages(kind, f.sent[0]);
  });
  test(`${kind}: immutable messages survive source mutation during secret lookup`, async () => {
    const original = developerRequest();
    const messages = original.messages as { role: string; content: string }[];
    const f = adapter(kind, undefined, () => {
      if (messages[1]) {
        messages[1].role = 'user';
        messages[1].content = 'private mutated';
      }
      messages.splice(3, 1);
    });
    await f.call(original);
    assertMessages(kind, f.sent[0]);
    assert.doesNotMatch(JSON.stringify(f.sent), /private mutated/u);
  });
  test(`${kind}: rejects invalid text protocols before credential lookup and transport`, async () => {
    for (const messages of invalidMessages) {
      const f = adapter(kind);
      await assert.rejects(f.call({ ...request(), messages } as unknown as ChatRequest));
      assert.equal(f.secrets(), 0);
      assert.deepEqual(f.sent, []);
    }
  });
  test(`${kind}: actual SDK developer messages work through both client paths`, async () => {
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
        const response = await sdk.chat.completions.create(
          developerRequest() as OpenAI.ChatCompletionCreateParamsNonStreaming,
        );
        assert.equal(response.choices[0]?.message.content, 'reply');
        assertMessages(kind, f.sent.at(-1));
      }
      assert.equal(f.usage.length, 2);
      assert.doesNotMatch(
        JSON.stringify(f.audits),
        /private system|private developer|private final|fixture-key/u,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}
function httpRequest(path: string, messages: unknown = developerRequest().messages) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    body: JSON.stringify({ ...developerRequest(), messages }),
  });
}
test('malformed/late public instruction messages fail before route work with safe audit', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    for (const messages of invalidMessages) {
      const f = httpFixture('openrouter');
      const response = await f.handler(httpRequest(path, messages));
      assert.equal(response.status, 400);
      assert.equal(f.routes(), 0);
      assert.equal(f.secrets(), 0);
      assert.equal(f.usage.length, 0);
      assert.equal((f.audits[0] as { kind: string }).kind, 'request-denied');
      assert.doesNotMatch(await response.text(), /private invalid/u);
      assert.doesNotMatch(JSON.stringify(f.audits), /private invalid/u);
    }
  }
});
test('developer instructions do not bypass IAM, limits or required audit', async () => {
  for (const kind of kinds) {
    for (const [options, status] of [
      [{ deny: true }, 403],
      [{ explicitDeny: true }, 403],
      [{ limit: true }, 429],
      [{ audit: true }, 503],
    ] as const) {
      const f = httpFixture(kind, options);
      assert.equal((await f.handler(httpRequest('/api/v1/chat/completions'))).status, status);
      assert.equal(f.secrets(), 0);
      assert.deepEqual(f.sent, []);
      assert.equal(f.usage.length, 0);
    }
  }
});
test('developer requests preserve safe upstream failure accounting without content', async () => {
  for (const kind of kinds) {
    const f = httpFixture(kind, { fail: true });
    const response = await f.handler(httpRequest('/api/v1/chat/completions'));
    assert.equal(response.status, 502);
    assert.equal(f.usage.length, 1);
    assert.doesNotMatch(await response.text(), /private system|private developer|fixture-key/u);
    assert.doesNotMatch(JSON.stringify(f.audits), /private system|private developer|fixture-key/u);
  }
});
