import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectManagedWithJev } from '../src/routing/jev-managed-routing.ts';

const base = {
  principalActive: true,
  modelAlias: 'chat',
  candidates: [
    { id: 'openai', kind: 'managed' as const, upstreamModelId: 'gpt', providerId: 'openai' },
    {
      id: 'anthropic',
      kind: 'managed' as const,
      upstreamModelId: 'claude',
      providerId: 'anthropic',
    },
  ],
  statements: [
    { effect: 'Allow' as const, actions: ['llm:InvokeModel'], resources: ['model:chat'] },
    { effect: 'Allow' as const, actions: ['llm:UseProvider'], resources: ['provider:openai'] },
    { effect: 'Deny' as const, actions: ['llm:UseProvider'], resources: ['provider:anthropic'] },
  ],
  jev: { apiKey: 'test-secret', minimumConfidence: 0.6, sendPrompt: false },
  promptText: 'confidential prompt',
};

test('Jev receives only authorized candidates and no prompt by default', async () => {
  let requests = 0;
  const result = await selectManagedWithJev({
    ...base,
    fetcher: async (url, init) => {
      requests++;
      assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
      assert.equal(init.headers?.authorization, 'Bearer test-secret');
      const body = JSON.parse(init.body ?? '') as Record<string, unknown>;
      assert.equal(JSON.stringify(body).includes('confidential prompt'), false);
      const questions = body.questions as { route: { criteria: Record<string, string> } };
      assert.deepEqual(Object.keys(questions.route.criteria), ['openai']);
      return {
        ok: true,
        json: async () => ({
          model: 'jev-1',
          answers: {
            route: {
              type: 'choice',
              choice: 'openai',
              confidence: 0.9,
              probabilities: { openai: 1 },
            },
          },
          usage: { input_tokens: 20, output_tokens: 3 },
        }),
      };
    },
  });
  assert.equal(requests, 1);
  assert.equal(result.status, 'selected');
  if (result.status === 'selected') {
    assert.equal(result.candidate.id, 'openai');
    assert.deepEqual(result.decision, {
      source: 'jev',
      model: 'jev-1',
      confidence: 0.9,
      usage: { inputTokens: 20, outputTokens: 3 },
    });
  }
});

test('Jev receives prompt only when route explicitly enables it', async () => {
  await selectManagedWithJev({
    ...base,
    jev: { ...base.jev, sendPrompt: true },
    fetcher: async (_url, init) => {
      const body = JSON.parse(init.body) as { state: { prompt: string } };
      assert.equal(body.state.prompt, 'confidential prompt');
      return {
        ok: true,
        json: async () => ({
          model: 'jev-1',
          answers: { route: { type: 'choice', choice: 'openai', confidence: 0.9 } },
        }),
      };
    },
  });
});

test('invalid, denied, low-confidence, and failed Jev choices use first eligible route', async () => {
  for (const answer of [
    { type: 'choice', choice: 'anthropic', confidence: 0.9 },
    { type: 'choice', choice: 'unknown', confidence: 0.9 },
    { type: 'choice', choice: 'openai', confidence: 0.2 },
    { type: 'choice', choice: 23, confidence: 0.9 },
  ]) {
    const result = await selectManagedWithJev({
      ...base,
      fetcher: async () => ({
        ok: true,
        json: async () => ({ model: 'jev-1', answers: { route: answer } }),
      }),
    });
    assert.equal(result.status, 'selected');
    if (result.status === 'selected') {
      assert.equal(result.candidate.id, 'openai');
      assert.equal(result.decision.source, 'fallback');
    }
  }
  const failed = await selectManagedWithJev({
    ...base,
    fetcher: async () => ({ ok: false, status: 429, json: async () => ({ detail: 'secret' }) }),
  });
  assert.equal(failed.status, 'selected');
  if (failed.status === 'selected') assert.equal(failed.decision.source, 'fallback');
});

test('no authorized candidates never calls Jev', async () => {
  const result = await selectManagedWithJev({
    ...base,
    principalActive: false,
    fetcher: async () => {
      throw new Error('unexpected Jev call');
    },
  });
  assert.deepEqual(result, { status: 'no-candidates' });
});
