import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { type ChatHandlerPorts, createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import { OpenRouterChatFailure } from '../src/providers/openrouter-chat.ts';
import type {
  OpenRouterFunctionStreamPayload,
  OpenRouterTextStreamPayload,
} from '../src/streaming/openrouter-stream-chunks.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

type Delta = Extract<OpenRouterFunctionStreamPayload, { kind: 'delta' }>;
const chat = {
  model: 'chat',
  messages: [{ role: 'user', content: 'private prompt' }],
  stream: true,
  tools: [{ type: 'function', function: { name: 'lookup' } }],
  tool_choice: 'auto',
  parallel_tool_calls: false,
};
const delta = (finishReason: Delta['finishReason'] = null): Delta => ({
  kind: 'delta',
  id: 'gen-1',
  model: 'chat',
  created: 42,
  ...(finishReason === null
    ? {
        toolCalls: [
          {
            index: 0,
            id: 'call',
            type: 'function' as const,
            function: { name: 'lookup', arguments: '{"q":"private 終"}' },
          },
        ],
        role: 'assistant' as const,
      }
    : {}),
  finishReason,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
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
    invokeOpenRouterFunctionStream: async (ref, attempt, request, onDelta, signal) => {
      calls++;
      assert.equal(ref, 'secret/openrouter');
      assert.deepEqual(attempt.authorizedProviderSlugs, ['OpenAI']);
      assert.equal(request.model, 'chat');
      assert.ok(signal);
      callbacks++;
      await onDelta(delta());
      callbacks++;
      await onDelta(delta('tool_calls'));
      return {
        status: 'complete',
        id: 'gen-1',
        model: 'chat',
        finishReason: 'tool_calls',
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

test('both public chat bases accept function controls and complete tool histories', async () => {
  for (const base of ['/v1', '/api/v1']) {
    const f = fixture();
    const messages = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'previous', type: 'function', function: { name: 'lookup', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'previous', content: 'private result' },
      ...chat.messages,
    ];
    const original = f.ports.invokeOpenRouterFunctionStream;
    assert.ok(original);
    const ports = {
      ...f.ports,
      invokeOpenRouterFunctionStream: async (...args: Parameters<typeof original>) => {
        assert.deepEqual(args[2].tools, chat.tools);
        assert.equal(args[2].tool_choice, 'auto');
        assert.equal(args[2].parallel_tool_calls, false);
        assert.deepEqual(args[2].messages, messages);
        return original(...args);
      },
    };
    const response = await createChatHandler(ports)(f.request(base, { ...chat, messages }));
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(body.includes('"tool_calls"'));
    assert.ok(body.endsWith('data: [DONE]\n\n'));
    assert.equal(f.calls(), 1);
    assert.equal(f.records[0]?.outcome, 'succeeded');
    assert.equal(JSON.stringify([f.audit, f.records]).includes('private'), false);
  }
});

test('text-only installations retain pre-routing tool guards and managed streams remain unsupported', async () => {
  const f = fixture();
  const { invokeOpenRouterFunctionStream: _unused, ...ports } = f.ports;
  const textOnly = {
    ...ports,
    invokeOpenRouterTextStream: async () => assert.fail('unexpected text invoke'),
  };
  for (const extra of [
    { tools: [] },
    { tool_choice: 'none' },
    { parallel_tool_calls: false },
    {
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'call', content: 'result' },
      ],
    },
  ]) {
    const response = await createChatHandler(textOnly)(
      f.request('/api/v1', { model: 'chat', messages: chat.messages, stream: true, ...extra }),
    );
    assert.equal(response.status, 400);
  }
  const response = await createChatHandler({
    ...f.ports,
    resolveRoute: async () => ({
      kind: 'managed',
      version: 'v1',
      candidates: [
        { id: 'direct', kind: 'managed', providerId: 'openai', upstreamModelId: 'example' },
      ],
    }),
  })(f.request());
  assert.equal(response.status, 400);
  assert.equal(f.calls(), 0);
});

test('malformed declarations and incomplete histories fail before invocation', async () => {
  for (const extra of [
    { tools: [{ type: 'function', function: { name: '' } }] },
    { tool_choice: null },
    { parallel_tool_calls: 42 },
    { messages: [{ role: 'tool', tool_call_id: 'missing', content: 'private' }] },
  ]) {
    const f = fixture();
    const response = await createChatHandler(f.ports)(f.request('/v1', { ...chat, ...extra }));
    assert.equal(response.status, 400);
    assert.equal(f.calls(), 0);
    assert.equal(f.records.length, 0);
  }
});

test('function requests retain authentication, IAM Deny and limit boundaries', async () => {
  for (const variant of ['auth', 'model', 'provider', 'limit'] as const) {
    const f = fixture(),
      auth = f.ports.authenticate;
    const ports = {
      ...f.ports,
      authenticate: async (token: string) => {
        if (variant === 'auth') return undefined;
        const principal = await auth(token);
        assert.ok(principal);
        return {
          ...principal,
          statements:
            variant === 'model'
              ? [{ effect: 'Deny' as const, actions: ['llm:InvokeModel'], resources: ['*'] }]
              : variant === 'provider'
                ? [
                    ...principal.statements,
                    { effect: 'Deny' as const, actions: ['llm:UseProvider'], resources: ['*'] },
                  ]
                : principal.statements,
        };
      },
      checkLimit: async () => variant !== 'limit',
    };
    const response = await createChatHandler(ports)(f.request());
    assert.equal(response.status, variant === 'auth' ? 401 : variant === 'limit' ? 429 : 403);
    assert.equal(f.calls(), 0);
    assert.equal(JSON.stringify(f.audit).includes('private'), false);
  }
});

test('function stream required persistence failure sends no final usage or DONE', async () => {
  for (const variant of ['usage', 'audit'] as const) {
    const f = fixture();
    const ports = {
      ...f.ports,
      ...(variant === 'usage'
        ? {
            writeUsage: async () => {
              throw Error('private ledger');
            },
          }
        : {
            writeAudit: async (event: Parameters<typeof f.ports.writeAudit>[0]) => {
              if (event.kind === 'delegated-attempt') throw Error('private audit');
              f.audit.push(event);
            },
          }),
    };
    const response = await createChatHandler(ports)(f.request());
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.equal(body.includes('[DONE]'), false);
    assert.equal(body.includes('"usage"'), false);
    assert.equal(body.includes('private ledger'), false);
    assert.equal(body.includes('private audit'), false);
    assert.equal(JSON.stringify(f.audit).includes('private'), false);
  }
});

test('ordinary streams use installed text adapter and function-only installations still deliver text', async () => {
  for (const textInstalled of [true, false]) {
    const f = fixture();
    let texts = 0,
      functions = 0;
    const plain = async (
      onDelta: (
        delta: Extract<OpenRouterTextStreamPayload, { kind: 'delta' }>,
      ) => void | Promise<void>,
    ) => {
      await onDelta({
        kind: 'delta',
        id: 'text',
        model: 'chat',
        created: 42,
        content: 'private text',
        finishReason: null,
      });
      await onDelta({
        kind: 'delta',
        id: 'text',
        model: 'chat',
        created: 42,
        finishReason: 'stop',
      });
      return {
        status: 'complete' as const,
        id: 'text',
        model: 'chat',
        finishReason: 'stop' as const,
        usage: undefined,
      };
    };
    const ports: ChatHandlerPorts<unknown> = {
      ...f.ports,
      invokeOpenRouterFunctionStream: async (_ref, _attempt, _request, onDelta) => {
        functions++;
        return plain(onDelta);
      },
      ...(textInstalled
        ? {
            invokeOpenRouterTextStream: async (_ref, _attempt, _request, onDelta) => {
              texts++;
              return plain(onDelta);
            },
          }
        : {}),
    };
    const response = await createChatHandler(ports)(
      f.request('/v1', { model: 'chat', messages: chat.messages, stream: true }),
    );
    assert.equal(response.status, 200);
    assert.ok((await response.text()).endsWith('data: [DONE]\n\n'));
    assert.equal(texts, textInstalled ? 1 : 0);
    assert.equal(functions, textInstalled ? 0 : 1);
    assert.equal(f.records[0]?.usage.status, 'missing');
  }
});
