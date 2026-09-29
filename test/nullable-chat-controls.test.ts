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
const nullControls = {
  max_tokens: null,
  max_completion_tokens: null,
  temperature: null,
  top_p: null,
};
function nullableRequest(fields: Record<string, unknown> = nullControls): ChatRequest {
  return { ...request(), ...fields } as unknown as ChatRequest;
}
function httpRequest(path: string, fields: Record<string, unknown> = nullControls) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    body: JSON.stringify(nullableRequest(fields)),
  });
}
function assertSamplingAbsent(kind: Kind, sent: Record<string, unknown> | undefined) {
  assert.ok(sent);
  const settings =
    kind === 'google' ? (sent.generationConfig as Record<string, unknown> | undefined) : sent;
  assert.equal(settings?.temperature, undefined);
  assert.equal(settings?.top_p, undefined);
  assert.equal(settings?.topP, undefined);
  assert.doesNotMatch(JSON.stringify(sent), /:null/u);
}
for (const kind of kinds) {
  test(`${kind}: null controls follow omission and numeric counterpart still receives cap`, async () => {
    for (const fields of [
      nullControls,
      { ...nullControls, max_completion_tokens: 17 },
      { ...nullControls, max_tokens: 17 },
    ]) {
      const f = adapter(kind, 9);
      await f.call(nullableRequest(fields));
      assertSamplingAbsent(kind, f.sent[0]);
      const supplied = fields.max_tokens !== null || fields.max_completion_tokens !== null;
      assert.equal(
        nativeLimit(kind, f.sent[0]),
        supplied ? (kind === 'openrouter' ? 17 : 9) : kind === 'anthropic' ? 9 : undefined,
      );
      assert.equal(f.secrets(), 1);
    }
  });
  test(`${kind}: null controls are captured before secret lookup mutation`, async () => {
    const input = { ...request(), ...nullControls };
    const f = adapter(kind, undefined, () =>
      Object.assign(input, {
        max_tokens: 17,
        max_completion_tokens: 18,
        temperature: 0.4,
        top_p: 0.7,
      }),
    );
    await f.call(input as unknown as ChatRequest);
    assertSamplingAbsent(kind, f.sent[0]);
    assert.equal(nativeLimit(kind, f.sent[0]), kind === 'anthropic' ? 128 : undefined);
  });
  test(`${kind}: both HTTP paths normalize null and retain valid combined settings`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      for (const fields of [
        nullControls,
        { ...nullControls, max_completion_tokens: 17, temperature: 0, top_p: 0, stop: ['marker'] },
        { ...nullControls, max_tokens: 17 },
      ]) {
        const f = httpFixture(kind);
        const response = await f.handler(httpRequest(path, fields));
        assert.equal(response.status, 200);
        assert.equal(f.usage.length, 1);
        assert.equal(
          nativeLimit(kind, f.sent[0]),
          typeof fields.max_tokens === 'number' || typeof fields.max_completion_tokens === 'number'
            ? 17
            : kind === 'anthropic'
              ? 128
              : undefined,
        );
        assert.ok(f.audits.length > 0);
        assert.doesNotMatch(JSON.stringify(f.sent[0]), /:null/u);
        if (fields.temperature === null) assertSamplingAbsent(kind, f.sent[0]);
        else {
          const sent =
            kind === 'google'
              ? (f.sent[0]?.generationConfig as Record<string, unknown>)
              : f.sent[0];
          assert.equal(sent?.temperature, 0);
          assert.equal(kind === 'google' ? sent?.topP : sent?.top_p, 0);
        }
      }
    }
  });
}
test('nullable controls preserve implicit/explicit IAM, limits and required audit denial', async () => {
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
test('null cannot hide invalid paired fields or relax n and stream restrictions', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    for (const fields of [
      { ...nullControls, max_tokens: 0 },
      { ...nullControls, max_completion_tokens: 'private invalid' },
      { ...nullControls, max_tokens: 17, max_completion_tokens: 18 },
      { ...nullControls, temperature: {} },
      { ...nullControls, top_p: [] },
      { ...nullControls, n: null },
      { ...nullControls, stream: null },
    ]) {
      const f = httpFixture('openrouter');
      const response = await f.handler(httpRequest(path, fields));
      assert.equal(response.status, 400);
      assert.equal(f.routes(), 0);
      assert.equal(f.secrets(), 0);
      assert.equal(f.usage.length, 0);
      assert.equal((f.audits[0] as { kind: string }).kind, 'request-denied');
      assert.doesNotMatch(await response.text(), /private invalid/u);
    }
  }
});
test('nullable controls preserve safe upstream failure audit and failed-attempt usage', async () => {
  for (const kind of kinds) {
    const f = httpFixture(kind, { fail: true });
    const response = await f.handler(httpRequest('/api/v1/chat/completions'));
    assert.equal(response.status, 502);
    assert.equal(f.usage.length, 1);
    assert.match(await response.text(), /upstream_failed/u);
    assert.doesNotMatch(JSON.stringify(f.audits), /private fixture|fixture-key/u);
  }
});

test('null adapter fields do not hide malformed numeric aliases or sampling values', async () => {
  for (const kind of kinds) {
    for (const fields of [
      { ...nullControls, max_tokens: 0 },
      { ...nullControls, max_completion_tokens: 'private invalid' },
      { ...nullControls, max_tokens: 17, max_completion_tokens: 18 },
      { ...nullControls, temperature: true },
      { ...nullControls, top_p: {} },
    ]) {
      const f = adapter(kind);
      await assert.rejects(f.call(nullableRequest(fields)));
      assert.equal(f.secrets(), 0);
      assert.deepEqual(f.sent, []);
    }
  }
});
