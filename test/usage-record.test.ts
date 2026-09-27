import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildUsageRecord, InvalidUsageRecordInput } from '../src/usage/record-usage.ts';

const base = {
  requestId: 'request-1',
  attemptId: 'request-1/attempt-1',
  principalId: 'service-1',
  credentialId: 'credential-1',
  policyVersions: [{ id: 'policy-1', version: 'v3' }],
  modelAlias: 'approved-chat',
  routeKind: 'delegated' as const,
  upstreamModelId: 'openai/gpt-4o',
  selectedCandidateId: 'candidate-1',
  actualInferenceProviderId: undefined,
  occurredAt: 1_700_000_000_000,
  latencyMs: 42,
  outcome: 'succeeded' as const,
  possiblyBilled: true,
  possibleDuplicate: false,
};

test('complete usage record separates reported tokens, estimate, and upstream charge', () => {
  const record = buildUsageRecord({
    ...base,
    providerUsage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    estimatedCost: { amountDecimal: '0.000003', currency: 'USD', priceVersion: 'prices-v4' },
    upstreamBilledCost: { amountDecimal: '0.000004', currency: 'USD', source: 'openrouter' },
  });
  assert.deepEqual(record, {
    requestId: 'request-1',
    attemptId: 'request-1/attempt-1',
    principalId: 'service-1',
    credentialId: 'credential-1',
    policyVersions: [{ id: 'policy-1', version: 'v3' }],
    modelAlias: 'approved-chat',
    routeKind: 'delegated',
    upstreamModelId: 'openai/gpt-4o',
    selectedCandidateId: 'candidate-1',
    actualInferenceProviderId: null,
    occurredAt: 1_700_000_000_000,
    latencyMs: 42,
    outcome: 'succeeded',
    possiblyBilled: true,
    possibleDuplicate: false,
    usage: { status: 'reported', promptTokens: 3, completionTokens: 2, totalTokens: 5 },
    estimatedCost: { amountDecimal: '0.000003', currency: 'USD', priceVersion: 'prices-v4' },
    upstreamBilledCost: { amountDecimal: '0.000004', currency: 'USD', source: 'openrouter' },
  });
});

test('missing, partial, and invalid provider usage keep unknown counts distinct from zero', () => {
  const missing = buildUsageRecord(base);
  assert.deepEqual(missing.usage, {
    status: 'missing',
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
  });
  assert.equal(missing.estimatedCost, null);
  assert.equal(missing.upstreamBilledCost, null);

  const partial = buildUsageRecord({
    ...base,
    providerUsage: { prompt_tokens: 0, completion_tokens: 2 },
  });
  assert.deepEqual(partial.usage, {
    status: 'partial',
    promptTokens: 0,
    completionTokens: 2,
    totalTokens: null,
  });

  for (const providerUsage of [
    { prompt_tokens: -1, completion_tokens: 2, total_tokens: 1 },
    { prompt_tokens: 1.5, completion_tokens: 2, total_tokens: 3.5 },
    { prompt_tokens: '3', completion_tokens: 2, total_tokens: 5 },
    { prompt_tokens: Number.MAX_SAFE_INTEGER + 1, completion_tokens: 2, total_tokens: 5 },
  ]) {
    assert.deepEqual(buildUsageRecord({ ...base, providerUsage }).usage, {
      status: 'invalid',
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });
  }
});

test('failed possibly billed attempts retain distinct attempt IDs and unknown actual provider', () => {
  const first = buildUsageRecord({
    ...base,
    outcome: 'failed',
    possiblyBilled: true,
    possibleDuplicate: false,
  });
  const second = buildUsageRecord({
    ...base,
    attemptId: 'request-1/attempt-2',
    routeKind: 'managed',
    actualInferenceProviderId: 'anthropic',
    outcome: 'succeeded',
    possibleDuplicate: true,
  });
  assert.equal(first.requestId, second.requestId);
  assert.notEqual(first.attemptId, second.attemptId);
  assert.equal(first.actualInferenceProviderId, null);
  assert.equal(first.outcome, 'failed');
  assert.equal(second.actualInferenceProviderId, 'anthropic');
  assert.equal(second.possibleDuplicate, true);
});

test('invalid money or attribution is rejected with a fixed safe error', () => {
  for (const invalid of [
    { ...base, estimatedCost: { amountDecimal: '1e-6', currency: 'USD', priceVersion: 'v1' } },
    { ...base, estimatedCost: { amountDecimal: '-1', currency: 'USD', priceVersion: 'v1' } },
    {
      ...base,
      upstreamBilledCost: { amountDecimal: '0.1', currency: 'usd', source: 'openrouter' },
    },
    { ...base, estimatedCost: { amountDecimal: '0.1', currency: 'USD', priceVersion: '' } },
    { ...base, principalId: '' },
    { ...base, attemptId: '' },
    { ...base, latencyMs: -1 },
  ]) {
    assert.throws(
      () => buildUsageRecord(invalid),
      (error: unknown) => {
        assert.ok(error instanceof InvalidUsageRecordInput);
        assert.equal(error.message, 'Invalid usage record input');
        return true;
      },
    );
  }
});

test('record copies only approved metadata and excludes content and secrets', () => {
  const contaminatedInput = {
    ...base,
    providerUsage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
      prompt: 'sensitive prompt',
    },
    providerKey: 'sensitive key',
    response: 'sensitive response',
    proxyToken: 'sensitive token',
  };
  const record = buildUsageRecord(contaminatedInput);
  assert.equal(JSON.stringify(record).includes('sensitive'), false);
  assert.deepEqual(
    Object.keys(record).sort(),
    [
      'actualInferenceProviderId',
      'attemptId',
      'credentialId',
      'estimatedCost',
      'latencyMs',
      'modelAlias',
      'occurredAt',
      'outcome',
      'policyVersions',
      'possibleDuplicate',
      'possiblyBilled',
      'principalId',
      'requestId',
      'routeKind',
      'selectedCandidateId',
      'upstreamBilledCost',
      'upstreamModelId',
      'usage',
    ].sort(),
  );
});
