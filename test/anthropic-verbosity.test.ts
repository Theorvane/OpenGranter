import assert from 'node:assert/strict';
import { test } from 'node:test';
import OpenAI from 'openai';
import { type ChatRequest, createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import { createOpenRouterChatInvoker } from '../src/providers/openrouter-chat.ts';
import { createOpenRouterTextStreamInvoker } from '../src/providers/openrouter-stream.ts';

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
function adapter(
  kind: Kind,
  cap?: number,
  mutate?: () => void,
  transportFails = false,
  thinking = false,
) {
  const sent: Record<string, unknown>[] = [];
  let secrets = 0;
  const resolveSecret = async () => {
    secrets++;
    mutate?.();
    return 'fixture-key';
  };
  const fetcher: typeof fetch = async (_, init) => {
    sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (kind === 'anthropic') {
      assert.equal(new Headers(init?.headers).get('anthropic-version'), '2023-06-01');
      assert.equal(new Headers(init?.headers).has('anthropic-beta'), false);
    }
    const requestBody = sent.at(-1);
    if (!transportFails && requestBody?.stream) {
      const chunk = (delta: object, finish_reason: string | null, extra: object = {}) =>
        'data: ' +
        JSON.stringify({
          id: 'gen',
          created: 1,
          object: 'chat.completion.chunk',
          model: 'model',
          choices: [{ index: 0, delta, finish_reason }],
          ...extra,
        }) +
        '\n\n';
      return new Response(
        chunk({ content: 'reply' }, null) +
          chunk({}, 'stop') +
          chunk({}, 'stop', { usage: { prompt_tokens: 2, completion_tokens: 1 } }) +
          'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }
    return transportFails
      ? new Response('private fixture unsupported top_p error', { status: 400 })
      : Response.json(
          thinking
            ? {
                ...body(kind),
                content: [
                  { type: 'thinking', thinking: 'private thought', signature: 'private signature' },
                  { type: 'text', text: 'reply' },
                ],
              }
            : body(kind),
        );
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
  const stream = createOpenRouterTextStreamInvoker({
    credentialRef: 'secret/reference',
    resolveSecret,
    fetcher,
  });
  return {
    stream,
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
    thinking?: boolean;
    mutate?: () => void;
  } = {},
) {
  const f = adapter(kind, undefined, options.mutate, options.fail, options.thinking);
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
      if (
        options.audit ||
        (options.outcomeAudit && (event.kind === 'delegated-attempt' || event.kind === 'attempt'))
      )
        throw new Error('private fixture');
      audits.push(event);
    },
    writeUsage: async (record) => {
      if (options.ledger) throw new Error('private ledger');
      usage.push(record);
    },
    invokeDirect: async (_, chat) => f.call(chat),
    invokeOpenRouter: async (_, __, chat) => f.call(chat),
    invokeOpenRouterTextStream: (_ref, ...args) => f.stream(...args),
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

function effort(sent: Record<string, unknown> | undefined) {
  return (sent?.output_config as { effort?: unknown } | undefined)?.effort;
}
test('direct Anthropic maps exact verbosity to effort on both HTTP bases without injecting defaults', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    for (const verbosity of [undefined, null, 'low', 'medium', 'high', 'xhigh', 'max']) {
      const f = httpFixture('anthropic');
      const response = await f.handler(request(path, { verbosity }));
      assert.equal(response.status, 200);
      assert.equal(effort(f.sent[0]), verbosity ?? undefined);
      assert.equal(
        Object.hasOwn(f.sent[0] ?? {}, 'output_config'),
        verbosity !== undefined && verbosity !== null,
      );
      assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'verbosity'), false);
      assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'thinking'), false);
      assert.equal(f.sent[0]?.max_tokens, 17);
      assert.equal(f.sent[0]?.temperature, 0.4);
      assert.equal(f.sent[0]?.top_p, 0.7);
      assert.deepEqual(f.sent[0]?.stop_sequences, ['marker']);
      assert.equal(f.usage.length, 1);
      assert.doesNotMatch(
        JSON.stringify([f.audits, f.usage]),
        /verbosity|output_config|private|fixture-key/u,
      );
    }
  }
});
test('Anthropic effort captures once before credentials and preserves maximum level', async () => {
  const mutable = input({ verbosity: 'max' });
  const f = adapter('anthropic', undefined, () => Object.assign(mutable, { verbosity: 'low' }));
  await f.call(mutable as unknown as ChatRequest);
  assert.deepEqual(f.sent[0]?.output_config, { effort: 'max' });
  let reads = 0;
  const getter = Object.defineProperty(input(), 'verbosity', {
    get: () => (++reads === 1 ? 'xhigh' : 'private invalid'),
  });
  const observed = adapter('anthropic');
  await observed.call(getter as unknown as ChatRequest);
  assert.equal(effort(observed.sent[0]), 'xhigh');
  assert.equal(reads, 1);
});
test('Anthropic verbosity-only request preserves registration output cap and instruction translation', async () => {
  const f = adapter('anthropic', 128);
  await f.call({
    model: 'chat',
    messages: [
      { role: 'system', content: 'first' },
      { role: 'developer', content: 'second' },
      { role: 'user', content: 'text' },
    ],
    verbosity: 'medium',
  });
  assert.deepEqual(f.sent[0], {
    model: 'model',
    max_tokens: 128,
    system: 'first\nsecond',
    messages: [{ role: 'user', content: 'text' }],
    output_config: { effort: 'medium' },
  });
});
test('invalid Anthropic verbosity and unsupported Google controls reject before credentials', async () => {
  for (const kind of ['anthropic', 'google'] as const) {
    for (const verbosity of kind === 'anthropic'
      ? ['', 'HIGH', 'private invalid', true, 1, [], {}]
      : ['low', 'medium', 'high', 'xhigh', 'max']) {
      const f = adapter(kind);
      await assert.rejects(() => f.call(input({ verbosity }) as unknown as ChatRequest));
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
    }
  }
});
test('Anthropic effort preserves denial limits required ledger/audit and safe provider failures', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    for (const options of [
      { deny: true },
      { explicitDeny: true },
      { limit: true },
      { audit: true },
      { ledger: true },
      { outcomeAudit: true },
      { fail: true },
    ]) {
      const f = httpFixture('anthropic', options);
      const response = await f.handler(request(path, { verbosity: 'high' }));
      const dispatched = 'ledger' in options || 'outcomeAudit' in options || 'fail' in options;
      assert.equal(
        response.status,
        'limit' in options
          ? 429
          : 'fail' in options
            ? 502
            : 'audit' in options || 'ledger' in options || 'outcomeAudit' in options
              ? 503
              : 403,
      );
      assert.equal(f.sent.length, dispatched ? 1 : 0);
      assert.doesNotMatch(await response.text(), /verbosity|private|fixture-key/u);
      assert.doesNotMatch(
        JSON.stringify([f.audits, f.usage]),
        /verbosity|output_config|private|fixture-key/u,
      );
    }
  }
});
test('thinking response blocks remain safe possibly-billed failures instead of silently discarded output', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const f = httpFixture('anthropic', { thinking: true });
    const response = await f.handler(request(path, { verbosity: 'max' }));
    assert.equal(response.status, 502);
    assert.equal(f.sent.length, 1);
    const record = f.usage[0] as { outcome: string; possiblyBilled: boolean };
    assert.equal(record.outcome, 'failed');
    assert.equal(record.possiblyBilled, true);
    assert.doesNotMatch(await response.text(), /private|thought|signature/u);
    assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private|thought|signature/u);
  }
});
test('actual OpenAI SDK sockets map all Anthropic effort levels on both client bases', async () => {
  const f = httpFixture('anthropic');
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
      for (const verbosity of [null, 'low', 'medium', 'high', 'xhigh', 'max'] as const) {
        const result = await sdk.chat.completions.create(
          input({ verbosity }) as OpenAI.ChatCompletionCreateParamsNonStreaming,
        );
        assert.equal(result.choices[0]?.message.content, 'reply');
        assert.equal(effort(f.sent.at(-1)), verbosity ?? undefined);
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
