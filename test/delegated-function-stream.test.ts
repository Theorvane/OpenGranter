import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatRequest } from '../src/gateway/chat-handler.ts';
import { OpenRouterChatFailure } from '../src/providers/openrouter-chat.ts';
import type { DelegatedRouteAuditEvent } from '../src/routing/invoke-delegated-route.ts';
import { invokeDelegatedFunctionStream } from '../src/streaming/invoke-delegated-function-stream.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

const request: ChatRequest = {
  model: 'approved-chat',
  messages: [{ role: 'user', content: 'private prompt' }],
};
const candidates = [
  {
    id: 'allowed',
    kind: 'delegated' as const,
    upstreamModelId: 'openai/example',
    providerId: 'openai',
  },
  {
    id: 'denied',
    kind: 'delegated' as const,
    upstreamModelId: 'openai/example',
    providerId: 'other',
  },
];
const statements = [
  { effect: 'Allow' as const, actions: ['llm:InvokeModel'], resources: ['model:approved-chat'] },
  { effect: 'Allow' as const, actions: ['llm:UseProvider'], resources: ['provider:openai'] },
];

function fixture() {
  const order: string[] = [];
  const frames: string[] = [];
  const usage: UsageRecord[] = [];
  const audit: DelegatedRouteAuditEvent[] = [];
  const input: Parameters<typeof invokeDelegatedFunctionStream>[0] = {
    principalId: 'principal-1',
    credentialId: 'proxy-credential',
    policyVersions: [],
    principalActive: true,
    modelAlias: 'approved-chat',
    requestId: 'req-1',
    routeVersion: 'v1',
    credentialRef: 'secret/openrouter',
    candidates,
    statements,
    request,
    onFrame: async (frame) => {
      order.push('frame');
      frames.push(frame);
    },
    ports: {
      resolveVerifiedProviderSlug: async (providerId) => {
        order.push('map');
        return providerId === 'openai' ? 'OpenAI' : undefined;
      },
      checkLimit: async () => {
        order.push('limit');
        return true;
      },
      writeAudit: async (event) => {
        order.push(`audit:${event.kind}`);
        audit.push(event);
      },
      writeUsage: async (record) => {
        order.push('usage');
        usage.push(record);
      },
      invokeOpenRouterFunctionStream: async (ref, attempt, chat, onDelta) => {
        order.push('invoke');
        assert.equal(ref, 'secret/openrouter');
        assert.deepEqual(attempt, {
          upstreamModelId: 'openai/example',
          authorizedProviderSlugs: ['OpenAI'],
        });
        assert.deepEqual(chat, request);
        await onDelta({
          kind: 'delta',
          id: 'gen-1',
          created: 42,
          model: 'approved-chat',
          role: 'assistant',
          toolCalls: [
            {
              index: 0,
              id: 'call',
              type: 'function',
              function: { name: 'lookup', arguments: 'private arguments\n\ndata: forged' },
            },
          ],
          finishReason: null,
        });
        await onDelta({
          kind: 'delta',
          id: 'gen-1',
          created: 42,
          model: 'approved-chat',
          finishReason: 'tool_calls',
        });
        return {
          status: 'complete',
          id: 'gen-1',
          model: 'approved-chat',
          finishReason: 'tool_calls',
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
          toolCalls: [
            {
              id: 'call',
              type: 'function',
              function: { name: 'lookup', arguments: 'private arguments' },
            },
          ],
        };
      },
    },
  };
  return { input, order, frames, usage, audit };
}

test('passes authorized function fragments through IAM, limit, usage and audit before final frames', async () => {
  const f = fixture();
  const result = await invokeDelegatedFunctionStream(f.input);
  assert.equal(result.status, 'invoked');
  if (result.status !== 'invoked') return;
  assert.deepEqual(f.order, [
    'map',
    'limit',
    'audit:delegated-selection',
    'invoke',
    'frame',
    'frame',
    'usage',
    'audit:delegated-attempt',
  ]);
  assert.equal(f.frames.length, 2);
  assert.equal(f.frames[0]?.includes('approved-chat'), true);
  assert.equal(f.frames[0]?.includes('openai/example'), false);
  assert.equal(f.frames[0]?.match(/\ndata:/g), null);
  assert.equal(f.usage[0]?.outcome, 'succeeded');
  assert.deepEqual(f.usage[0]?.usage, {
    status: 'reported',
    promptTokens: 3,
    completionTokens: 2,
    totalTokens: 5,
  });
  assert.equal(f.audit[1]?.kind, 'delegated-attempt');
  assert.deepEqual(
    result.finalFrames.map((frame) => (frame.startsWith('data: [DONE]') ? '[DONE]' : 'usage')),
    ['usage', '[DONE]'],
  );
  assert.deepEqual(JSON.parse(result.finalFrames[0]?.slice(6, -2) ?? '{}').usage, {
    prompt_tokens: 3,
    completion_tokens: 2,
    total_tokens: 5,
  });
  assert.equal(
    JSON.stringify({ audit: f.audit, usage: f.usage, response: result.response }).includes(
      'private',
    ),
    false,
  );
  assert.equal(Object.hasOwn(result.response, 'toolCalls'), false);
  assert.equal(
    JSON.parse(f.frames[0]!.slice(6)).choices[0].delta.tool_calls[0].function.arguments,
    'private arguments\n\ndata: forged',
  );
});

test('model/provider IAM and limit denials send no frames or upstream calls', async () => {
  for (const variant of ['model', 'provider', 'limit'] as const) {
    const f = fixture();
    const input = {
      ...f.input,
      statements:
        variant === 'model'
          ? statements.slice(1)
          : variant === 'provider'
            ? statements.slice(0, 1)
            : statements,
      ports:
        variant === 'limit' ? { ...f.input.ports, checkLimit: async () => false } : f.input.ports,
    };
    const result = await invokeDelegatedFunctionStream(input);
    assert.equal(result.status, 'denied');
    assert.equal(f.frames.length, 0);
    assert.equal(f.usage.length, 0);
    assert.equal(f.order.includes('invoke'), false);
  }
});

test('missing trusted streaming invoker fails configuration before a provider call', async () => {
  const f = fixture();
  const { invokeOpenRouterFunctionStream: _unused, ...ports } = f.input.ports;
  const result = await invokeDelegatedFunctionStream({ ...f.input, ports });
  assert.deepEqual(result, { status: 'denied', reason: 'configuration' });
  assert.equal(f.frames.length, 0);
  assert.equal(f.usage.length, 0);
  assert.equal(f.order.includes('invoke'), false);
});

test('upstream and output failures keep a failed possibly billed record without final frames', async () => {
  for (const variant of ['upstream', 'output'] as const) {
    const f = fixture();
    const result = await invokeDelegatedFunctionStream({
      ...f.input,
      ...(variant === 'output'
        ? {
            onFrame: async () => {
              throw new Error('private writer');
            },
          }
        : {}),
      ports:
        variant === 'upstream'
          ? {
              ...f.input.ports,
              invokeOpenRouterFunctionStream: async () => {
                throw new OpenRouterChatFailure('upstream', true, true);
              },
            }
          : f.input.ports,
    });
    assert.deepEqual(result, { status: 'failed', reason: 'upstream-failed', possiblyBilled: true });
    assert.equal(f.usage[0]?.outcome, 'failed');
    assert.equal(f.usage[0]?.possiblyBilled, true);
    assert.equal(f.audit.at(-1)?.kind, 'delegated-attempt');
  }
});

test('usage or success-audit handoff failure never returns terminal success frames', async () => {
  for (const variant of ['usage', 'audit'] as const) {
    const f = fixture();
    const result = await invokeDelegatedFunctionStream({
      ...f.input,
      ports: {
        ...f.input.ports,
        ...(variant === 'usage'
          ? {
              writeUsage: async () => {
                throw new Error('private ledger');
              },
            }
          : {
              writeAudit: async (event) => {
                if (event.kind === 'delegated-attempt') throw new Error('private audit');
                f.audit.push(event);
              },
            }),
      },
    });
    assert.equal(result.status, 'failed');
    assert.equal(f.frames.length, 2);
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
});

test('inconsistent trusted stream outcome cannot be accounted as success', async () => {
  const f = fixture();
  const result = await invokeDelegatedFunctionStream({
    ...f.input,
    ports: {
      ...f.input.ports,
      invokeOpenRouterFunctionStream: async () => ({
        status: 'complete',
        id: 'gen-1',
        model: 'approved-chat',
        finishReason: 'tool_calls',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    },
  });
  assert.equal(result.status, 'failed');
  assert.equal(f.usage[0]?.outcome, 'failed');
});

test('missing final usage remains missing in the ledger and sends only DONE', async () => {
  const f = fixture();
  const result = await invokeDelegatedFunctionStream({
    ...f.input,
    ports: {
      ...f.input.ports,
      invokeOpenRouterFunctionStream: async (_ref, _attempt, _request, onDelta) => {
        await onDelta({
          kind: 'delta',
          id: 'gen-1',
          created: 42,
          model: 'approved-chat',
          finishReason: 'tool_calls',
        });
        return {
          status: 'complete',
          id: 'gen-1',
          model: 'approved-chat',
          finishReason: 'tool_calls',
          usage: undefined,
        };
      },
    },
  });
  assert.equal(result.status, 'invoked');
  if (result.status !== 'invoked') return;
  assert.deepEqual(result.finalFrames, ['data: [DONE]\n\n']);
  assert.deepEqual(f.usage[0]?.usage, {
    status: 'missing',
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
  });
});

test('frame callbacks receive frozen identity-only metadata', async () => {
  const f = fixture();
  const identities: unknown[] = [];
  const result = await invokeDelegatedFunctionStream({
    ...f.input,
    onFrame: async (frame, identity) => {
      assert.equal(Object.isFrozen(identity), true);
      assert.deepEqual(Object.keys(identity).sort(), ['created', 'id', 'model']);
      const payload = JSON.parse(frame.slice(6));
      assert.deepEqual(identity, {
        id: payload.id,
        created: payload.created,
        model: payload.model,
      });
      identities.push(identity);
    },
  });
  assert.equal(result.status, 'invoked');
  assert.equal(identities.length, 2);
  assert.equal(JSON.stringify(identities).includes('private'), false);
});

test('stream tier final handoff captures once and keeps callback identity/accounting metadata clean', async () => {
  const f = fixture(),
    original = f.input.ports.invokeOpenRouterFunctionStream;
  assert.ok(original);
  let reads = 0;
  const result = await invokeDelegatedFunctionStream({
    ...f.input,
    onFrame: async (frame, identity) => {
      assert.equal(Object.isFrozen(identity), true);
      assert.deepEqual(Object.keys(identity).sort(), ['created', 'id', 'model']);
      assert.equal(JSON.parse(frame.slice(6)).service_tier, 'private-delta-tier');
    },
    ports: {
      ...f.input.ports,
      invokeOpenRouterFunctionStream: async (ref, attempt, chat, onDelta, signal) => {
        const outcome = await original(
          ref,
          attempt,
          chat,
          (delta) => onDelta({ ...delta, serviceTier: 'private-delta-tier' }),
          signal,
        );
        return Object.defineProperty({ ...outcome }, 'serviceTier', {
          get: () => {
            reads++;
            return reads === 1 ? 'private-final-tier' : { invalid: true };
          },
        });
      },
    },
  });
  assert.equal(result.status, 'invoked');
  if (result.status !== 'invoked') assert.fail('fixture');
  assert.equal(
    JSON.parse(result.finalFrames[0]?.slice(6) ?? '{}').service_tier,
    'private-final-tier',
  );
  assert.equal(reads, 1);
  assert.doesNotMatch(JSON.stringify([f.usage, f.audit]), /tier/u);
});

test('explicit Deny overrides Allow and prevents function delivery', async () => {
  const f = fixture();
  const result = await invokeDelegatedFunctionStream({
    ...f.input,
    statements: [
      ...statements,
      { effect: 'Deny', actions: ['llm:UseProvider'], resources: ['provider:openai'] },
    ],
  });
  assert.equal(result.status, 'denied');
  assert.equal(f.frames.length, 0);
  assert.equal(f.order.includes('invoke'), false);
  assert.ok(f.audit.length > 0);
});

test('selection audit failure prevents function invocation', async () => {
  const f = fixture();
  const result = await invokeDelegatedFunctionStream({
    ...f.input,
    ports: {
      ...f.input.ports,
      writeAudit: async () => {
        throw Error('private audit');
      },
    },
  });
  assert.equal(result.status, 'failed');
  assert.equal(f.order.includes('invoke'), false);
  assert.equal(f.frames.length, 0);
  assert.equal(f.usage.length, 0);
});

test('accounting projection never reads assembled response tool calls', async () => {
  const f = fixture(),
    original = f.input.ports.invokeOpenRouterFunctionStream;
  assert.ok(original);
  const result = await invokeDelegatedFunctionStream({
    ...f.input,
    ports: {
      ...f.input.ports,
      invokeOpenRouterFunctionStream: async (...args) =>
        Object.defineProperty(await original(...args), 'toolCalls', {
          get() {
            throw Error('private response accessor');
          },
        }),
    },
  });
  assert.equal(result.status, 'invoked');
  assert.equal(JSON.stringify([result, f.audit, f.usage]).includes('private'), false);
});

test('real scoped function transport flows through accounting, with cancellation failing safely', async () => {
  const { createOpenRouterFunctionStreamInvoker } = await import(
    '../src/providers/openrouter-function-stream.ts'
  );
  for (const cancel of [false, true]) {
    const f = fixture(),
      controller = new AbortController();
    let fetches = 0;
    const transport = createOpenRouterFunctionStreamInvoker({
      credentialRef: 'secret/openrouter',
      resolveSecret: async () => 'private-key',
      fetcher: async (url, init) => {
        fetches++;
        assert.equal(String(url), 'https://openrouter.ai/api/v1/chat/completions');
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, 'openai/example');
        assert.deepEqual(body.provider, { only: ['OpenAI'] });
        const chunk = (delta: object, finish: string | null, extra = {}) =>
          'data: ' +
          JSON.stringify({
            id: 'gen-1',
            object: 'chat.completion.chunk',
            created: 42,
            model: 'openai/example',
            choices: [{ index: 0, delta, finish_reason: finish }],
            ...extra,
          }) +
          '\n\n';
        return new Response(
          chunk(
            {
              tool_calls: [
                {
                  index: 0,
                  id: 'call',
                  type: 'function',
                  function: { name: 'lookup', arguments: 'private args' },
                },
              ],
            },
            null,
          ) +
            chunk({}, 'tool_calls') +
            chunk({}, 'tool_calls', {
              usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
            }) +
            'data: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
    });
    const result = await invokeDelegatedFunctionStream({
      ...f.input,
      signal: controller.signal,
      onFrame: async (frame) => {
        f.frames.push(frame);
        if (cancel) controller.abort();
      },
      ports: {
        ...f.input.ports,
        invokeOpenRouterFunctionStream: async (ref, attempt, chat, onDelta, signal) => {
          assert.equal(ref, 'secret/openrouter');
          return transport(attempt, chat, onDelta, signal);
        },
      },
    });
    assert.equal(fetches, 1);
    assert.equal(result.status, cancel ? 'failed' : 'invoked');
    assert.equal(f.usage[0]?.outcome, cancel ? 'failed' : 'succeeded');
    assert.equal(f.usage[0]?.possiblyBilled, true);
    assert.equal(JSON.stringify([result, f.usage, f.audit]).includes('private'), false);
    if (result.status === 'invoked') assert.equal(result.finalFrames.at(-1), 'data: [DONE]\n\n');
  }
});

test('awaits function delivery before usage and audit completion', async () => {
  const f = fixture();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    first = new Promise<void>((resolve) => {
      entered = resolve;
    });
  const operation = invokeDelegatedFunctionStream({
    ...f.input,
    onFrame: async () => {
      entered();
      await gate;
    },
  });
  await first;
  assert.equal(f.usage.length, 0);
  assert.equal(
    f.audit.some((event) => event.kind === 'delegated-attempt'),
    false,
  );
  release();
  const result = await operation;
  assert.equal(result.status, 'invoked');
  assert.equal(f.usage.length, 1);
});

test('malformed function delivery fails safely without success frames or response leakage', async () => {
  const f = fixture();
  const result = await invokeDelegatedFunctionStream({
    ...f.input,
    ports: {
      ...f.input.ports,
      invokeOpenRouterFunctionStream: async (_ref, _attempt, _chat, onDelta) => {
        await onDelta({
          kind: 'delta',
          id: 'gen-1',
          created: 42,
          model: 'approved-chat',
          finishReason: null,
          toolCalls: [{ index: 0, function: { arguments: 42 } } as never],
        });
        assert.fail('invalid function fragment accepted');
      },
    },
  });
  assert.deepEqual(result, { status: 'failed', reason: 'upstream-failed', possiblyBilled: true });
  assert.equal(f.frames.length, 0);
  assert.equal(f.usage[0]?.outcome, 'failed');
  assert.equal(JSON.stringify([result, f.audit, f.usage]).includes('private'), false);
});
