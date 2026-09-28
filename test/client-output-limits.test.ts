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
for (const kind of kinds) {
  test(`${kind} maps valid max_tokens and preserves omission`, async () => {
    for (const value of [1, 17, undefined]) {
      const f = adapter(kind);
      await f.call(request(value));
      assert.equal(nativeLimit(kind, f.sent[0]), value ?? (kind === 'anthropic' ? 128 : undefined));
    }
  });
  test(`${kind} rejects invalid internal limits before secret or transport work`, async () => {
    for (const invalid of [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      NaN,
      Infinity,
      '10',
      null,
      true,
    ]) {
      const f = adapter(kind);
      await assert.rejects(
        f.call({ ...request(), max_tokens: invalid } as unknown as ChatRequest),
        (error: unknown) => {
          assert.equal((error as { possiblyBilled: boolean }).possiblyBilled, false);
          return true;
        },
      );
      assert.equal(f.secrets(), 0);
      assert.deepEqual(f.sent, []);
    }
  });
  test(`${kind} retains the output limit during secret resolution`, async () => {
    const source = { ...request(), max_tokens: 17 };
    const f = adapter(kind, undefined, () => {
      source.max_tokens = 0;
    });
    await f.call(source);
    assert.equal(nativeLimit(kind, f.sent[0]), 17);
  });
  if (kind !== 'openrouter') {
    test(`${kind} retains administrator cap on requested output`, async () => {
      for (const [supplied, expected] of [
        [1, 1],
        [32, 32],
        [64, 32],
      ]) {
        const f = adapter(kind, 32);
        await f.call(request(supplied));
        assert.equal(nativeLimit(kind, f.sent[0]), expected);
      }
    });
  }
}

function httpFixture(
  kind: Kind,
  options: { deny?: boolean; limit?: boolean; audit?: boolean; fail?: boolean } = {},
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
      statements: options.deny ? [] : [{ effect: 'Allow', actions: ['*'], resources: ['*'] }],
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
function httpRequest(path: string, maxTokens: unknown) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    body: JSON.stringify({ ...request(), max_tokens: maxTokens }),
  });
}
for (const kind of kinds) {
  test(`${kind} accepts max_tokens through both compatible HTTP paths and records usage`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      const f = httpFixture(kind);
      assert.equal((await f.handler(httpRequest(path, 17))).status, 200);
      assert.equal(nativeLimit(kind, f.sent[0]), 17);
      assert.equal(f.usage.length, 1);
      assert.ok(f.audits.length > 0);
    }
  });
}
test('invalid public max_tokens rejects with required metadata audit before route lookup', async () => {
  for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '10', null, true]) {
    const f = httpFixture('openrouter');
    const response = await f.handler(httpRequest('/api/v1/chat/completions', invalid));
    assert.equal(response.status, 400);
    assert.equal(f.routes(), 0);
    assert.equal(f.secrets(), 0);
    assert.equal(f.usage.length, 0);
    assert.equal((f.audits[0] as { kind: string }).kind, 'request-denied');
  }
});
test('output limits preserve IAM, request limits and required audit denial', async () => {
  for (const kind of ['openai', 'openrouter'] as const) {
    for (const [options, status] of [
      [{ deny: true }, 403],
      [{ limit: true }, 429],
      [{ audit: true }, 503],
    ] as const) {
      const f = httpFixture(kind, options);
      assert.equal((await f.handler(httpRequest('/api/v1/chat/completions', 17))).status, status);
      assert.equal(f.secrets(), 0);
      assert.deepEqual(f.sent, []);
    }
  }
});
test('provider failures with output limits retain safe error and usage behavior', async () => {
  for (const kind of kinds) {
    const f = httpFixture(kind, { fail: true });
    const response = await f.handler(httpRequest('/api/v1/chat/completions', 17));
    assert.equal(response.status, 502);
    assert.match(await response.text(), /upstream_failed/u);
    assert.equal(f.usage.length, 1);
  }
});
