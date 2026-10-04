import assert from 'node:assert/strict';
import { test } from 'node:test';
import OpenAI from 'openai';
import { type ChatRequest, createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import { createOpenRouterChatInvoker } from '../src/providers/openrouter-chat.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

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
      ? new Response('private fixture unsupported temperature error', { status: 400 })
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
    unauthorized?: boolean;
    limit?: boolean;
    audit?: boolean;
    fail?: boolean;
  } = {},
) {
  const f = adapter(kind, undefined, undefined, options.fail);
  const audits: unknown[] = [];
  const usage: UsageRecord[] = [];
  let routes = 0;
  const handler = createChatHandler({
    newRequestId: () => 'request',
    authenticate: async (token) =>
      token !== 'fixture' || options.unauthorized
        ? undefined
        : {
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
          },
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
    listPublishedModels: async () => [
      {
        alias: 'chat',
        created: 1,
        enabled: true,
        routes: [
          { kind: kind === 'openrouter' ? 'delegated' : 'managed', candidates: [f.candidate] },
        ],
      },
    ],
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
function choiceRequest(n: unknown): ChatRequest {
  return { ...request(), ...(n === undefined ? {} : { n }) } as unknown as ChatRequest;
}
function nativeCount(kind: Kind, sent: Record<string, unknown> | undefined) {
  assert.ok(sent);
  return kind === 'google'
    ? (sent.generationConfig as Record<string, unknown> | undefined)?.candidateCount
    : sent.n;
}
for (const kind of kinds) {
  test(`${kind} preserves n=1 and omission with native single-choice mapping`, async () => {
    for (const n of [1, undefined]) {
      const f = adapter(kind);
      const completion = await f.call(choiceRequest(n));
      assert.equal(completion.choices.length, 1);
      assert.equal(nativeCount(kind, f.sent[0]), kind === 'anthropic' ? undefined : n);
    }
  });
  test(`${kind} rejects invalid or multiple choices before secrets`, async () => {
    for (const n of [0, 2, -1, 1.5, NaN, Infinity, '1', null, true, {}, []]) {
      const f = adapter(kind);
      await assert.rejects(f.call(choiceRequest(n)), (error: unknown) => {
        assert.equal((error as { possiblyBilled: boolean }).possiblyBilled, false);
        return true;
      });
      assert.equal(f.secrets(), 0);
      assert.deepEqual(f.sent, []);
    }
  });
  test(`${kind} captures single-choice setting before asynchronous credential lookup`, async () => {
    const source = { ...request(), n: 1 };
    const f = adapter(kind, undefined, () => {
      source.n = 2;
    });
    await f.call(source as ChatRequest);
    assert.equal(nativeCount(kind, f.sent[0]), kind === 'anthropic' ? undefined : 1);
  });
}
async function withSdk(
  kind: Kind,
  base: '/v1' | '/api/v1',
  options: Parameters<typeof httpFixture>[1],
  run: (client: OpenAI, f: ReturnType<typeof httpFixture>) => Promise<void>,
) {
  const f = httpFixture(kind, options);
  const server = createNodeRequestServer(f.handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const client = new OpenAI({
      apiKey: 'fixture',
      baseURL: `http://127.0.0.1:${address.port}${base}`,
      maxRetries: 0,
      timeout: 2000,
    });
    await run(client, f);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
for (const kind of kinds) {
  test(`official SDK discovers and invokes ${kind} through both gateway base URLs`, async () => {
    for (const base of ['/v1', '/api/v1'] as const) {
      await withSdk(kind, base, {}, async (client, f) => {
        const models = await client.models.list();
        assert.deepEqual(
          models.data.map((model) => model.id),
          ['chat'],
        );
        const completion = await client.chat.completions.create({
          model: models.data[0]?.id ?? '',
          messages: [{ role: 'user', content: 'private prompt fixture' }],
          n: 1,
          stream: false,
          temperature: 1,
          top_p: 0.99,
          stop: ['marker'],
          max_completion_tokens: 17,
        });
        assert.equal(completion.model, 'chat');
        assert.equal(completion.choices.length, 1);
        assert.equal(completion.choices[0]?.message.content, 'reply');
        assert.equal(completion.usage?.total_tokens, kind === 'google' ? undefined : 3);
        if (kind === 'google') {
          assert.equal(f.usage[0]?.usage.status, 'partial');
          assert.equal(f.usage[0]?.usage.totalTokens, null);
          assert.equal(completion.usage?.prompt_tokens, base === '/v1' ? 2 : undefined);
          assert.equal(completion.usage?.completion_tokens, base === '/v1' ? 1 : undefined);
        }
        assert.equal(f.usage.length, 1);
        assert.equal(nativeCount(kind, f.sent[0]), kind === 'anthropic' ? undefined : 1);
        assert.equal(nativeLimit(kind, f.sent[0]), 17);
        const sent = f.sent[0];
        assert.ok(sent);
        const native =
          kind === 'google' ? (sent.generationConfig as Record<string, unknown>) : sent;
        assert.equal(native.temperature, 1);
        assert.equal(native[kind === 'google' ? 'topP' : 'top_p'], 0.99);
        assert.deepEqual(
          native[
            kind === 'google' ? 'stopSequences' : kind === 'anthropic' ? 'stop_sequences' : 'stop'
          ],
          ['marker'],
        );
        assert.doesNotMatch(JSON.stringify(f.audits), /private prompt fixture|marker|fixture-key/u);
        assert.doesNotMatch(JSON.stringify(f.usage), /private prompt fixture|marker|fixture-key/u);
      });
    }
  });
}
test('official SDK denial and failures preserve safe status, request IDs and accounting', async () => {
  for (const kind of ['openai', 'openrouter'] as const) {
    for (const [options, n, status, usage] of [
      [{ unauthorized: true }, 1, 401, 0],
      [{ deny: true }, 1, 403, 0],
      [{ explicitDeny: true }, 1, 403, 0],
      [{ limit: true }, 1, 429, 0],
      [{ audit: true }, 1, 503, 0],
      [{}, 2, 400, 0],
      [{ fail: true }, 1, 502, 1],
    ] as const) {
      await withSdk(kind, '/api/v1', options, async (client, f) => {
        await assert.rejects(
          client.chat.completions.create({
            model: 'chat',
            messages: [{ role: 'user', content: 'private prompt fixture' }],
            n,
          }),
          (error: unknown) => {
            assert.ok(error instanceof OpenAI.APIError);
            assert.equal(error.status, status);
            assert.equal(error.requestID, 'request');
            assert.doesNotMatch(
              error.message,
              /private prompt fixture|private fixture|fixture-key/u,
            );
            return true;
          },
        );
        assert.equal(f.usage.length, usage);
        if (usage === 0) {
          assert.equal(f.secrets(), 0);
          assert.deepEqual(f.sent, []);
        }
        if (n === 2) {
          assert.equal(f.routes(), 0);
          assert.ok(
            f.audits.some((event) => (event as { kind: string }).kind === 'request-denied'),
          );
        }
      });
    }
  }
});
