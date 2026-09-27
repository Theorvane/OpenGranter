import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenRouterChatFailure } from '../src/providers/openrouter-chat.ts';
import { invokeDelegatedRoute } from '../src/routing/invoke-delegated-route.ts';
import {
  DirectProviderFailure,
  invokeJevManagedRoute,
} from '../src/routing/invoke-jev-managed-route.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

const attribution = {
  principalId: 'person-1',
  credentialId: 'credential-1',
  policyVersions: [{ id: 'policy-1', version: 'v1' }],
  requestId: 'request-1',
  routeVersion: 'route-1',
  principalActive: true,
  modelAlias: 'chat',
  statements: [
    { effect: 'Allow' as const, actions: ['llm:InvokeModel'], resources: ['model:chat'] },
    { effect: 'Allow' as const, actions: ['llm:UseProvider'], resources: ['provider:*'] },
  ],
};

const completion = {
  id: 'response-1',
  object: 'chat.completion',
  created: 1,
  model: 'chat',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'private response' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
};

test('managed route hands off one content-free usage record for an upstream success', async () => {
  const records: UsageRecord[] = [];
  const result = await invokeJevManagedRoute({
    ...attribution,
    candidates: [{ id: 'direct-1', kind: 'managed', providerId: 'openai', upstreamModelId: 'gpt' }],
    jev: { credentialRef: 'jev-ref', minimumConfidence: 0, sendPrompt: false },
    ports: {
      checkLimit: async () => true,
      resolveSecret: async () => 'secret',
      writeAudit: async () => {},
      writeUsage: async (record: UsageRecord) => {
        records.push(record);
      },
      now: () => 100,
      invokeDirect: async () => completion,
      fetchJev: async () => {
        throw new Error('Jev unavailable');
      },
    },
  });
  assert.equal(result.status, 'invoked');
  assert.equal(records.length, 1);
  assert.equal(records[0]?.attemptId, 'request-1/managed/1');
  assert.equal(records[0]?.actualInferenceProviderId, 'openai');
  assert.deepEqual(records[0]?.usage, {
    status: 'reported',
    promptTokens: 3,
    completionTokens: 4,
    totalTokens: 7,
  });
  assert.equal(JSON.stringify(records).includes('private response'), false);
  assert.equal(JSON.stringify(records).includes('secret'), false);
});

test('delegated route records a possibly billed failure with unknown provider and no content', async () => {
  const records: UsageRecord[] = [];
  const result = await invokeDelegatedRoute({
    ...attribution,
    credentialRef: 'router-ref',
    candidates: [
      {
        id: 'router-1',
        kind: 'delegated',
        providerId: 'provider-1',
        upstreamModelId: 'vendor/model',
      },
    ],
    request: { model: 'chat', messages: [{ role: 'user', content: 'private prompt' }] },
    ports: {
      checkLimit: async () => true,
      writeAudit: async () => {},
      writeUsage: async (record: UsageRecord) => {
        records.push(record);
      },
      now: () => 100,
      resolveVerifiedProviderSlug: async () => 'vendor',
      invokeOpenRouter: async () => {
        throw new OpenRouterChatFailure('timeout', false, true);
      },
    },
  });
  assert.equal(result.status, 'failed');
  assert.equal(records.length, 1);
  assert.equal(records[0]?.attemptId, 'request-1/delegated/1');
  assert.equal(records[0]?.actualInferenceProviderId, null);
  assert.equal(records[0]?.possiblyBilled, true);
  assert.equal(records[0]?.usage.status, 'missing');
  assert.equal(JSON.stringify(records).includes('private prompt'), false);
});

test('delegated route does not attribute an OpenRouter choice to the first allowed candidate', async () => {
  const records: UsageRecord[] = [];
  await invokeDelegatedRoute({
    ...attribution,
    credentialRef: 'router-ref',
    candidates: [
      { id: 'first', kind: 'delegated', providerId: 'provider-1', upstreamModelId: 'vendor/model' },
      {
        id: 'second',
        kind: 'delegated',
        providerId: 'provider-2',
        upstreamModelId: 'vendor/model',
      },
    ],
    request: { model: 'chat', messages: [{ role: 'user', content: 'private prompt' }] },
    ports: {
      checkLimit: async () => true,
      writeAudit: async () => {},
      writeUsage: async (record: UsageRecord) => {
        records.push(record);
      },
      now: () => 100,
      resolveVerifiedProviderSlug: async (id) => id,
      invokeOpenRouter: async () => completion,
    },
  });
  assert.equal(records.length, 1);
  assert.equal(records[0]?.selectedCandidateId, null);
  assert.equal(records[0]?.actualInferenceProviderId, null);
});

test('managed fallback records both attempts and stops when ledger handoff fails', async () => {
  const records: UsageRecord[] = [];
  let calls = 0;
  const result = await invokeJevManagedRoute({
    ...attribution,
    candidates: [
      { id: 'first', kind: 'managed', providerId: 'openai', upstreamModelId: 'gpt' },
      { id: 'second', kind: 'managed', providerId: 'anthropic', upstreamModelId: 'claude' },
    ],
    jev: { credentialRef: 'jev-ref', minimumConfidence: 0, sendPrompt: false },
    ports: {
      checkLimit: async () => true,
      resolveSecret: async () => 'secret',
      writeAudit: async () => {},
      writeUsage: async (record: UsageRecord) => {
        records.push(record);
        throw new Error('ledger down');
      },
      now: () => 100,
      invokeDirect: async () => {
        calls++;
        throw new DirectProviderFailure('timeout', false, true);
      },
      fetchJev: async () => {
        throw new Error('Jev unavailable');
      },
    },
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'usage-unavailable');
  assert.equal(calls, 1);
  assert.equal(records.length, 1);
});

test('managed fallback records distinct attempts and possible duplicate billing', async () => {
  const records: UsageRecord[] = [];
  let calls = 0;
  const result = await invokeJevManagedRoute({
    ...attribution,
    candidates: [
      { id: 'first', kind: 'managed', providerId: 'openai', upstreamModelId: 'gpt' },
      { id: 'second', kind: 'managed', providerId: 'anthropic', upstreamModelId: 'claude' },
    ],
    jev: { credentialRef: 'jev-ref', minimumConfidence: 0, sendPrompt: false },
    ports: {
      checkLimit: async () => true,
      resolveSecret: async () => 'secret',
      writeAudit: async () => {},
      writeUsage: async (record: UsageRecord) => {
        records.push(record);
      },
      now: () => 100,
      invokeDirect: async () => {
        calls++;
        if (calls === 1) throw new DirectProviderFailure('timeout', false, true);
        return completion;
      },
      fetchJev: async () => {
        throw new Error('Jev unavailable');
      },
    },
  });
  assert.equal(result.status, 'invoked');
  assert.deepEqual(
    records.map((record) => record.attemptId),
    ['request-1/managed/1', 'request-1/managed/2'],
  );
  assert.deepEqual(
    records.map((record) => record.possibleDuplicate),
    [false, true],
  );
  assert.deepEqual(
    records.map((record) => record.outcome),
    ['failed', 'succeeded'],
  );
});

test('IAM denial produces no usage handoff or provider call', async () => {
  const records: UsageRecord[] = [];
  let calls = 0;
  const result = await invokeDelegatedRoute({
    ...attribution,
    principalActive: false,
    credentialRef: 'router-ref',
    candidates: [
      { id: 'one', kind: 'delegated', providerId: 'provider-1', upstreamModelId: 'vendor/model' },
    ],
    request: { model: 'chat', messages: [{ role: 'user', content: 'private prompt' }] },
    ports: {
      checkLimit: async () => true,
      writeAudit: async () => {},
      writeUsage: async (record: UsageRecord) => {
        records.push(record);
      },
      resolveVerifiedProviderSlug: async () => 'vendor',
      invokeOpenRouter: async () => {
        calls++;
        return completion;
      },
    },
  });
  assert.equal(result.status, 'denied');
  assert.equal(calls, 0);
  assert.deepEqual(records, []);
});

test('known preflight credential failure creates no upstream usage record', async () => {
  const records: UsageRecord[] = [];
  await invokeDelegatedRoute({
    ...attribution,
    credentialRef: 'router-ref',
    candidates: [
      { id: 'one', kind: 'delegated', providerId: 'provider-1', upstreamModelId: 'vendor/model' },
    ],
    request: { model: 'chat', messages: [{ role: 'user', content: 'private prompt' }] },
    ports: {
      checkLimit: async () => true,
      writeAudit: async () => {},
      writeUsage: async (record: UsageRecord) => {
        records.push(record);
      },
      resolveVerifiedProviderSlug: async () => 'vendor',
      invokeOpenRouter: async () => {
        throw new OpenRouterChatFailure('credential', false, false);
      },
    },
  });
  assert.deepEqual(records, []);
});
