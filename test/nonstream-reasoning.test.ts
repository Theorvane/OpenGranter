import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import { type ChatHandlerPorts, createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import { normalizeAssistantResponse } from '../src/providers/assistant-response.ts';
import { type ChatCompletion, createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import { createOpenRouterChatInvoker } from '../src/providers/openrouter-chat.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

type Kind = 'managed' | 'delegated';
type Gate = 'auth' | 'model' | 'provider' | 'limit' | 'selection' | 'outcome' | 'usage';
const text = 'private reasoning 思考\n\ndata: forged';
function fixture(
  kind: Kind,
  message: object,
  finish: string | null = 'stop',
  gate?: Gate,
  missingUsage = false,
) {
  const audit: Parameters<ChatHandlerPorts<unknown>['writeAudit']>[0][] = [];
  const usage: UsageRecord[] = [];
  let calls = 0;
  let secrets = 0;
  const transport = {
    resolveSecret: async () => {
      secrets++;
      return 'fixture-upstream-key';
    },
    fetcher: async (url: string | URL | Request) => {
      assert.equal(
        String(url),
        kind === 'managed'
          ? 'https://api.openai.com/v1/chat/completions'
          : 'https://openrouter.ai/api/v1/chat/completions',
      );
      calls++;
      return Response.json({
        id: 'completion',
        created: 42,
        model: 'upstream-model',
        system_fingerprint: 'fp_fixture',
        choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finish }],
        ...(missingUsage ? {} : { usage: { prompt_tokens: 2, completion_tokens: 1 } }),
      });
    },
  };
  const candidate = {
    id: 'candidate',
    kind,
    providerId: 'openai',
    upstreamModelId: 'upstream-model',
  };
  const direct = createDirectChatInvoker({
    ...transport,
    registrations: [{ providerId: 'openai', kind: 'openai', credentialRef: 'secret/direct' }],
  });
  const delegated = createOpenRouterChatInvoker({
    ...transport,
    credentialRef: 'secret/openrouter',
  });
  const ports: ChatHandlerPorts<unknown> = {
    newRequestId: () => 'req-reasoning',
    authenticate: async (token) =>
      gate === 'auth' || token !== 'fixture-proxy-key'
        ? undefined
        : {
            id: 'user-1',
            active: true,
            credentialId: 'proxy-1',
            policyVersions: [],
            statements: [
              { effect: 'Allow', actions: ['*'], resources: ['*'] },
              ...(gate === 'model' || gate === 'provider'
                ? [
                    {
                      effect: 'Deny' as const,
                      actions: [gate === 'model' ? 'llm:InvokeModel' : 'llm:UseProvider'],
                      resources: [gate === 'model' ? 'model:chat' : 'provider:openai'],
                    },
                  ]
                : []),
            ],
          },
    resolveRoute: async () =>
      kind === 'delegated'
        ? { kind, version: 'v1', credentialRef: 'secret/openrouter', candidates: [candidate] }
        : { kind, version: 'v1', candidates: [candidate] },
    resolveVerifiedProviderSlug: async () => 'OpenAI',
    checkLimit: async () => gate !== 'limit',
    resolveSecret: async () => assert.fail('unexpected Jev secret'),
    invokeDirect: (selected, request) => direct(selected, request),
    invokeOpenRouter: (_ref, attempt, request) => delegated(attempt, request),
    writeAudit: async (event) => {
      if (
        (gate === 'selection' &&
          (event.kind === 'selection-started' || event.kind === 'delegated-selection')) ||
        (gate === 'outcome' && (event.kind === 'attempt' || event.kind === 'delegated-attempt'))
      )
        throw new Error('private reasoning audit');
      audit.push(event);
    },
    writeUsage: async (record) => {
      if (gate === 'usage') throw new Error('private reasoning usage');
      usage.push(record);
    },
  };
  const request = (base: string) =>
    new Request(`http://gateway${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer fixture-proxy-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'chat',
        messages: [{ role: 'user', content: 'private prompt' }],
      }),
    });
  return { ports, request, audit, usage, calls: () => calls, secrets: () => secrets };
}
function safe(f: ReturnType<typeof fixture>) {
  const value = JSON.stringify({ audit: f.audit, usage: f.usage });
  for (const forbidden of ['private', 'fixture-upstream-key', 'fixture-proxy-key', 'forged'])
    assert.equal(value.includes(forbidden), false);
}

for (const kind of ['managed', 'delegated'] as const) {
  test(`${kind}: scalar reasoning-only stop/length responses preserve content and accounting`, async () => {
    for (const base of ['/v1', '/api/v1']) {
      for (const finish of ['stop', 'length']) {
        for (const message of [{ content: null, reasoning: text }, { reasoning: text }]) {
          for (const missingUsage of [false, true]) {
            const f = fixture(kind, message, finish, undefined, missingUsage);
            const response = await createChatHandler(f.ports)(f.request(base));
            assert.equal(response.status, 200);
            const body = (await response.json()) as ChatCompletion;
            assert.equal(body.choices[0].message.content, null);
            assert.equal(body.choices[0].message.reasoning, text);
            assert.equal(body.choices[0].finish_reason, finish);
            assert.equal(body.model, 'chat');
            assert.equal(f.usage.length, 1);
            assert.equal(f.usage[0]?.outcome, 'succeeded');
            assert.equal(f.usage[0]?.usage.totalTokens, missingUsage ? null : 3);
            if (missingUsage) assert.equal(body.usage, undefined);
            safe(f);
          }
        }
      }
    }
  });

  test(`${kind}: nonstream reasoning preserves exact optional values on both prefixes`, async () => {
    for (const base of ['/v1', '/api/v1']) {
      for (const reasoning of [undefined, null, '', text]) {
        const f = fixture(kind, {
          content: 'private answer',
          ...(reasoning === undefined ? {} : { reasoning }),
        });
        const response = await createChatHandler(f.ports)(f.request(base));
        assert.equal(response.status, 200);
        const body = (await response.json()) as ChatCompletion;
        assert.equal(body.choices[0].message.reasoning, reasoning);
        assert.equal(Object.hasOwn(body.choices[0].message, 'reasoning'), reasoning !== undefined);
        assert.equal(body.choices[0].message.content, 'private answer');
        assert.equal(body.model, 'chat');
        assert.equal(f.usage.length, 1);
        assert.equal(f.usage[0]?.outcome, 'succeeded');
        assert.equal(f.usage[0]?.usage.totalTokens, 3);
        safe(f);
      }
    }
  });

  test(`${kind}: reasoning coexists with valid refusal/filter/function-call outcomes`, async () => {
    const calls = [
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'lookup', arguments: '{"query":"private"}' },
      },
    ];
    for (const base of ['/v1', '/api/v1']) {
      for (const [message, finish] of [
        [{ content: null, refusal: 'private refusal', reasoning: text }, 'stop'],
        [{ content: null, reasoning: null }, 'content_filter'],
        [{ content: '', reasoning: text }, 'length'],
        [{ tool_calls: calls, reasoning: text }, 'tool_calls'],
      ] as const) {
        const f = fixture(kind, message, finish);
        const response = await createChatHandler(f.ports)(f.request(base));
        assert.equal(response.status, 200);
        const body = (await response.json()) as ChatCompletion;
        assert.equal(body.choices[0].message.reasoning, message.reasoning);
        assert.equal(body.choices[0].finish_reason, finish);
        if ('tool_calls' in message) assert.deepEqual(body.choices[0].message.tool_calls, calls);
        if ('refusal' in message) assert.equal(body.choices[0].message.refusal, message.refusal);
        assert.equal(f.usage[0]?.outcome, 'succeeded');
        safe(f);
      }
    }
  });

  test(`${kind}: reasoning content never fabricates missing usage`, async () => {
    for (const base of ['/v1', '/api/v1']) {
      const f = fixture(
        kind,
        { content: 'private answer', reasoning: text },
        'stop',
        undefined,
        true,
      );
      const response = await createChatHandler(f.ports)(f.request(base));
      assert.equal(response.status, 200);
      const body = (await response.json()) as ChatCompletion;
      assert.equal(body.choices[0].message.reasoning, text);
      assert.equal(body.usage, undefined);
      assert.equal(f.usage[0]?.outcome, 'succeeded');
      assert.equal(f.usage[0]?.usage.status, 'missing');
      assert.equal(f.usage[0]?.usage.totalTokens, null);
      safe(f);
    }
  });

  test(`${kind}: malformed or empty reasoning cannot grant reasoning-only success`, async () => {
    for (const base of ['/v1', '/api/v1']) {
      for (const message of [
        ...[true, 42, [], { secret: 'private reasoning' }].map((reasoning) => ({
          content: 'private answer',
          reasoning,
        })),
        ...[undefined, null, ''].flatMap((reasoning) => [
          { content: null, ...(reasoning === undefined ? {} : { reasoning }) },
          { ...(reasoning === undefined ? {} : { reasoning }) },
        ]),
        { content: 42, reasoning: text },
        { content: null, reasoning_details: [{ type: 'reasoning.summary', summary: '' }] },
        {
          content: null,
          reasoning: true,
          tool_calls: [
            { id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } },
          ],
        },
      ]) {
        const f = fixture(kind, message, 'tool_calls' in message ? 'tool_calls' : 'stop');
        const response = await createChatHandler(f.ports)(f.request(base));
        assert.equal(response.status, 502);
        assert.equal((await response.text()).includes('private'), false);
        assert.equal(f.calls(), 1);
        assert.equal(f.usage.length, 1);
        assert.equal(f.usage[0]?.outcome, 'failed');
        assert.equal(f.usage[0]?.possiblyBilled, true);
        safe(f);
      }
    }
  });

  test(`${kind}: reasoning-only output cannot bypass incompatible finish semantics`, async () => {
    for (const base of ['/v1', '/api/v1']) {
      for (const finish of [null, 'tool_calls', 'function_call', 'unknown']) {
        const f = fixture(kind, { content: null, reasoning: text }, finish);
        const response = await createChatHandler(f.ports)(f.request(base));
        assert.equal(response.status, 502);
        assert.equal((await response.text()).includes('private'), false);
        assert.equal(f.usage.length, 1);
        assert.equal(f.usage[0]?.outcome, 'failed');
        assert.equal(f.usage[0]?.possiblyBilled, true);
        safe(f);
      }
    }
  });

  test(`${kind}: reasoning retains pre-dispatch gates and required post-response persistence`, async () => {
    for (const base of ['/v1', '/api/v1']) {
      for (const [gate, status, dispatched] of [
        ['auth', 401, false],
        ['model', 403, false],
        ['provider', 403, false],
        ['limit', 429, false],
        ['selection', 503, false],
        ['outcome', 503, true],
        ['usage', 503, true],
      ] as const) {
        const f = fixture(kind, { content: null, reasoning: text }, 'stop', gate);
        const response = await createChatHandler(f.ports)(f.request(base));
        assert.equal(response.status, status);
        assert.equal((await response.text()).includes('private'), false);
        assert.equal(f.calls(), dispatched ? 1 : 0);
        assert.equal(f.secrets(), dispatched ? 1 : 0);
        assert.equal(f.usage.length, gate === 'outcome' ? 1 : 0);
        if (gate === 'outcome') assert.equal(f.usage[0]?.outcome, 'succeeded');
        safe(f);
      }
    }
  });

  test(`${kind}: official SDK reads nonstream reasoning through both actual socket bases`, async () => {
    for (const base of ['/v1', '/api/v1']) {
      for (const reasoning of [undefined, null, text]) {
        const f = fixture(kind, {
          content: reasoning === text ? null : 'private answer',
          ...(reasoning === undefined ? {} : { reasoning }),
        });
        const server = createNodeChatServer(f.ports);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        try {
          const address = server.address() as AddressInfo;
          const client = new OpenRouter({
            apiKey: 'fixture-proxy-key',
            serverURL: `http://127.0.0.1:${address.port}${base}`,
            retryConfig: { strategy: 'none' },
            timeoutMs: 3000,
          });
          const result = await client.chat.send({
            chatRequest: {
              model: 'chat',
              messages: [{ role: 'user', content: 'private prompt' }],
              stream: false,
            },
          });
          assert.ok('choices' in result);
          assert.equal(result.choices[0]?.message.reasoning, reasoning);
          assert.equal(result.usage?.totalTokens, 3);
          assert.equal(f.usage[0]?.outcome, 'succeeded');
          safe(f);
        } finally {
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        }
      }
    }
  });
}

test('assistant normalization rejects explicit undefined reasoning rather than retaining malformed own fields', () => {
  assert.equal(
    normalizeAssistantResponse(
      { role: 'assistant', content: 'text', reasoning: undefined },
      'stop',
    ),
    undefined,
  );
});

test('inherited reasoning cannot grant success without a projected own reasoning field', () => {
  const value: Record<string, unknown> = Object.create({ reasoning: text });
  value.role = 'assistant';
  value.content = null;
  assert.equal(normalizeAssistantResponse(value, 'stop'), undefined);
});
