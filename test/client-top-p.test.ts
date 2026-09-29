import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type ChatRequest, createChatHandler } from '../src/gateway/chat-handler.ts';
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
function samplingRequest(value: unknown): ChatRequest {
  return {
    ...request(),
    ...(value === undefined ? {} : { top_p: value }),
  } as unknown as ChatRequest;
}
function nativeTopP(kind: Kind, sent: Record<string, unknown> | undefined): unknown {
  assert.ok(sent, 'Expected a captured upstream request');
  return kind === 'google'
    ? (sent.generationConfig as Record<string, unknown> | undefined)?.topP
    : sent.top_p;
}
function httpRequest(path: string, value: unknown) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    body: JSON.stringify({
      ...samplingRequest(value),
      max_completion_tokens: 17,
      stop: ['marker'],
    }),
  });
}
for (const kind of kinds) {
  test(`${kind} maps top_p bounds/fractions and leaves omission defaults untouched`, async () => {
    for (const value of [0, 0.37, 1, undefined]) {
      const f = adapter(kind);
      await f.call(samplingRequest(value));
      assert.equal(nativeTopP(kind, f.sent[0]), value);
      if (value === undefined && kind === 'google')
        assert.equal(f.sent[0]?.generationConfig, undefined);
    }
  });
  test(`${kind} rejects malformed top_p before credential lookup`, async () => {
    for (const invalid of [-0.01, 1.01, NaN, Infinity, -Infinity, '0.7', true, {}, []]) {
      const f = adapter(kind);
      await assert.rejects(f.call(samplingRequest(invalid)), (error: unknown) => {
        assert.equal((error as { possiblyBilled: boolean }).possiblyBilled, false);
        return true;
      });
      assert.equal(f.secrets(), 0);
      assert.deepEqual(f.sent, []);
    }
  });
  test(`${kind} captures top_p before asynchronous secret lookup`, async () => {
    for (const value of [0, 0.37, 1]) {
      const source = { ...request(), top_p: value };
      const f = adapter(kind, undefined, () => {
        source.top_p = 99;
      });
      await f.call(source as ChatRequest);
      assert.equal(nativeTopP(kind, f.sent[0]), value);
    }
  });
  test(`${kind} combines top_p, stop and output maxima across HTTP paths`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      const f = httpFixture(kind);
      assert.equal((await f.handler(httpRequest(path, 0.37))).status, 200);
      const sent = f.sent[0];
      assert.ok(sent);
      assert.equal(nativeTopP(kind, sent), 0.37);
      assert.equal(nativeLimit(kind, sent), 17);
      const stop =
        kind === 'google'
          ? (sent.generationConfig as Record<string, unknown>).stopSequences
          : kind === 'anthropic'
            ? sent.stop_sequences
            : sent.stop;
      assert.deepEqual(stop, ['marker']);
      assert.equal(f.usage.length, 1);
      assert.ok(f.audits.length > 0);
      assert.doesNotMatch(JSON.stringify(f.audits), /marker|fixture-key/u);
    }
  });
  if (kind !== 'openrouter') {
    test(`${kind} retains administrator output cap alongside top_p and stop`, async () => {
      const f = adapter(kind, 32);
      await f.call({ ...samplingRequest(0.37), max_tokens: 64, stop: ['marker'] } as ChatRequest);
      assert.equal(nativeTopP(kind, f.sent[0]), 0.37);
      assert.equal(nativeLimit(kind, f.sent[0]), 32);
    });
  }
}
test('invalid public top_p is audited before routes without leaking input', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    for (const value of [-0.01, 1.01, 'private fixture invalid top_p', true, {}, []]) {
      const f = httpFixture('openrouter');
      const response = await f.handler(httpRequest(path, value));
      assert.equal(response.status, 400);
      assert.equal(f.routes(), 0);
      assert.equal(f.secrets(), 0);
      assert.equal(f.usage.length, 0);
      assert.equal((f.audits[0] as { kind: string }).kind, 'request-denied');
      assert.doesNotMatch(await response.text(), /private fixture/u);
      assert.doesNotMatch(JSON.stringify(f.audits), /private fixture/u);
    }
  }
});
test('top_p retains implicit/explicit denial, limits and required audit enforcement', async () => {
  for (const kind of ['openai', 'openrouter'] as const) {
    for (const [options, status] of [
      [{ deny: true }, 403],
      [{ explicitDeny: true }, 403],
      [{ limit: true }, 429],
      [{ audit: true }, 503],
    ] as const) {
      const f = httpFixture(kind, options);
      assert.equal((await f.handler(httpRequest('/api/v1/chat/completions', 0.37))).status, status);
      assert.equal(f.secrets(), 0);
      assert.deepEqual(f.sent, []);
    }
  }
});
test('model-specific top_p rejection preserves safe errors and per-attempt accounting', async () => {
  for (const kind of kinds) {
    const f = httpFixture(kind, { fail: true });
    const response = await f.handler(httpRequest('/api/v1/chat/completions', 0.37));
    assert.equal(response.status, 502);
    assert.equal(f.usage.length, 1);
    const message = await response.text();
    assert.match(message, /upstream_failed/u);
    assert.doesNotMatch(message, /private fixture|fixture-key/u);
    assert.doesNotMatch(JSON.stringify(f.audits), /private fixture|fixture-key/u);
  }
});
