import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { type ChatHandlerPorts, createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import { encodeOpenRouterTextSse } from '../src/streaming/openrouter-client-sse.ts';
import {
  decodeOpenRouterStreamPayload,
  type OpenRouterTextStreamPayload,
} from '../src/streaming/openrouter-stream-chunks.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

type Delta = Extract<OpenRouterTextStreamPayload, { kind: 'delta' }>;
const chat = {
  model: 'chat',
  messages: [{ role: 'user', content: 'private prompt' }],
  stream: true,
};
const delta = (finishReason: Delta['finishReason'] = null): Delta => ({
  kind: 'delta',
  id: 'gen-1',
  model: 'chat',
  created: 42,
  ...(finishReason === null ? { content: 'private answer', role: 'assistant' as const } : {}),
  finishReason,
});
function fixture() {
  const audit: unknown[] = [];
  const records: UsageRecord[] = [];
  let calls = 0;
  let callbacks = 0;
  const ports: ChatHandlerPorts<unknown> = {
    newRequestId: () => 'req-stream',
    authenticate: async () => ({
      id: 'user-1',
      active: true,
      credentialId: 'credential-1',
      policyVersions: [],
      statements: [
        { effect: 'Allow', actions: ['llm:InvokeModel', 'llm:UseProvider'], resources: ['*'] },
      ],
    }),
    resolveRoute: async () => ({
      kind: 'delegated',
      version: 'v1',
      credentialRef: 'secret/openrouter',
      candidates: [
        {
          id: 'candidate-1',
          kind: 'delegated',
          upstreamModelId: 'openai/example',
          providerId: 'openai',
        },
      ],
    }),
    resolveVerifiedProviderSlug: async () => 'OpenAI',
    checkLimit: async () => true,
    resolveSecret: async () => {
      assert.fail('unexpected Jev credential');
    },
    invokeDirect: async () => {
      assert.fail('unexpected direct call');
    },
    writeAudit: async (event) => {
      audit.push(event);
    },
    writeUsage: async (record) => {
      records.push(record);
    },
    invokeOpenRouterTextStream: async (ref, attempt, request, onDelta, signal) => {
      calls++;
      assert.equal(ref, 'secret/openrouter');
      assert.deepEqual(attempt.authorizedProviderSlugs, ['OpenAI']);
      assert.equal(request.model, 'chat');
      assert.ok(signal);
      callbacks++;
      await onDelta(delta());
      callbacks++;
      await onDelta(delta('stop'));
      return {
        status: 'complete',
        id: 'gen-1',
        model: 'chat',
        finishReason: 'stop',
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      };
    },
  };
  const request = (base = '/api/v1', body: unknown = chat, signal?: AbortSignal) =>
    new Request(`http://gateway${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer proxy-key', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  return { ports, audit, records, request, calls: () => calls, callbacks: () => callbacks };
}

const detailItems = [
  { type: 'reasoning.summary', summary: 'private-reasoning\n\ndata: forged', index: 0 },
  { type: 'reasoning.text', text: null, signature: 'private-reasoning signature', format: null },
  { type: 'reasoning.encrypted', data: 'private-reasoning encrypted' },
];
async function detailPorts(
  f: ReturnType<typeof fixture>,
  options: { invalidAt?: 'first' | 'later'; missingUsage?: boolean; usageDetails?: unknown } = {},
) {
  const { createOpenRouterTextStreamInvoker } = await import(
    '../src/providers/openrouter-stream.ts'
  );
  const invoker = createOpenRouterTextStreamInvoker({
    credentialRef: 'secret/openrouter',
    resolveSecret: async () => 'fixture-key',
    fetcher: async () =>
      new Response(
        [
          {
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  content: null,
                  reasoning_details:
                    options.invalidAt === 'first'
                      ? [{ type: 'reasoning.text', signature: true }]
                      : detailItems,
                },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              {
                index: 0,
                delta: {
                  reasoning_details:
                    options.invalidAt === 'later' ? [{ type: 'reasoning.server_tool_call' }] : [],
                },
                finish_reason: 'stop',
              },
            ],
          },
          {
            choices: [
              {
                index: 0,
                delta:
                  options.usageDetails === undefined
                    ? {}
                    : { reasoning_details: options.usageDetails },
                finish_reason: 'stop',
              },
            ],
            usage: options.missingUsage ? {} : { prompt_tokens: 1, completion_tokens: 2 },
          },
        ]
          .map(
            (value) =>
              `data: ${JSON.stringify({ id: 'gen-1', object: 'chat.completion.chunk', created: 42, model: 'openai/example', ...value })}\n\n`,
          )
          .join('') + 'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  });
  return {
    ...f.ports,
    invokeOpenRouterTextStream: (_ref: string, ...args: Parameters<typeof invoker>) =>
      invoker(...args),
  };
}

test('official SDK receives reasoning deltas with complete or unknown usage on both bases', {
  timeout: 10000,
}, async () => {
  for (const base of ['/v1', '/api/v1']) {
    for (const missingUsage of [false, true]) {
      const f = fixture();
      f.ports = await detailPorts(f, { missingUsage });
      const server = createNodeChatServer(f.ports);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const address = server.address() as AddressInfo;
        const client = new OpenRouter({
          apiKey: 'fixture-key',
          serverURL: `http://127.0.0.1:${address.port}${base}`,
          retryConfig: { strategy: 'none' },
          timeoutMs: 3000,
        });
        const stream = await client.chat.send({
          chatRequest: {
            model: 'chat',
            messages: [{ role: 'user', content: 'text' }],
            stream: true,
            streamOptions: { includeUsage: false },
          },
        });
        assert.ok(Symbol.asyncIterator in stream);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        assert.deepEqual(chunks[0]?.choices[0]?.delta.reasoningDetails, detailItems);
        assert.deepEqual(chunks[1]?.choices[0]?.delta.reasoningDetails, []);
        assert.equal(chunks[1]?.choices[0]?.finishReason, 'stop');
        assert.equal(chunks.length, missingUsage ? 2 : 3);
        assert.equal(chunks.at(-1)?.usage?.totalTokens, missingUsage ? undefined : 3);
        const openai = new OpenAI({
          apiKey: 'fixture-key',
          baseURL: `http://127.0.0.1:${address.port}${base}`,
          maxRetries: 0,
        });
        const rawStream = await openai.chat.completions.create({
          model: 'chat',
          messages: [{ role: 'user', content: 'text' }],
          stream: true,
        });
        const rawChunks = [];
        for await (const raw of rawStream) rawChunks.push(raw);
        assert.deepEqual(
          (
            rawChunks[0]?.choices[0]?.delta as unknown as
              | { reasoning_details?: unknown }
              | undefined
          )?.reasoning_details,
          detailItems,
        );
        assert.deepEqual(
          (
            rawChunks[1]?.choices[0]?.delta as unknown as
              | { reasoning_details?: unknown }
              | undefined
          )?.reasoning_details,
          [],
        );
        if (!missingUsage)
          assert.equal(
            Object.hasOwn(chunks[2]?.choices[0]?.delta ?? {}, 'reasoningDetails'),
            false,
          );
        assert.equal(f.records[0]?.outcome, 'succeeded');
        assert.equal(f.records[0]?.usage.status, missingUsage ? 'missing' : 'reported');
        assert.equal(
          JSON.stringify({ audit: f.audit, usage: f.records }).includes('private-reasoning'),
          false,
        );
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  }
});

test('reasoning-detail stream succeeds on both bases without metadata text or fallback', async () => {
  for (const base of ['/v1', '/api/v1']) {
    const f = fixture();
    f.ports = await detailPorts(f);
    const response = await createChatHandler(f.ports)(f.request(base));
    assert.equal(response.status, 200);
    const frames = (await response.text()).trim().split('\n\n');
    assert.equal(frames.length, 4);
    assert.deepEqual(
      JSON.parse(frames[0]?.slice(6) ?? '{}').choices[0].delta.reasoning_details,
      detailItems,
    );
    assert.deepEqual(
      JSON.parse(frames[1]?.slice(6) ?? '{}').choices[0].delta.reasoning_details,
      [],
    );
    assert.equal(JSON.parse(frames[1]?.slice(6) ?? '{}').choices[0].finish_reason, 'stop');
    assert.equal(
      Object.hasOwn(JSON.parse(frames[2]?.slice(6) ?? '{}').choices[0].delta, 'reasoning_details'),
      false,
    );
    assert.equal(f.records[0]?.outcome, 'succeeded');
    assert.equal(f.records[0]?.usage.status, 'reported');
    assert.equal(
      JSON.stringify({ audit: f.audit, usage: f.records }).includes('private-reasoning'),
      false,
    );
  }
});

test('malformed reasoning-detail first/later chunks fail safely with possible billing', async () => {
  for (const base of ['/v1', '/api/v1']) {
    for (const invalidAt of ['first', 'later'] as const) {
      const f = fixture();
      f.ports = await detailPorts(f, { invalidAt });
      const response = await createChatHandler(f.ports)(f.request(base));
      assert.equal(response.status, invalidAt === 'first' ? 502 : 200);
      const text = await response.text();
      assert.equal(text.includes('[DONE]'), false);
      if (invalidAt === 'first') assert.equal(text.includes('private-reasoning'), false);
      else assert.equal(text.trim().split('\n\n').at(-1)?.includes('private-reasoning'), false);
      assert.equal(f.records.length, 1);
      assert.equal(f.records[0]?.outcome, 'failed');
      assert.equal(f.records[0]?.possiblyBilled, true);
      assert.equal(
        JSON.stringify({ audit: f.audit, usage: f.records }).includes('private-reasoning'),
        false,
      );
    }
  }
});

test('reasoning-detail streams retain authentication, IAM and limit denial before invocation', async () => {
  for (const [variant, status] of [
    ['auth', 401],
    ['iam', 403],
    ['model-deny', 403],
    ['provider-deny', 403],
    ['limit', 429],
  ] as const) {
    const f = fixture();
    f.ports = await detailPorts(f);
    f.ports = {
      ...f.ports,
      invokeOpenRouterTextStream: async () => assert.fail('denial reached upstream'),
    };
    if (variant === 'auth') f.ports = { ...f.ports, authenticate: async () => undefined };
    if (variant === 'iam')
      f.ports = {
        ...f.ports,
        authenticate: async () => ({
          id: 'user-1',
          active: true,
          credentialId: 'credential-1',
          policyVersions: [],
          statements: [],
        }),
      };
    if (variant === 'model-deny' || variant === 'provider-deny') {
      const authenticate = f.ports.authenticate;
      f.ports = {
        ...f.ports,
        authenticate: async (...args) => {
          const principal = await authenticate(...args);
          assert.ok(principal);
          return {
            ...principal,
            statements: [
              ...principal.statements,
              {
                effect: 'Deny' as const,
                actions: [variant === 'model-deny' ? 'llm:InvokeModel' : 'llm:UseProvider'],
                resources: ['*'],
              },
            ],
          };
        },
      };
    }
    if (variant === 'limit') f.ports = { ...f.ports, checkLimit: async () => false };
    const response = await createChatHandler(f.ports)(f.request());
    assert.equal(response.status, status);
    assert.equal(f.records.length, 0);
    assert.equal((await response.text()).includes('private-reasoning'), false);
  }
});

test('reasoning-detail streams suppress terminal success on required ledger/audit failure', async () => {
  for (const failure of ['usage', 'audit'] as const) {
    const f = fixture();
    f.ports = await detailPorts(f);
    if (failure === 'usage')
      f.ports = {
        ...f.ports,
        writeUsage: async () => {
          throw new Error('private-reasoning ledger');
        },
      };
    else
      f.ports = {
        ...f.ports,
        writeAudit: async (event) => {
          if (event.kind === 'delegated-attempt') throw new Error('private-reasoning audit');
          f.audit.push(event);
        },
      };
    const response = await createChatHandler(f.ports)(f.request());
    const text = await response.text();
    assert.equal(text.includes('[DONE]'), false);
    const last = JSON.parse(text.trim().split('\n\n').at(-1)?.slice(6) ?? '{}');
    assert.equal(last.error.code, 503);
    assert.equal(JSON.stringify(last).includes('private-reasoning'), false);
    assert.equal(
      JSON.stringify({ audit: f.audit, usage: f.records }).includes('private-reasoning'),
      false,
    );
  }
});

test('reasoning details in final usage fails safely instead of being discarded', async () => {
  for (const base of ['/v1', '/api/v1']) {
    const f = fixture();
    f.ports = await detailPorts(f, {
      usageDetails: [{ type: 'reasoning.text', text: 'private usage reasoning' }],
    });
    const response = await createChatHandler(f.ports)(f.request(base));
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.equal(text.includes('[DONE]'), false);
    assert.equal(text.includes('private usage reasoning'), false);
    assert.equal(f.records.length, 1);
    assert.equal(f.records[0]?.outcome, 'failed');
    assert.equal(f.records[0]?.possiblyBilled, true);
    assert.equal(JSON.stringify({ audit: f.audit, usage: f.records }).includes('private'), false);
  }
});

const scope = { upstreamModelId: 'upstream', clientModelAlias: 'chat' };
function chunk(delta: object, usage?: object) {
  return JSON.stringify({
    id: 'gen',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'upstream',
    choices: [{ index: 0, delta, finish_reason: usage ? 'stop' : null }],
    ...(usage ? { usage } : {}),
  });
}
test('detail decoder and encoder preserve frames without index or text reconstruction', () => {
  for (const value of [[], detailItems]) {
    const event = decodeOpenRouterStreamPayload(chunk({ reasoning_details: value }), scope);
    assert.equal(event.kind, 'delta');
    assert.ok(event.kind === 'delta');
    assert.deepEqual(event.reasoningDetails, value);
    const encoded = encodeOpenRouterTextSse(event);
    assert.ok(encoded);
    assert.deepEqual(JSON.parse(encoded.slice(6)).choices[0].delta.reasoning_details, value);
  }
  const event = decodeOpenRouterStreamPayload(chunk({ content: 'text' }), scope);
  const encoded = encodeOpenRouterTextSse(event);
  assert.ok(encoded);
  assert.equal(
    Object.hasOwn(JSON.parse(encoded.slice(6)).choices[0].delta, 'reasoning_details'),
    false,
  );
});
test('all supplied usage-only detail fields reject even when token counts are incomplete', () => {
  for (const value of [[], detailItems, null, {}, [{ type: 'reasoning.text', signature: true }]])
    for (const usage of [{}, { prompt_tokens: 1, completion_tokens: 2 }])
      assert.throws(
        () => decodeOpenRouterStreamPayload(chunk({ reasoning_details: value }, usage), scope),
        /Invalid OpenRouter stream chunk/,
      );
});
test('encoder validates injected malformed delta and usage details before incomplete-usage return', () => {
  for (const value of [undefined, null, {}, [{ type: 'reasoning.server_tool_call' }]])
    assert.throws(
      () =>
        encodeOpenRouterTextSse({
          kind: 'delta',
          id: 'gen',
          model: 'chat',
          created: 1,
          finishReason: null,
          reasoningDetails: value,
        } as unknown as OpenRouterTextStreamPayload),
      /Unsupported OpenRouter/,
    );
  for (const value of [[], detailItems])
    assert.throws(
      () =>
        encodeOpenRouterTextSse({
          kind: 'usage',
          id: 'gen',
          model: 'chat',
          created: 1,
          finishReason: 'stop',
          usage: undefined,
          reasoningDetails: value,
        } as unknown as OpenRouterTextStreamPayload),
      /Unsupported OpenRouter/,
    );
});

test('integrated stream details coexist with scalar reasoning and independent metadata', () => {
  const scope = { upstreamModelId: 'openai/example', clientModelAlias: 'chat' };
  const common = {
    id: 'gen-1',
    object: 'chat.completion.chunk',
    created: 42,
    model: 'openai/example',
  };
  const decoded = decodeOpenRouterStreamPayload(
    JSON.stringify({
      ...common,
      system_fingerprint: 'fp-first',
      service_tier: 'priority',
      choices: [
        {
          index: 0,
          delta: { reasoning: 'private-reasoning scalar', reasoning_details: detailItems },
          finish_reason: 'stop',
          native_finish_reason: 'native-stop',
        },
      ],
    }),
    scope,
  );
  const frame = JSON.parse(encodeOpenRouterTextSse(decoded)?.slice(6) ?? '{}');
  assert.deepEqual(frame.choices[0].delta.reasoning_details, detailItems);
  assert.equal(frame.choices[0].delta.reasoning, 'private-reasoning scalar');
  assert.equal(frame.system_fingerprint, 'fp-first');
  assert.equal(frame.service_tier, 'priority');
  assert.equal(frame.choices[0].native_finish_reason, 'native-stop');
  const final = decodeOpenRouterStreamPayload(
    JSON.stringify({
      ...common,
      system_fingerprint: null,
      service_tier: 'default',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop', native_finish_reason: null }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    }),
    scope,
  );
  const last = JSON.parse(encodeOpenRouterTextSse(final)?.slice(6) ?? '{}');
  assert.equal(last.system_fingerprint, null);
  assert.equal(last.service_tier, 'default');
  assert.equal(last.choices[0].native_finish_reason, null);
  assert.equal(Object.hasOwn(last.choices[0].delta, 'reasoning_details'), false);
  assert.equal(Object.hasOwn(last.choices[0].delta, 'reasoning'), false);
});
