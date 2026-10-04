import assert from 'node:assert/strict';
import test from 'node:test';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';
import { invokeManagedFunctionStream } from '../src/streaming/invoke-managed-function-stream.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

function fixture() {
  const frames: string[] = [];
  const usage: UsageRecord[] = [];
  const audits: unknown[] = [];
  const calls: string[] = [];
  const input: Parameters<typeof invokeManagedFunctionStream>[0] = {
    principalId: 'p',
    credentialId: 'c',
    policyVersions: [],
    principalActive: true,
    requestId: 'r',
    routeVersion: 'v',
    modelAlias: 'alias',
    candidates: ['one', 'two'].map((id) => ({
      id,
      kind: 'managed' as const,
      providerId: 'openai',
      upstreamModelId: 'native',
    })),
    statements: [
      {
        effect: 'Allow',
        actions: ['llm:InvokeModel', 'llm:UseProvider'],
        resources: ['model:alias', 'provider:openai'],
      },
    ],
    request: { model: 'alias', messages: [{ role: 'user', content: 'private prompt' }] },
    onFrame: async (frame) => {
      frames.push(frame);
    },
    ports: {
      checkLimit: async () => true,
      resolveSecret: async () => 'unused',
      writeUsage: async (record) => {
        usage.push(record);
      },
      writeAudit: async (event) => {
        audits.push(event);
      },
      invokeDirectFunctionStream: async (candidate, request, onDelta) => {
        calls.push(candidate.id);
        assert.equal(request.model, 'alias');
        await onDelta({
          kind: 'delta',
          id: 's',
          created: 4,
          model: 'alias',
          toolCalls: [
            {
              index: 0,
              id: 'call',
              type: 'function',
              function: { name: 'lookup', arguments: '{"q":"private argument"}' },
            },
          ],
          finishReason: null,
        });
        await onDelta({
          kind: 'delta',
          id: 's',
          created: 4,
          model: 'alias',
          finishReason: 'tool_calls',
        });
        return {
          status: 'complete',
          id: 's',
          model: 'alias',
          finishReason: 'tool_calls',
          usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
          toolCalls: [
            {
              id: 'call',
              type: 'function',
              function: { name: 'lookup', arguments: '{"q":"private argument"}' },
            },
          ],
        };
      },
    },
  };
  return { input, frames, usage, audits, calls };
}

test('managed stream retains IAM/limit/usage/audit and gates final frames', async () => {
  const f = fixture();
  const result = await invokeManagedFunctionStream(f.input);
  assert.equal(result.status, 'invoked');
  if (result.status !== 'invoked') return;
  assert.deepEqual(f.calls, ['one']);
  assert.ok(!JSON.stringify(result.response).includes('private'));
  assert.ok(!Object.hasOwn(result.response, 'toolCalls'));
  assert.ok(f.frames[0]?.includes('tool_calls'));
  assert.equal(f.frames.length, 2);
  assert.ok(result.finalFrames.at(-1)?.includes('[DONE]'));
  assert.equal(f.usage[0]?.actualInferenceProviderId, 'openai');
  assert.equal(f.usage[0]?.attemptId, 'r/managed/1');
  assert.ok(!JSON.stringify([...f.usage, ...f.audits]).includes('private'));
});
for (const resource of ['model:alias', 'provider:openai'])
  test(`managed stream explicit Deny ${resource}`, async () => {
    const f = fixture();
    const result = await invokeManagedFunctionStream({
      ...f.input,
      statements: [
        ...f.input.statements,
        { effect: 'Deny', actions: ['llm:*'], resources: [resource] },
      ],
    });
    assert.equal(result.status, 'denied');
    assert.deepEqual(f.calls, []);
  });
for (const boundary of ['limit', 'usage', 'audit', 'missing-usage'] as const)
  test(`managed stream fails closed at ${boundary}`, async () => {
    const f = fixture();
    const ports = { ...f.input.ports };
    if (boundary === 'limit') ports.checkLimit = async () => false;
    if (boundary === 'usage')
      ports.writeUsage = async () => {
        throw Error('private ledger');
      };
    if (boundary === 'missing-usage') delete ports.writeUsage;
    if (boundary === 'audit')
      ports.writeAudit = async (event) => {
        if (event.kind === 'attempt') throw Error('private audit');
      };
    const result = await invokeManagedFunctionStream({ ...f.input, ports });
    assert.notEqual(result.status, 'invoked');
    assert.ok(!('finalFrames' in result));
    if (boundary === 'limit' || boundary === 'missing-usage') assert.deepEqual(f.calls, []);
  });
test('managed stream never retries after emitted output despite misclassified failure', async () => {
  const f = fixture();
  const result = await invokeManagedFunctionStream({
    ...f.input,
    ports: {
      ...f.input.ports,
      invokeDirectFunctionStream: async (candidate, _chat, onDelta) => {
        f.calls.push(candidate.id);
        await onDelta({
          kind: 'delta',
          id: 's',
          created: 4,
          model: 'alias',
          content: 'private answer',
          finishReason: null,
        });
        throw new DirectProviderFailure('server-error', false, false);
      },
    },
  });
  assert.equal(result.status, 'failed');
  assert.deepEqual(f.calls, ['one']);
  assert.equal(f.usage[0]?.possiblyBilled, true);
});
test('managed stream keeps classified fallback before output within authorized scope', async () => {
  const f = fixture();
  const invoke = f.input.ports.invokeDirectFunctionStream;
  const result = await invokeManagedFunctionStream({
    ...f.input,
    ports: {
      ...f.input.ports,
      invokeDirectFunctionStream: async (candidate, chat, onDelta, signal) => {
        if (candidate.id === 'one') {
          f.calls.push(candidate.id);
          throw new DirectProviderFailure('rate-limit', false, true);
        }
        return invoke(candidate, chat, onDelta, signal);
      },
    },
  });
  assert.equal(result.status, 'invoked');
  assert.deepEqual(f.calls, ['one', 'two']);
  assert.equal(f.usage[1]?.possibleDuplicate, true);
});
for (const invalid of [
  'missing-terminal',
  'wrong-alias',
  'changed-identity',
  'delivery',
  'cancel',
] as const)
  test(`managed stream rejects ${invalid}`, async () => {
    const f = fixture();
    const cancellation = new AbortController();
    const result = await invokeManagedFunctionStream({
      ...f.input,
      signal: cancellation.signal,
      onFrame: async () => {
        if (invalid === 'delivery') throw Error('private callback');
        if (invalid === 'cancel') cancellation.abort();
      },
      ports: {
        ...f.input.ports,
        invokeDirectFunctionStream: async (candidate, _chat, onDelta) => {
          f.calls.push(candidate.id);
          await onDelta({
            kind: 'delta',
            id: 's',
            created: 4,
            model: invalid === 'wrong-alias' ? 'native' : 'alias',
            finishReason: null,
          });
          if (invalid !== 'missing-terminal')
            await onDelta({
              kind: 'delta',
              id: invalid === 'changed-identity' ? 'changed' : 's',
              created: 4,
              model: 'alias',
              finishReason: 'tool_calls',
            });
          return {
            status: 'complete',
            id: 's',
            model: 'alias',
            finishReason: 'tool_calls',
            usage: undefined,
          };
        },
      },
    });
    assert.equal(result.status, 'failed');
    assert.deepEqual(f.calls, ['one']);
  });
