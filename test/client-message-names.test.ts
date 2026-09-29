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
const roles = ['system', 'developer', 'user', 'assistant'] as const;
function messages(
  role: (typeof roles)[number],
  name?: unknown,
  parts = false,
): { role: string; content: unknown; name?: unknown }[] {
  const message = {
    role,
    content: parts
      ? [
          { type: 'text', text: 'private' },
          { type: 'text', text: ' prompt' },
        ]
      : 'private prompt',
    ...(name === undefined ? {} : { name }),
  };
  if (role === 'system' || role === 'developer')
    return [message, { role: 'user', content: 'question' }];
  if (role === 'assistant')
    return [{ role: 'user', content: 'question' }, message, { role: 'user', content: 'continue' }];
  return [message];
}
function input(conversation: unknown) {
  return {
    model: 'chat',
    messages: conversation,
    max_tokens: 17,
    temperature: 0.4,
    top_p: 0.7,
    n: 1,
    stop: ['marker'],
    response_format: { type: 'text' },
  };
}
function request(path: string, conversation: unknown) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    body: JSON.stringify(input(conversation)),
  });
}
function assertNamed(sent: Record<string, unknown> | undefined, role: string, name: unknown) {
  assert.ok(sent);
  const conversation = sent.messages as { role: string; content: string; name?: string }[];
  const message = conversation.find((message) => message.role === role);
  assert.ok(message);
  assert.equal(message.name, name);
  assert.equal(message.content, 'private prompt');
  assert.equal(sent.max_tokens, 17);
  assert.equal(sent.temperature, 0.4);
  assert.equal(sent.top_p, 0.7);
  assert.deepEqual(sent.stop, ['marker']);
}
for (const kind of kinds) {
  test(`${kind}: names preserve every supported text role/default/string value on both paths`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
      for (const role of roles)
        for (const name of [
          undefined,
          '',
          'Assistant Config',
          '사용자 이름',
          'caller-private-name',
          'x'.repeat(100),
        ])
          for (const parts of [false, true]) {
            const f = httpFixture(kind),
              unsupported = name !== undefined && (kind === 'anthropic' || kind === 'google');
            const response = await f.handler(request(path, messages(role, name, parts)));
            assert.equal(response.status, unsupported ? 502 : 200);
            assert.equal(f.secrets(), unsupported ? 0 : 1);
            assert.equal(f.sent.length, unsupported ? 0 : 1);
            assert.equal(f.usage.length, unsupported ? 0 : 1);
            if (!unsupported) {
              assert.equal(nativeLimit(kind, f.sent[0]), 17);
              if (kind === 'openai' || kind === 'openrouter') assertNamed(f.sent[0], role, name);
              assert.equal((f.usage[0] as { principalId: string }).principalId, 'user');
            }
            assert.doesNotMatch(
              JSON.stringify([f.audits, f.usage]),
              /caller-private-name|private prompt|fixture-key/u,
            );
          }
  });
  test(`${kind}: actual SDK named text requests pass or fail safely on both bases`, async () => {
    const f = httpFixture(kind),
      server = createNodeRequestServer(f.handler);
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
            input(
              messages('user', 'caller-private-name'),
            ) as OpenAI.ChatCompletionCreateParamsNonStreaming,
          );
        if (kind === 'anthropic' || kind === 'google')
          await assert.rejects(
            call,
            (error) =>
              error instanceof OpenAI.APIError &&
              error.status === 502 &&
              !error.message.includes('caller-private-name'),
          );
        else {
          assert.equal((await call()).choices[0]?.message.content, 'reply');
          assertNamed(f.sent.at(-1), 'user', 'caller-private-name');
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}
const invalids: readonly unknown[] = [null, true, 0, [], {}, { toString: 'caller-private-name' }];
test('malformed names reject before routing and native secrets with safe audit/errors', async () => {
  for (const role of roles)
    for (const name of invalids) {
      for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
        const f = httpFixture('openrouter'),
          response = await f.handler(request(path, messages(role, name)));
        assert.equal(response.status, 400);
        assert.equal(f.routes(), 0);
        assert.equal(f.secrets(), 0);
        assert.equal(f.usage.length, 0);
        assert.doesNotMatch(await response.text(), /caller-private-name|private prompt/u);
        assert.doesNotMatch(JSON.stringify(f.audits), /caller-private-name|private prompt/u);
      }
      for (const kind of kinds) {
        const f = adapter(kind);
        await assert.rejects(
          () => f.call(input(messages(role, name)) as unknown as ChatRequest),
          (error) =>
            error instanceof Error && 'possiblyBilled' in error && error.possiblyBilled === false,
        );
        assert.equal(f.secrets(), 0);
        assert.equal(f.sent.length, 0);
      }
    }
});
test('named native snapshots retain pre-await name/content and reject unsupported providers before secrets', async () => {
  for (const kind of kinds)
    for (const role of roles) {
      const conversation = messages(role, 'caller-private-name');
      const named = conversation.find((message) => message.role === role);
      assert.ok(named);
      const f = adapter(kind, undefined, () => {
        named.name = 'changed';
        named.content = 'changed';
      });
      const call = () => f.call(input(conversation) as unknown as ChatRequest);
      if (kind === 'anthropic' || kind === 'google') {
        await assert.rejects(call);
        assert.equal(f.secrets(), 0);
        assert.equal(f.sent.length, 0);
      } else {
        await call();
        assertNamed(f.sent[0], role, 'caller-private-name');
      }
    }
});
test('names retain exact message keys and instruction ordering', async () => {
  const bad = [
    [{ role: 'user', content: 'hello', name: 'caller-private-name', unknown: true }],
    [
      { role: 'user', content: 'hello' },
      { role: 'system', content: 'late', name: 'caller-private-name' },
    ],
  ];
  for (const conversation of bad) {
    const f = httpFixture('openrouter');
    assert.equal((await f.handler(request('/api/v1/chat/completions', conversation))).status, 400);
    assert.equal(f.routes(), 0);
    assert.equal(f.secrets(), 0);
  }
});
test('names never override principal authority, limits or required audit', async () => {
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
          (await f.handler(request(path, messages('user', 'administrator')))).status,
          status,
        );
        assert.equal(f.secrets(), 0);
        assert.equal(f.sent.length, 0);
        assert.equal(f.usage.length, 0);
      }
});
test('named conversations retain safe failed-provider usage and authenticated attribution', async () => {
  for (const kind of ['openai', 'openrouter'] as const)
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      const f = httpFixture(kind, { fail: true }),
        response = await f.handler(request(path, messages('user', 'caller-private-name')));
      assert.equal(response.status, 502);
      assert.equal(f.usage.length, 1);
      assert.equal((f.usage[0] as { principalId: string }).principalId, 'user');
      assert.doesNotMatch(await response.text(), /caller-private-name|private prompt|fixture-key/u);
      assert.doesNotMatch(
        JSON.stringify([f.audits, f.usage]),
        /caller-private-name|private prompt|fixture-key/u,
      );
    }
});
