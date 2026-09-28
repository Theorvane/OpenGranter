import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type ChatRequest, createChatHandler } from '../src/gateway/chat-handler.ts';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import { createOpenRouterChatInvoker } from '../src/providers/openrouter-chat.ts';

const kinds = ['openai', 'anthropic', 'google', 'openrouter'] as const;
type Kind = (typeof kinds)[number];
function completion(kind: Kind) {
  if (kind === 'anthropic')
    return {
      id: 'completion',
      content: [{ type: 'text', text: 'reply' }],
      stop_reason: 'stop_sequence',
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
function request(stop?: unknown): ChatRequest {
  return {
    model: 'chat',
    messages: [{ role: 'user', content: 'private-prompt-fixture' }],
    max_tokens: 17,
    ...(stop === undefined ? {} : { stop }),
  } as ChatRequest;
}
function fixture(
  kind: Kind,
  options: {
    mutate?: () => void;
    deny?: boolean;
    limited?: boolean;
    auditFails?: boolean;
    upstreamFails?: boolean;
  } = {},
) {
  const sent: Record<string, unknown>[] = [];
  const audits: unknown[] = [];
  const usage: unknown[] = [];
  let secrets = 0;
  const resolveSecret = async () => {
    secrets++;
    options.mutate?.();
    return 'fixture-key';
  };
  const fetcher: typeof fetch = async (_, init) => {
    sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return options.upstreamFails
      ? new Response('private-upstream-fixture', { status: 500 })
      : Response.json(completion(kind));
  };
  const candidate = {
    id: 'candidate',
    kind: kind === 'openrouter' ? ('delegated' as const) : ('managed' as const),
    providerId: 'provider',
    upstreamModelId: 'model',
  };
  const direct =
    kind === 'openrouter'
      ? undefined
      : createDirectChatInvoker({
          registrations: [
            {
              providerId: 'provider',
              kind,
              credentialRef: 'secret/reference',
              ...(kind === 'anthropic' ? { maxOutputTokens: 128 } : {}),
            },
          ],
          resolveSecret,
          fetcher,
        });
  const delegated = createOpenRouterChatInvoker({
    credentialRef: 'secret/reference',
    resolveSecret,
    fetcher,
  });
  const call = (input: ChatRequest) =>
    direct
      ? direct(candidate, input)
      : delegated({ upstreamModelId: 'model', authorizedProviderSlugs: ['provider'] }, input);
  const handler = createChatHandler({
    newRequestId: () => 'request',
    authenticate: async () => ({
      id: 'user',
      active: true,
      credentialId: 'credential',
      policyVersions: [],
      statements: options.deny ? [] : [{ effect: 'Allow', actions: ['*'], resources: ['*'] }],
    }),
    resolveRoute: async () =>
      kind === 'openrouter'
        ? {
            kind: 'delegated',
            version: 'v1',
            credentialRef: 'secret/reference',
            candidates: [candidate],
          }
        : { version: 'v1', candidates: [candidate] },
    checkLimit: async () => !options.limited,
    resolveSecret,
    writeAudit: async (event) => {
      if (options.auditFails) throw new Error('private-audit-fixture');
      audits.push(event);
    },
    writeUsage: async (record) => {
      usage.push(record);
    },
    invokeDirect: async (_, input) => call(input),
    invokeOpenRouter: async (_, __, input) => call(input),
    resolveVerifiedProviderSlug: async () => 'provider',
  });
  return { call, handler, sent, audits, usage, secrets: () => secrets };
}
function native(kind: Kind, captured: Record<string, unknown> | undefined) {
  assert.ok(captured, 'Expected an upstream request');
  const config = captured.generationConfig as Record<string, unknown> | undefined;
  return {
    stop:
      kind === 'google'
        ? config?.stopSequences
        : kind === 'anthropic'
          ? captured.stop_sequences
          : captured.stop,
    max: kind === 'google' ? config?.maxOutputTokens : captured.max_tokens,
  };
}
function httpRequest(path: string, stop: unknown) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    body: JSON.stringify(request(stop)),
  });
}
for (const kind of kinds) {
  test(`${kind} preserves literal stop values, defaults and output-limit combination`, async () => {
    for (const stop of ['終\n', ['first', 'second', 'third', 'fourth'], [], null, undefined]) {
      const f = fixture(kind);
      await f.call(request(stop));
      const expected =
        stop === null
          ? undefined
          : typeof stop === 'string' && (kind === 'google' || kind === 'anthropic')
            ? [stop]
            : stop;
      assert.deepEqual(native(kind, f.sent[0]), { stop: expected, max: 17 });
    }
  });
  test(`${kind} rejects malformed and oversized internal stop before secrets`, async () => {
    for (const stop of [
      1,
      true,
      {},
      [1],
      ['valid', null],
      new Array(1),
      ['1', '2', '3', '4', '5'],
    ]) {
      const f = fixture(kind);
      await assert.rejects(f.call(request(stop)), (error: unknown) => {
        assert.equal((error as { possiblyBilled: boolean }).possiblyBilled, false);
        return true;
      });
      assert.equal(f.secrets(), 0);
      assert.deepEqual(f.sent, []);
    }
  });
  test(`${kind} captures array and object stop values before secret await`, async () => {
    const original = ['first', 'second'];
    const source = { ...request(), stop: original };
    const f = fixture(kind, {
      mutate: () => {
        original[0] = 'changed';
        original.push('added');
        source.stop = ['replaced'];
      },
    });
    await f.call(source);
    assert.deepEqual(native(kind, f.sent[0]).stop, ['first', 'second']);
    assert.deepEqual(original, ['changed', 'second', 'added']);
  });
  test(`${kind} supports stop through both HTTP paths with usage and no content audit`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      const f = fixture(kind);
      const response = await f.handler(httpRequest(path, 'private-stop-fixture'));
      assert.equal(response.status, 200);
      assert.deepEqual(
        native(kind, f.sent[0]).stop,
        kind === 'google' || kind === 'anthropic'
          ? ['private-stop-fixture']
          : 'private-stop-fixture',
      );
      assert.equal(f.usage.length, 1);
      assert.equal(
        JSON.stringify([...f.audits, ...f.usage]).includes('private-stop-fixture'),
        false,
      );
      assert.equal(
        JSON.stringify([...f.audits, ...f.usage]).includes('private-prompt-fixture'),
        false,
      );
    }
  });
}
test('invalid public stop returns numeric request denial before credential work', async () => {
  for (const stop of [1, {}, [null], ['1', '2', '3', '4', '5']]) {
    const f = fixture('openrouter');
    const response = await f.handler(httpRequest('/api/v1/chat/completions', stop));
    assert.equal(response.status, 400);
    const body = (await response.json()) as {
      error: { code: number; metadata: { opengranter_code: string } };
    };
    assert.equal(body.error.code, 400);
    assert.equal(body.error.metadata.opengranter_code, 'invalid_request');
    assert.equal(f.secrets(), 0);
    assert.equal((f.audits[0] as { kind: string }).kind, 'request-denied');
  }
});
test('stop preserves IAM, limits, mandatory audit and provider failure accounting', async () => {
  for (const kind of ['openai', 'openrouter'] as const) {
    for (const [options, status] of [
      [{ deny: true }, 403],
      [{ limited: true }, 429],
      [{ auditFails: true }, 503],
      [{ upstreamFails: true }, 502],
    ] as const) {
      const f = fixture(kind, options);
      const response = await f.handler(
        httpRequest('/api/v1/chat/completions', 'private-stop-fixture'),
      );
      assert.equal(response.status, status);
      assert.equal((await response.text()).includes('private'), false);
      assert.equal(f.secrets(), status === 502 ? 1 : 0);
      assert.equal(f.usage.length, status === 502 ? 1 : 0);
    }
  }
});
