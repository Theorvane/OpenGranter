import assert from 'node:assert/strict';
import { test } from 'node:test';
import OpenAI from 'openai';
import { type ChatRequest, createChatHandler } from '../src/gateway/chat-handler.ts';
import { normalizeClientTextMessages } from '../src/gateway/client-text-messages.ts';
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
const textParts = [
  { type: 'text', text: 'private first\n' },
  { type: 'text', text: '' },
  { type: 'text', text: ' Ω 마지막 ' },
] as const;
const combinedText = 'private first\n Ω 마지막 ';
function input(content: unknown = textParts, role = 'user', developer = false) {
  return {
    model: 'chat',
    messages: [
      { role: 'system', content: 'instruction' },
      ...(developer ? [{ role: 'developer', content: 'developer instruction' }] : []),
      { role, content },
    ],
    max_completion_tokens: 17,
    temperature: 0.4,
    top_p: 0.7,
    stop: ['marker'],
    n: 1,
    stream: false,
  };
}
function httpRequest(path: string, content: unknown = textParts, role = 'user') {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    body: JSON.stringify(input(content, role)),
  });
}
function assertNative(
  kind: Kind,
  sent: Record<string, unknown> | undefined,
  expected: string,
  developer = false,
) {
  assert.ok(sent);
  const instructions = developer ? 'instruction\ndeveloper instruction' : 'instruction';
  if (kind === 'google') {
    assert.deepEqual(sent.contents, [{ role: 'user', parts: [{ text: expected }] }]);
    assert.deepEqual(sent.systemInstruction, { parts: [{ text: instructions }] });
  } else {
    const messages =
      kind === 'anthropic'
        ? [{ role: 'user', content: expected }]
        : [
            { role: 'system', content: 'instruction' },
            ...(developer ? [{ role: 'developer', content: 'developer instruction' }] : []),
            { role: 'user', content: expected },
          ];
    assert.deepEqual(sent.messages, messages);
    if (kind === 'anthropic') assert.equal(sent.system, instructions);
  }
  assert.equal(nativeLimit(kind, sent), 17);
  const settings = kind === 'google' ? (sent.generationConfig as Record<string, unknown>) : sent;
  assert.equal(settings.temperature, 0.4);
  assert.equal(kind === 'google' ? settings.topP : settings.top_p, 0.7);
}
for (const kind of kinds) {
  test(`${kind}: HTTP user text parts concatenate literally and preserve string parity`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      for (const [content, expected] of [
        [textParts, combinedText],
        [combinedText, combinedText],
        [[{ type: 'text', text: '' }], ''],
      ] as const) {
        const f = httpFixture(kind);
        const response = await f.handler(httpRequest(path, content));
        assert.equal(response.status, 200);
        assertNative(kind, f.sent[0], expected);
        assert.equal(f.usage.length, 1);
        assert.doesNotMatch(JSON.stringify(f.audits), /private first|fixture-key/u);
      }
    }
  });
  test(`${kind}: actual SDK sends text arrays through both gateway base paths`, async () => {
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
          input(
            textParts,
            'user',
            base === '/api/v1',
          ) as OpenAI.ChatCompletionCreateParamsNonStreaming,
        );
        assert.equal(response.choices[0]?.message.content, 'reply');
        assertNative(kind, f.sent.at(-1), combinedText, base === '/api/v1');
      }
      assert.equal(f.usage.length, 2);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}
test('mixed/malformed/unsupported-role parts reject before routing with safe denial audit', async () => {
  const invalids: unknown[] = [
    [],
    [null],
    Array(2),
    [{ type: 'text' }],
    [{ type: 'text', text: null }],
    [{ type: 'text', text: 1 }],
    [{ type: 'text', text: 'private invalid', cache_control: {} }],
    [{ type: 'image_url', image_url: { url: 'https://untrusted.test/private' } }],
    [
      { type: 'text', text: 'private invalid' },
      { type: 'input_audio', input_audio: {} },
    ],
    [
      { type: 'text', text: 'private invalid' },
      { type: 'file', file: {} },
    ],
    [
      { type: 'text', text: 'private invalid' },
      { type: 'tool_result', content: 'x' },
    ],
    [[{ type: 'text', text: 'private invalid' }]],
  ];
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    for (const [role, content] of [
      ...invalids.map((content) => ['user', content] as const),
      ['tool', textParts] as const,
      ['unknown', textParts] as const,
    ]) {
      const f = httpFixture('openrouter');
      const response = await f.handler(httpRequest(path, content, role));
      assert.equal(response.status, 400);
      assert.equal(f.routes(), 0);
      assert.equal(f.secrets(), 0);
      assert.equal(f.usage.length, 0);
      assert.equal((f.audits[0] as { kind: string }).kind, 'request-denied');
      assert.doesNotMatch(await response.text(), /private invalid|untrusted.test/u);
      assert.doesNotMatch(JSON.stringify(f.audits), /private invalid|untrusted.test/u);
    }
  }
});
test('user text arrays retain IAM, limits and required audit denial across both paths', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    for (const kind of kinds) {
      for (const [options, status] of [
        [{ deny: true }, 403],
        [{ explicitDeny: true }, 403],
        [{ limit: true }, 429],
        [{ audit: true }, 503],
      ] as const) {
        const f = httpFixture(kind, options);
        assert.equal((await f.handler(httpRequest(path))).status, status);
        assert.equal(f.secrets(), 0);
        assert.deepEqual(f.sent, []);
        assert.equal(f.usage.length, 0);
      }
    }
  }
});
test('user text arrays preserve safe failed-attempt audit and usage', async () => {
  for (const kind of kinds) {
    const f = httpFixture(kind, { fail: true });
    const response = await f.handler(httpRequest('/api/v1/chat/completions'));
    assert.equal(response.status, 502);
    assert.equal(f.usage.length, 1);
    assert.doesNotMatch(await response.text(), /private first|fixture-key/u);
    assert.doesNotMatch(JSON.stringify(f.audits), /private first|fixture-key/u);
  }
});

function conversation(parts = true) {
  const encode = (text: string) =>
    parts
      ? [
          { type: 'text', text: '' },
          { type: 'text', text },
          { type: 'text', text: ' Ω ' },
        ]
      : `${text} Ω `;
  return {
    ...input(),
    messages: [
      { role: 'system', content: encode('private system') },
      { role: 'developer', content: encode('private developer') },
      { role: 'user', content: encode('private user') },
      { role: 'assistant', content: encode('private history') },
      { role: 'user', content: encode('private followup') },
    ],
  };
}
function conversationRequest(path: string, payload: unknown = conversation()) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
function assertConversation(kind: Kind, sent: Record<string, unknown> | undefined) {
  assert.ok(sent);
  const expected = conversation(false).messages;
  const instructions = `${expected[0]?.content}\n${expected[1]?.content}`;
  if (kind === 'google') {
    assert.deepEqual(sent.systemInstruction, { parts: [{ text: instructions }] });
    assert.deepEqual(
      sent.contents,
      expected.slice(2).map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })),
    );
  } else {
    assert.deepEqual(sent.messages, kind === 'anthropic' ? expected.slice(2) : expected);
    if (kind === 'anthropic') assert.equal(sent.system, instructions);
  }
  assert.equal(nativeLimit(kind, sent), 17);
}
for (const kind of kinds) {
  test(`${kind}: all supported roles accept exact text arrays with literal string parity`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      const f = httpFixture(kind);
      for (const parts of [true, false]) {
        assert.equal((await f.handler(conversationRequest(path, conversation(parts)))).status, 200);
        assertConversation(kind, f.sent.at(-1));
      }
      assert.deepEqual(f.sent[0], f.sent[1]);
      assert.equal(f.usage.length, 2);
      assert.doesNotMatch(
        JSON.stringify([f.audits, f.usage]),
        /private system|private developer|private history|fixture-key/u,
      );
    }
  });
  test(`${kind}: actual SDK sends instruction and assistant-history arrays`, async () => {
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
        const result = await sdk.chat.completions.create(
          conversation() as OpenAI.ChatCompletionCreateParamsNonStreaming,
        );
        assert.equal(result.choices[0]?.message.content, 'reply');
        assertConversation(kind, f.sent.at(-1));
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}
test('normalized instruction/history arrays remain captured during credential resolution', async () => {
  for (const kind of kinds) {
    const payload = conversation();
    const shared = payload.messages;
    const f = httpFixture(kind, {
      mutate: () => {
        shared[0] = { role: 'user', content: 'private replaced' };
        shared.splice(1);
      },
    });
    const req = conversationRequest('/api/v1/chat/completions', payload);
    Object.defineProperty(req, 'json', { value: async () => payload });
    assert.equal((await f.handler(req)).status, 200);
    assertConversation(kind, f.sent[0]);
  }
});
test('instruction/history parts reject malformed content and late instructions before routing', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    for (const role of ['system', 'developer', 'assistant']) {
      for (const content of [
        [],
        Array(2),
        [null],
        [{ type: 'text', text: 1 }],
        [{ type: 'text', text: 'private invalid', cache_control: {} }],
        [
          { type: 'text', text: 'private invalid' },
          { type: 'refusal', refusal: 'private refusal' },
        ],
        [{ type: 'image_url', image_url: { url: 'https://untrusted.test/private' } }],
      ]) {
        const f = httpFixture('openrouter');
        const payload = {
          ...input(),
          messages: [
            { role, content },
            { role: 'user', content: 'hi' },
          ],
        };
        assert.equal((await f.handler(conversationRequest(path, payload))).status, 400);
        assert.equal(f.routes(), 0);
        assert.equal(f.secrets(), 0);
        assert.doesNotMatch(
          JSON.stringify(f.audits),
          /private invalid|private refusal|untrusted.test/u,
        );
      }
    }
    for (const role of ['system', 'developer']) {
      const f = httpFixture('openrouter');
      assert.equal(
        (
          await f.handler(
            conversationRequest(path, {
              ...input(),
              messages: [
                { role: 'user', content: 'hi' },
                { role, content: textParts },
              ],
            }),
          )
        ).status,
        400,
      );
      assert.equal(f.routes(), 0);
      assert.equal(f.secrets(), 0);
    }
  }
});
test('instruction/history arrays retain denial and safe failed-attempt accounting', async () => {
  for (const kind of kinds) {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      for (const [options, status] of [
        [{ deny: true }, 403],
        [{ explicitDeny: true }, 403],
        [{ limit: true }, 429],
        [{ audit: true }, 503],
        [{ fail: true }, 502],
      ] as const) {
        const f = httpFixture(kind, options);
        const response = await f.handler(conversationRequest(path));
        assert.equal(response.status, status);
        assert.equal(f.sent.length, options.fail ? 1 : 0);
        assert.equal(f.usage.length, options.fail ? 1 : 0);
        assert.doesNotMatch(
          await response.text(),
          /private system|private developer|private history|fixture-key/u,
        );
        assert.doesNotMatch(
          JSON.stringify([f.audits, f.usage]),
          /private system|private developer|private history|fixture-key/u,
        );
      }
    }
  }
});

test('captured text-part values cross HTTP and all provider mappings without operational content', async () => {
  for (const kind of kinds)
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      let reads = 0;
      const part = Object.defineProperty({ type: 'text' }, 'text', {
        enumerable: true,
        get: () => {
          reads++;
          return reads === 1 ? 'private captured Ω' : 42;
        },
      });
      const payload = input([part]);
      const messages = normalizeClientTextMessages(payload.messages);
      const f = httpFixture(kind);
      const response = await f.handler(
        new Request('http://localhost' + path, {
          method: 'POST',
          headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, messages }),
        }),
      );
      assert.equal(response.status, 200);
      assert.equal(reads, 1);
      assertNative(kind, f.sent[0], 'private captured Ω');
      assert.equal(f.usage.length, 1);
      assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private captured|fixture-key/u);
    }
});
