import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import type { ChatHandlerPorts } from '../src/gateway/chat-handler.ts';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import { createOpenRouterChatInvoker } from '../src/providers/openrouter-chat.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

type Kind = 'managed' | 'delegated';
type Failure = 'auth' | 'model' | 'provider' | 'limit' | 'selection' | 'outcome' | 'invalid';
const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'lookup',
      description: 'private tool description',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
      strict: true,
    },
  },
];
const calls = [
  {
    id: 'call_one',
    type: 'function' as const,
    function: { name: 'lookup', arguments: '{"query":"private one"}' },
  },
  {
    id: 'call_two',
    type: 'function' as const,
    function: { name: 'lookup', arguments: '{"query":"private two"}' },
  },
];
const wireCalls = calls.map((call) => ({ ...call }));

function fixture(kind: Kind) {
  const sent: Record<string, unknown>[] = [];
  const audit: Parameters<ChatHandlerPorts<unknown>['writeAudit']>[0][] = [];
  const usage: UsageRecord[] = [];
  let failure: Failure | undefined;
  let secrets = 0;
  let authentication = 0;
  let routes = 0;
  let limits = 0;
  let requests = 0;
  const transport = {
    resolveSecret: async () => {
      secrets++;
      return 'fixture-upstream-key';
    },
    fetcher: async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(
        String(url),
        kind === 'delegated'
          ? 'https://openrouter.ai/api/v1/chat/completions'
          : 'https://api.openai.com/v1/chat/completions',
      );
      assert.equal(init?.redirect, 'error');
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const first = sent.length === 1;
      return Response.json({
        id: `completion-${sent.length}`,
        created: 42,
        model: 'openai/example',
        system_fingerprint: 'fp_fixture',
        choices: [
          {
            index: 0,
            finish_reason: first || failure === 'invalid' ? 'tool_calls' : 'stop',
            message:
              first || failure === 'invalid'
                ? {
                    role: 'assistant',
                    content: null,
                    tool_calls:
                      failure === 'invalid'
                        ? [{ ...wireCalls[0], function: { name: 'lookup', arguments: 42 } }]
                        : wireCalls,
                  }
                : { role: 'assistant', content: 'private final answer' },
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 3 },
      });
    },
  };
  const direct = createDirectChatInvoker({
    ...transport,
    registrations: [{ providerId: 'openai', kind: 'openai', credentialRef: 'secret/direct' }],
  });
  const delegated = createOpenRouterChatInvoker({
    ...transport,
    credentialRef: 'secret/openrouter',
  });
  const candidate = {
    id: 'candidate',
    kind,
    providerId: 'openai',
    upstreamModelId: 'openai/example',
  };
  const ports: ChatHandlerPorts<unknown> = {
    newRequestId: () => `req-tools-${++requests}`,
    authenticate: async (token) => {
      authentication++;
      if (failure === 'auth' || token !== 'fixture-proxy-key') return undefined;
      return {
        id: 'user-1',
        active: true,
        credentialId: 'proxy-1',
        policyVersions: [],
        statements: [
          { effect: 'Allow', actions: ['llm:InvokeModel', 'llm:UseProvider'], resources: ['*'] },
          ...(failure === 'model' || failure === 'provider'
            ? [
                {
                  effect: 'Deny' as const,
                  actions: [failure === 'model' ? 'llm:InvokeModel' : 'llm:UseProvider'],
                  resources: [failure === 'model' ? 'model:chat' : 'provider:openai'],
                },
              ]
            : []),
        ],
      };
    },
    resolveRoute: async () => {
      routes++;
      return kind === 'delegated'
        ? { kind, version: 'v1', credentialRef: 'secret/openrouter', candidates: [candidate] }
        : { kind, version: 'v1', candidates: [candidate] };
    },
    resolveVerifiedProviderSlug: async () => 'OpenAI',
    checkLimit: async () => {
      limits++;
      return failure !== 'limit';
    },
    resolveSecret: async () => assert.fail('unexpected Jev secret lookup'),
    invokeDirect: (selected, request) => direct(selected, request),
    invokeOpenRouter: (_ref, attempt, request) => delegated(attempt, request),
    writeAudit: async (event) => {
      if (
        (failure === 'selection' &&
          (event.kind === 'selection-started' || event.kind === 'delegated-selection')) ||
        (failure === 'outcome' && (event.kind === 'attempt' || event.kind === 'delegated-attempt'))
      ) {
        throw new Error('private audit fixture');
      }
      audit.push(event);
    },
    writeUsage: async (record) => {
      usage.push(record);
    },
  };
  return {
    ports,
    sent,
    audit,
    usage,
    fail: (next: Failure) => {
      failure = next;
    },
    counts: () => ({ secrets, authentication, routes, limits }),
  };
}

async function socket(
  f: ReturnType<typeof fixture>,
  base: string,
  run: (client: OpenRouter) => Promise<void>,
) {
  const server = createNodeChatServer(f.ports);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    await run(
      new OpenRouter({
        apiKey: 'fixture-proxy-key',
        serverURL: `http://127.0.0.1:${address.port}${base}`,
        retryConfig: { strategy: 'none' },
        timeoutMs: 3000,
      }),
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
async function first(client: OpenRouter) {
  const result = await client.chat.send({
    chatRequest: {
      model: 'chat',
      messages: [{ role: 'user', content: 'private prompt' }],
      stream: false,
      tools,
      toolChoice: { type: 'function', function: { name: 'lookup' } },
      parallelToolCalls: true,
    },
  });
  assert.ok('choices' in result);
  assert.equal(result.model, 'chat');
  assert.equal(result.choices[0]?.finishReason, 'tool_calls');
  assert.equal(result.choices[0]?.message.content, null);
  assert.deepEqual(result.choices[0]?.message.toolCalls, calls);
  const returnedCalls = result.choices[0]?.message.toolCalls;
  assert.ok(returnedCalls);
  return {
    ...followup,
    messages: [
      { role: 'user' as const, content: 'private prompt' },
      { role: 'assistant' as const, content: null, toolCalls: returnedCalls },
      {
        role: 'tool' as const,
        toolCallId: returnedCalls[1]?.id ?? assert.fail('missing second call'),
        content: [{ type: 'text' as const, text: 'private result two' }],
      },
      {
        role: 'tool' as const,
        toolCallId: returnedCalls[0]?.id ?? assert.fail('missing first call'),
        content: 'private result one',
      },
    ],
  };
}
const followup = {
  model: 'chat',
  stream: false as const,
  tools,
  toolChoice: 'none' as const,
  parallelToolCalls: false,
};
function safeMetadata(f: ReturnType<typeof fixture>) {
  const metadata = JSON.stringify({ audit: f.audit, usage: f.usage });
  for (const forbidden of [
    'private',
    'fixture-upstream-key',
    'fixture-proxy-key',
    'call_one',
    'call_two',
  ])
    assert.equal(metadata.includes(forbidden), false);
}
async function rejected(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal('statusCode' in error ? error.statusCode : undefined, status);
    assert.equal(error.message.includes('private'), false);
    assert.equal(error.message.includes('fixture-upstream-key'), false);
    return true;
  });
}

for (const kind of ['managed', 'delegated'] as const) {
  for (const base of ['/v1', '/api/v1']) {
    test(`official SDK ${kind} ${base} completes the two-request function-tool lifecycle`, async () => {
      const f = fixture(kind);
      await socket(f, base, async (client) => {
        const continuation = await first(client);
        const result = await client.chat.send({ chatRequest: continuation });
        assert.ok('choices' in result);
        assert.equal(result.choices[0]?.message.content, 'private final answer');
        assert.equal(result.choices[0]?.finishReason, 'stop');
        assert.equal(result.usage?.totalTokens, 5);
      });
      assert.equal(f.sent.length, 2);
      assert.deepEqual(f.sent[0]?.tools, tools);
      assert.deepEqual(f.sent[0]?.tool_choice, { type: 'function', function: { name: 'lookup' } });
      assert.equal(f.sent[0]?.parallel_tool_calls, true);
      assert.equal(f.sent[1]?.tool_choice, 'none');
      assert.equal(f.sent[1]?.parallel_tool_calls, false);
      assert.deepEqual(f.sent[1]?.messages, [
        { role: 'user', content: 'private prompt' },
        { role: 'assistant', content: null, tool_calls: wireCalls },
        { role: 'tool', tool_call_id: 'call_two', content: 'private result two' },
        { role: 'tool', tool_call_id: 'call_one', content: 'private result one' },
      ]);
      for (const body of f.sent) {
        assert.equal(body.model, 'openai/example');
        assert.deepEqual(body.provider, kind === 'delegated' ? { only: ['OpenAI'] } : undefined);
      }
      assert.deepEqual(f.counts(), { secrets: 2, authentication: 2, routes: 2, limits: 2 });
      assert.equal(f.usage.length, 2);
      assert.equal(new Set(f.usage.map((record) => record.requestId)).size, 2);
      for (const record of f.usage) {
        assert.equal(record.routeKind, kind);
        assert.equal(record.modelAlias, 'chat');
        assert.equal(record.principalId, 'user-1');
        assert.equal(record.outcome, 'succeeded');
        assert.equal(record.usage.totalTokens, 5);
      }
      safeMetadata(f);
    });

    test(`official SDK ${kind} ${base} reevaluates gates before tool-result continuation`, async () => {
      for (const [failure, status] of [
        ['auth', 401],
        ['model', 403],
        ['provider', 403],
        ['limit', 429],
        ['selection', 503],
      ] as const) {
        const f = fixture(kind);
        await socket(f, base, async (client) => {
          const continuation = await first(client);
          f.fail(failure);
          await rejected(client.chat.send({ chatRequest: continuation }), status);
        });
        assert.equal(f.sent.length, 1);
        assert.equal(f.counts().secrets, 1);
        assert.equal(f.counts().authentication, 2);
        assert.equal(f.usage.length, 1);
        assert.equal(f.usage[0]?.outcome, 'succeeded');
        safeMetadata(f);
      }
    });

    test(`official SDK ${kind} ${base} rejects orphan tool results before route lookup`, async () => {
      const f = fixture(kind);
      await socket(f, base, async (client) => {
        await rejected(
          client.chat.send({
            chatRequest: {
              model: 'chat',
              stream: false,
              messages: [
                { role: 'tool', toolCallId: 'call_one', content: 'private orphan result' },
              ],
            },
          }),
          400,
        );
      });
      assert.deepEqual(f.counts(), { secrets: 0, authentication: 1, routes: 0, limits: 0 });
      assert.equal(f.sent.length, 0);
      assert.equal(f.usage.length, 0);
      safeMetadata(f);
    });

    test(`official SDK ${kind} ${base} preserves failed usage and audit suppression after dispatch`, async () => {
      for (const failure of ['invalid', 'outcome'] as const) {
        const f = fixture(kind);
        await socket(f, base, async (client) => {
          const continuation = await first(client);
          f.fail(failure);
          await rejected(
            client.chat.send({ chatRequest: continuation }),
            failure === 'invalid' ? 502 : 503,
          );
        });
        assert.equal(f.sent.length, 2);
        assert.equal(f.usage.length, 2);
        assert.equal(f.usage[1]?.outcome, failure === 'invalid' ? 'failed' : 'succeeded');
        if (failure === 'invalid') {
          assert.equal(f.usage[1]?.possiblyBilled, true);
          assert.equal(f.usage[1]?.usage.status, 'missing');
        }
        safeMetadata(f);
      }
    });
  }
}
