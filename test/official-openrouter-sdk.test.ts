import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import { type ChatHandlerPorts, createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import { createOpenRouterChatInvoker } from '../src/providers/openrouter-chat.ts';
import { createOpenRouterTextStreamInvoker } from '../src/providers/openrouter-stream.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

function fixture(
  options: {
    deny?: boolean;
    limit?: boolean;
    missingUsage?: boolean;
    failure?: 'first' | 'later';
    fingerprint?: boolean;
    tiers?: { text?: unknown; final?: unknown };
  } = {},
) {
  const audit: unknown[] = [];
  const usage: UsageRecord[] = [];
  const sent: Record<string, unknown>[] = [];
  const native = {
    credentialRef: 'secret/openrouter',
    resolveSecret: async () => 'fixture-upstream-key',
    fetcher: async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(url), 'https://openrouter.ai/api/v1/chat/completions');
      const body = JSON.parse(String(init?.body));
      sent.push(body);
      assert.deepEqual(body.provider, { only: ['OpenAI'] });
      if (!body.stream)
        return Response.json({
          id: 'gen-1',
          created: 42,
          model: 'openai/example',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'private answer' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 2 },
          ...(options.fingerprint ? { system_fingerprint: 'fp_fixture' } : {}),
        });
      const chunk = (delta: object, finish_reason: string | null, extra: object = {}) =>
        `data: ${JSON.stringify({ id: 'gen-1', created: 42, model: 'openai/example', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }], ...(('usage' in extra ? options.tiers?.final : options.tiers?.text) === undefined ? {} : { service_tier: 'usage' in extra ? options.tiers?.final : options.tiers?.text }), ...extra })}\n\n`;
      const failure = `data: ${JSON.stringify({ error: { code: 502, message: 'private provider error' } })}\n\n`;
      const text =
        options.failure === 'first'
          ? failure
          : chunk({ content: 'private answer', role: 'assistant' }, null) +
            (options.failure === 'later'
              ? failure
              : chunk({}, 'stop') +
                chunk({}, 'stop', {
                  usage: options.missingUsage ? {} : { prompt_tokens: 1, completion_tokens: 2 },
                }) +
                'data: [DONE]\n\n');
      return new Response(text, { headers: { 'content-type': 'text/event-stream' } });
    },
  };
  const stream = createOpenRouterTextStreamInvoker(native);
  const chat = createOpenRouterChatInvoker(native);
  const ports: ChatHandlerPorts<unknown> = {
    newRequestId: () => 'req-official',
    authenticate: async (token) =>
      token !== 'fixture-proxy-key'
        ? undefined
        : {
            id: 'user-1',
            active: true,
            credentialId: 'proxy-1',
            policyVersions: [],
            statements: options.deny
              ? []
              : [
                  {
                    effect: 'Allow',
                    actions: ['llm:InvokeModel', 'llm:UseProvider'],
                    resources: ['*'],
                  },
                ],
          },
    resolveRoute: async () => ({
      kind: 'delegated',
      version: 'v1',
      credentialRef: 'secret/openrouter',
      candidates: [
        {
          id: 'candidate',
          kind: 'delegated',
          providerId: 'openai',
          upstreamModelId: 'openai/example',
        },
      ],
    }),
    resolveVerifiedProviderSlug: async () => 'OpenAI',
    checkLimit: async () => !options.limit,
    resolveSecret: async () => assert.fail('unexpected direct secret lookup'),
    invokeDirect: async () => assert.fail('unexpected direct invocation'),
    invokeOpenRouterTextStream: (_ref, ...args) => stream(...args),
    invokeOpenRouter: (_ref, attempt, request) => chat(attempt, request),
    writeAudit: async (event) => {
      audit.push(event);
    },
    writeUsage: async (record) => {
      usage.push(record);
    },
  };
  return { ports, audit, usage, sent };
}

async function socket<T>(
  f: ReturnType<typeof fixture>,
  base: string,
  operation: (client: OpenRouter) => Promise<T>,
): Promise<T> {
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
    return await operation(client);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

for (const base of ['/v1', '/api/v1']) {
  test(`official SDK ${base} streams text and complete/unknown usage through actual sockets`, {
    timeout: 10000,
  }, async () => {
    for (const missingUsage of [false, true]) {
      const f = fixture({ missingUsage });
      await socket(f, base, async (client) => {
        const stream = await client.chat.send({
          chatRequest: {
            model: 'chat',
            messages: [{ role: 'user', content: 'private prompt' }],
            stream: true,
            maxTokens: 32,
            topP: 0.8,
            streamOptions: { includeUsage: false },
          },
        });
        assert.ok(Symbol.asyncIterator in stream);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        assert.equal(chunks[0]?.choices[0]?.delta.content, 'private answer');
        assert.equal(chunks[1]?.choices[0]?.finishReason, 'stop');
        assert.equal(chunks.at(-1)?.usage?.totalTokens, missingUsage ? undefined : 3);
        assert.equal(chunks.length, missingUsage ? 2 : 3);
      });
      assert.equal(f.sent.length, 1);
      assert.equal(f.sent[0]?.max_tokens, 32);
      assert.equal(f.sent[0]?.top_p, 0.8);
      assert.deepEqual(f.sent[0]?.stream_options, { include_usage: false });
      assert.equal(f.usage[0]?.outcome, 'succeeded');
      assert.equal(f.usage[0]?.usage.status, missingUsage ? 'missing' : 'reported');
      assert.equal(JSON.stringify({ audit: f.audit, usage: f.usage }).includes('private'), false);
    }
  });
}

for (const base of ['/v1', '/api/v1']) {
  test(`official SDK ${base} nonstream success requires supplied fingerprint`, {
    timeout: 10000,
  }, async () => {
    const f = fixture({ fingerprint: true });
    await socket(f, base, async (client) => {
      const result = await client.chat.send({
        chatRequest: {
          model: 'chat',
          messages: [{ role: 'user', content: 'private prompt' }],
          stream: false,
        },
      });
      assert.ok('choices' in result);
      assert.equal(result.choices[0]?.message.content, 'private answer');
      assert.equal(result.systemFingerprint, 'fp_fixture');
      assert.equal(result.usage?.totalTokens, 3);
    });
    assert.equal(f.usage[0]?.outcome, 'succeeded');
    assert.equal(JSON.stringify({ audit: f.audit, usage: f.usage }).includes('private'), false);
  });

  test(`official SDK ${base} handles unknown nonstream fingerprint under its path contract`, {
    timeout: 10000,
  }, async () => {
    const f = fixture();
    await socket(f, base, async (client) => {
      const completion = client.chat.send({
        chatRequest: {
          model: 'chat',
          messages: [{ role: 'user', content: 'text' }],
          stream: false,
        },
      });
      if (base === '/api/v1') {
        const result = await completion;
        assert.ok('choices' in result);
        assert.equal(result.systemFingerprint, null);
        assert.equal(result.choices[0]?.message.content, 'private answer');
      } else {
        await assert.rejects(completion, (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.name, 'ResponseValidationError');
          return true;
        });
      }
    });
    assert.equal(f.usage[0]?.outcome, 'succeeded');
    assert.equal(f.sent.length, 1);
  });

  test(`official SDK ${base} denials and first-event upstream failure preserve accounting boundaries`, {
    timeout: 10000,
  }, async () => {
    for (const [variant, status] of [
      ['auth', 401],
      ['iam', 403],
      ['limit', 429],
      ['first', 502],
    ] as const) {
      const f = fixture({
        ...(variant === 'iam' ? { deny: true } : {}),
        ...(variant === 'limit' ? { limit: true } : {}),
        ...(variant === 'first' ? { failure: 'first' as const } : {}),
      });
      if (variant === 'auth') f.ports = { ...f.ports, authenticate: async () => undefined };
      await socket(f, base, async (client) => {
        await assert.rejects(
          client.chat.send({
            chatRequest: {
              model: 'chat',
              messages: [{ role: 'user', content: 'private prompt' }],
              stream: true,
            },
          }),
          (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.equal('statusCode' in error ? error.statusCode : undefined, status);
            assert.equal(error.message.includes('private provider'), false);
            return true;
          },
        );
      });
      assert.equal(f.sent.length, variant === 'first' ? 1 : 0);
      assert.equal(f.usage.length, variant === 'first' ? 1 : 0);
      if (variant === 'first') {
        assert.equal(f.usage[0]?.outcome, 'failed');
        assert.equal(f.usage[0]?.possiblyBilled, true);
      }
    }
  });

  test(`official SDK ${base} midstream failure retains compatible error or legacy schema gap`, {
    timeout: 10000,
  }, async () => {
    const f = fixture({ failure: 'later' });
    await socket(f, base, async (client) => {
      const result = await client.chat.send({
        chatRequest: { model: 'chat', messages: [{ role: 'user', content: 'text' }], stream: true },
      });
      assert.ok(Symbol.asyncIterator in result);
      const iterator = result[Symbol.asyncIterator]();
      assert.equal((await iterator.next()).value?.choices[0]?.delta.content, 'private answer');
      if (base === '/api/v1') {
        const failure = await iterator.next();
        assert.equal(failure.done, false);
        assert.equal(failure.value?.id, 'gen-1');
        assert.equal(failure.value?.model, 'chat');
        assert.equal(failure.value?.choices[0]?.finishReason, 'error');
        assert.equal(failure.value?.error?.code, 502);
        assert.equal(failure.value?.error?.message, 'Upstream model request failed.');
        assert.equal(JSON.stringify(failure.value).includes('private'), false);
        assert.equal((await iterator.next()).done, true);
      } else {
        await assert.rejects(iterator.next(), (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.name, 'ZodError');
          assert.ok('issues' in error && Array.isArray(error.issues));
          assert.ok(error.issues.some((issue: { path: unknown[] }) => issue.path.includes('id')));
          return true;
        });
      }
    });
    assert.equal(f.usage[0]?.outcome, 'failed');
    assert.equal(f.usage[0]?.possiblyBilled, true);
    assert.equal(
      f.audit.some((event) => (event as { kind: string }).kind === 'stream-interrupted'),
      true,
    );
    assert.equal(JSON.stringify({ audit: f.audit, usage: f.usage }).includes('private'), false);
  });
}

for (const base of ['/v1', '/api/v1']) {
  test(`official SDK ${base} current basic model catalog lacks official metadata`, {
    timeout: 5000,
  }, async () => {
    const f = fixture();
    f.ports = {
      ...f.ports,
      listPublishedModels: async () => [
        {
          alias: 'chat',
          created: 42,
          enabled: true,
          routes: [
            {
              kind: 'delegated',
              candidates: [
                {
                  id: 'candidate',
                  kind: 'delegated',
                  providerId: 'openai',
                  upstreamModelId: 'openai/example',
                },
              ],
            },
          ],
        },
      ],
    };
    await socket(f, base, async (client) => {
      await assert.rejects(client.models.list(), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, 'ResponseValidationError');
        assert.equal(JSON.stringify(error.cause).includes('context_length'), true);
        return true;
      });
    });
    assert.equal(f.sent.length, 0);
    assert.equal(f.usage.length, 0);
    assert.ok(f.audit.some((event) => (event as { kind: string }).kind === 'models-listed'));
  });
}

for (const base of ['/v1', '/api/v1'])
  test(`official SDK ${base} preserves streamed tiers and independent final usage metadata`, async () => {
    for (const tier of [undefined, null, '', 'private-tier\n\ndata: forged 한글'])
      for (const missingUsage of [false, true]) {
        const f = fixture({ tiers: { text: 'private-text-tier', final: tier }, missingUsage });
        await socket(f, base, async (client) => {
          const result = await client.chat.send({
            chatRequest: {
              model: 'chat',
              messages: [{ role: 'user', content: 'text' }],
              stream: true,
            },
          });
          assert.ok(Symbol.asyncIterator in result);
          const chunks = [];
          for await (const item of result) chunks.push(item);
          assert.equal(chunks[0]?.serviceTier, 'private-text-tier');
          assert.equal(chunks[1]?.serviceTier, 'private-text-tier');
          assert.equal(chunks.length, missingUsage ? 2 : 3);
          if (!missingUsage) assert.equal(chunks[2]?.serviceTier, tier);
        });
        assert.equal(f.usage[0]?.usage.status, missingUsage ? 'missing' : 'reported');
        assert.equal(f.usage[0]?.outcome, 'succeeded');
        assert.doesNotMatch(JSON.stringify([f.audit, f.usage]), /tier|forged|한글/u);
      }
  });

test('stream service tiers preserve public first/later failures and denial/accounting gates', async () => {
  for (const base of ['/v1', '/api/v1']) {
    for (const phase of ['first', 'later'] as const) {
      const f = fixture({
        tiers:
          phase === 'first'
            ? { text: { private: 'tier' } }
            : { text: 'private-tier', final: { private: 'tier' } },
      });
      const response = await createChatHandler(f.ports)(
        new Request(`http://localhost${base}/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer fixture-proxy-key',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'chat',
            messages: [{ role: 'user', content: 'text' }],
            stream: true,
          }),
        }),
      );
      assert.equal(response.status, phase === 'first' ? 502 : 200);
      const text = await response.text();
      assert.equal(text.includes('[DONE]'), false);
      const failure =
        phase === 'first'
          ? JSON.parse(text)
          : JSON.parse(text.trim().split('\n\n').at(-1)?.slice(6) ?? '{}');
      assert.equal(Object.hasOwn(failure, 'service_tier'), false);
      assert.doesNotMatch(JSON.stringify(failure), /private/u);
      assert.equal(f.usage[0]?.outcome, 'failed');
      assert.equal(f.usage[0]?.possiblyBilled, true);
      assert.doesNotMatch(JSON.stringify([f.audit, f.usage]), /private-tier/u);
    }
    for (const gate of ['deny', 'limit', 'ledger', 'audit'] as const) {
      const f = fixture({
        tiers: { text: 'private-tier', final: 'private-final-tier' },
        ...(gate === 'deny' ? { deny: true } : {}),
        ...(gate === 'limit' ? { limit: true } : {}),
      });
      if (gate === 'ledger')
        f.ports = {
          ...f.ports,
          writeUsage: async () => {
            throw Error('private ledger');
          },
        };
      if (gate === 'audit')
        f.ports = {
          ...f.ports,
          writeAudit: async (event) => {
            if (event.kind === 'delegated-attempt') throw Error('private audit');
            f.audit.push(event);
          },
        };
      const response = await createChatHandler(f.ports)(
        new Request(`http://localhost${base}/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer fixture-proxy-key',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'chat',
            messages: [{ role: 'user', content: 'text' }],
            stream: true,
          }),
        }),
      );
      assert.equal(response.status, gate === 'deny' ? 403 : gate === 'limit' ? 429 : 200);
      const text = await response.text();
      assert.equal(text.includes('[DONE]'), false);
      assert.equal(text.includes('private-final-tier'), false);
      if (gate === 'deny' || gate === 'limit') {
        assert.equal(f.sent.length, 0);
        assert.equal(f.usage.length, 0);
      }
      assert.doesNotMatch(JSON.stringify([f.audit, f.usage]), /tier/u);
    }
  }
});

for (const base of ['/v1', '/api/v1'])
  test(`official SDK ${base} streams delegated min_p under the same approved destination scope`, async () => {
    const f = fixture();
    await socket(f, base, async (client) => {
      const result = await client.chat.send({
        chatRequest: {
          model: 'chat',
          messages: [{ role: 'user', content: 'text' }],
          stream: true,
          minP: 0.25,
        },
      });
      assert.ok(Symbol.asyncIterator in result);
      const chunks = [];
      for await (const item of result) chunks.push(item);
      assert.equal(chunks[0]?.choices[0]?.delta.content, 'private answer');
      assert.equal(chunks.at(-1)?.usage?.totalTokens, 3);
    });
    assert.equal(f.sent[0]?.min_p, 0.25);
    assert.deepEqual(f.sent[0]?.provider, { only: ['OpenAI'] });
    assert.equal(f.usage[0]?.outcome, 'succeeded');
    assert.doesNotMatch(JSON.stringify([f.audit, f.usage]), /private/u);
  });
