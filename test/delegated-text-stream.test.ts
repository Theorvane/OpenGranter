import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatRequest } from '../src/gateway/chat-handler.ts';
import { OpenRouterChatFailure } from '../src/providers/openrouter-chat.ts';
import type { DelegatedRouteAuditEvent } from '../src/routing/invoke-delegated-route.ts';
import { invokeDelegatedTextStream } from '../src/streaming/invoke-delegated-text-stream.ts';
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
  const input: Parameters<typeof invokeDelegatedTextStream>[0] = {
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
      invokeOpenRouterTextStream: async (ref, attempt, chat, onDelta) => {
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
          content: 'private answer\n\ndata: forged',
          finishReason: null,
        });
        await onDelta({
          kind: 'delta',
          id: 'gen-1',
          created: 42,
          model: 'approved-chat',
          finishReason: 'stop',
        });
        return {
          status: 'complete',
          id: 'gen-1',
          model: 'approved-chat',
          finishReason: 'stop',
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        };
      },
    },
  };
  return { input, order, frames, usage, audit };
}

test('passes authorized text through IAM, limit, usage and audit before final frames', async () => {
  const f = fixture();
  const result = await invokeDelegatedTextStream(f.input);
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
  assert.equal(JSON.stringify({ audit: f.audit, usage: f.usage }).includes('private'), false);
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
    const result = await invokeDelegatedTextStream(input);
    assert.equal(result.status, 'denied');
    assert.equal(f.frames.length, 0);
    assert.equal(f.usage.length, 0);
    assert.equal(f.order.includes('invoke'), false);
  }
});

test('missing trusted streaming invoker fails configuration before a provider call', async () => {
  const f = fixture();
  const { invokeOpenRouterTextStream: _unused, ...ports } = f.input.ports;
  const result = await invokeDelegatedTextStream({ ...f.input, ports });
  assert.deepEqual(result, { status: 'denied', reason: 'configuration' });
  assert.equal(f.frames.length, 0);
  assert.equal(f.usage.length, 0);
  assert.equal(f.order.includes('invoke'), false);
});

test('upstream and output failures keep a failed possibly billed record without final frames', async () => {
  for (const variant of ['upstream', 'output'] as const) {
    const f = fixture();
    const result = await invokeDelegatedTextStream({
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
              invokeOpenRouterTextStream: async () => {
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
    const result = await invokeDelegatedTextStream({
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
  const result = await invokeDelegatedTextStream({
    ...f.input,
    ports: {
      ...f.input.ports,
      invokeOpenRouterTextStream: async () => ({
        status: 'complete',
        id: 'gen-1',
        model: 'approved-chat',
        finishReason: 'stop',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    },
  });
  assert.equal(result.status, 'failed');
  assert.equal(f.usage[0]?.outcome, 'failed');
});

test('missing final usage remains missing in the ledger and sends only DONE', async () => {
  const f = fixture();
  const result = await invokeDelegatedTextStream({
    ...f.input,
    ports: {
      ...f.input.ports,
      invokeOpenRouterTextStream: async (_ref, _attempt, _request, onDelta) => {
        await onDelta({
          kind: 'delta',
          id: 'gen-1',
          created: 42,
          model: 'approved-chat',
          finishReason: 'stop',
        });
        return {
          status: 'complete',
          id: 'gen-1',
          model: 'approved-chat',
          finishReason: 'stop',
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
  const result = await invokeDelegatedTextStream({
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
