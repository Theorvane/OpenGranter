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
      ? new Response('private fixture upstream error', { status: 500 })
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
function aliasRequest(fields: Record<string, unknown>): ChatRequest {
  return { ...request(), ...fields } as unknown as ChatRequest;
}
function httpRequest(path: string, fields: Record<string, unknown>) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    body: JSON.stringify(aliasRequest(fields)),
  });
}
for (const kind of kinds) {
  test(`${kind} resolves alias-only and equal paired maxima`, async () => {
    for (const fields of [
      { max_completion_tokens: 17 },
      { max_tokens: 17, max_completion_tokens: 17 },
      { max_completion_tokens: 1 },
    ]) {
      const f = adapter(kind);
      await f.call(aliasRequest(fields));
      assert.equal(nativeLimit(kind, f.sent[0]), fields.max_completion_tokens);
      assert.equal(f.sent[0]?.max_completion_tokens, undefined, 'No duplicate native fields');
    }
  });
  test(`${kind} rejects invalid or conflicting alias values before secrets`, async () => {
    const invalids = [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '10', null, true];
    for (const fields of [
      ...invalids.map((max_completion_tokens) => ({ max_completion_tokens })),
      ...invalids.map((max_tokens) => ({ max_tokens, max_completion_tokens: 17 })),
      { max_tokens: 17, max_completion_tokens: 18 },
      { max_tokens: 18, max_completion_tokens: 17 },
    ]) {
      const f = adapter(kind);
      await assert.rejects(f.call(aliasRequest(fields)), (error: unknown) => {
        assert.equal((error as { possiblyBilled: boolean }).possiblyBilled, false);
        return true;
      });
      assert.equal(f.secrets(), 0);
      assert.deepEqual(f.sent, []);
    }
  });
  test(`${kind} captures the resolved alias before credential lookup`, async () => {
    for (const paired of [false, true]) {
      const source = {
        ...request(),
        max_completion_tokens: 17,
        ...(paired ? { max_tokens: 17 } : {}),
      };
      const f = adapter(kind, undefined, () => {
        source.max_completion_tokens = 0;
        source.max_tokens = 999;
      });
      await f.call(source as ChatRequest);
      assert.equal(nativeLimit(kind, f.sent[0]), 17);
    }
  });
  if (kind !== 'openrouter') {
    test(`${kind} applies administrator caps to completion aliases`, async () => {
      for (const [value, expected] of [
        [1, 1],
        [32, 32],
        [64, 32],
      ] as const) {
        const f = adapter(kind, 32);
        await f.call(aliasRequest({ max_completion_tokens: value }));
        assert.equal(nativeLimit(kind, f.sent[0]), expected);
      }
    });
  }
  test(`${kind} accepts alias through both HTTP paths with usage attribution`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      const f = httpFixture(kind);
      const response = await f.handler(httpRequest(path, { max_completion_tokens: 17 }));
      assert.equal(response.status, 200);
      assert.equal(nativeLimit(kind, f.sent[0]), 17);
      assert.equal(f.usage.length, 1);
      assert.ok(f.audits.length > 0);
    }
  });
}
test('invalid and conflicting public maxima are audited before route work', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    for (const fields of [
      { max_completion_tokens: 0 },
      { max_completion_tokens: null },
      { max_completion_tokens: 'private fixture invalid value' },
      { max_tokens: 0, max_completion_tokens: 17 },
      { max_tokens: 17, max_completion_tokens: 18 },
    ]) {
      const f = httpFixture('openrouter');
      const response = await f.handler(httpRequest(path, fields));
      assert.equal(response.status, 400);
      const error = await response.text();
      assert.doesNotMatch(error, /private fixture/u);
      assert.equal(f.routes(), 0);
      assert.equal(f.secrets(), 0);
      assert.equal(f.usage.length, 0);
      assert.equal((f.audits[0] as { kind: string }).kind, 'request-denied');
      assert.doesNotMatch(JSON.stringify(f.audits), /private fixture/u);
    }
  }
});
test('completion aliases preserve IAM, limits and required audit enforcement', async () => {
  for (const kind of ['openai', 'openrouter'] as const) {
    for (const [options, status] of [
      [{ deny: true }, 403],
      [{ explicitDeny: true }, 403],
      [{ limit: true }, 429],
      [{ audit: true }, 503],
    ] as const) {
      const f = httpFixture(kind, options);
      assert.equal(
        (await f.handler(httpRequest('/api/v1/chat/completions', { max_completion_tokens: 17 })))
          .status,
        status,
      );
      assert.equal(f.secrets(), 0);
      assert.deepEqual(f.sent, []);
    }
  }
});
test('upstream failures with completion aliases retain safe errors and accounting', async () => {
  for (const kind of kinds) {
    const f = httpFixture(kind, { fail: true });
    const response = await f.handler(
      httpRequest('/api/v1/chat/completions', { max_completion_tokens: 17 }),
    );
    assert.equal(response.status, 502);
    const message = await response.text();
    assert.match(message, /upstream_failed/u);
    assert.doesNotMatch(message, /private fixture/u);
    assert.equal(f.usage.length, 1);
  }
});
test('all adapters combine completion aliases with stop without losing either setting', async () => {
  for (const kind of kinds) {
    const f = httpFixture(kind);
    const response = await f.handler(
      httpRequest('/api/v1/chat/completions', {
        max_completion_tokens: 17,
        stop: ['finish marker'],
      }),
    );
    assert.equal(response.status, 200);
    const sent = f.sent[0];
    assert.ok(sent);
    assert.equal(nativeLimit(kind, sent), 17);
    const stop =
      kind === 'google'
        ? (sent.generationConfig as Record<string, unknown>).stopSequences
        : kind === 'anthropic'
          ? sent.stop_sequences
          : sent.stop;
    assert.deepEqual(stop, ['finish marker']);
    assert.equal(f.usage.length, 1);
  }
});
