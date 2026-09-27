import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectAuthorizedManagedCandidate } from '../src/routing/select-managed-candidate.ts';

const candidates = [
  { id: 'openai', kind: 'managed' as const, upstreamModelId: 'gpt', providerId: 'openai' },
  { id: 'anthropic', kind: 'managed' as const, upstreamModelId: 'claude', providerId: 'anthropic' },
  { id: 'delegated', kind: 'delegated' as const, upstreamModelId: 'router', providerId: 'openai' },
];

const input = {
  principalActive: true,
  modelAlias: 'chat',
  candidates,
  statements: [
    { effect: 'Allow' as const, actions: ['llm:InvokeModel'], resources: ['model:chat'] },
    { effect: 'Allow' as const, actions: ['llm:UseProvider'], resources: ['provider:openai'] },
    { effect: 'Deny' as const, actions: ['llm:UseProvider'], resources: ['provider:anthropic'] },
  ],
};

test('managed selector receives only authorized direct candidates', async () => {
  const result = await selectAuthorizedManagedCandidate({
    ...input,
    select: async (eligible) => {
      assert.deepEqual(
        eligible.map((candidate) => candidate.id),
        ['openai'],
      );
      return 'openai';
    },
  });
  assert.equal(result.status, 'selected');
  if (result.status === 'selected') assert.equal(result.candidate.id, 'openai');
});

test('managed selector cannot choose a denied or invented candidate', async () => {
  for (const chosenId of ['anthropic', 'delegated', 'invented']) {
    const result = await selectAuthorizedManagedCandidate({
      ...input,
      select: async () => chosenId,
    });
    assert.deepEqual(result, { status: 'invalid-choice' });
  }
});

test('no authorized candidate means no selector call', async () => {
  let called = false;
  const result = await selectAuthorizedManagedCandidate({
    ...input,
    principalActive: false,
    select: async () => {
      called = true;
      return 'openai';
    },
  });
  assert.deepEqual(result, { status: 'no-candidates' });
  assert.equal(called, false);
});
