import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invokeJevManagedRoute } from '../src/routing/invoke-jev-managed-route.ts';

const base = {
  requestId: 'request-1',
  routeVersion: 'route-v1',
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
  jev: { credentialRef: 'secret/jev', minimumConfidence: 0.6, sendPrompt: false },
  promptText: 'private content',
};

test('managed invocation checks limits, records decision, then calls only the selected direct adapter', async () => {
  const calls: string[] = [];
  const audit: unknown[] = [];
  const result = await invokeJevManagedRoute({
    ...base,
    ports: {
      checkLimit: async () => {
        calls.push('limit');
        return true;
      },
      resolveSecret: async (ref) => {
        calls.push(`secret:${ref}`);
        return 'test-key';
      },
      writeAudit: async (event) => {
        calls.push(`audit:${event.kind}`);
        audit.push(event);
      },
      invokeDirect: async (candidate) => {
        calls.push(`provider:${candidate.id}`);
        return { content: 'response body' };
      },
      fetchJev: async (_url, init) => {
        calls.push('jev');
        const body = JSON.parse(init.body) as {
          questions: { route: { criteria: Record<string, string> } };
        };
        assert.deepEqual(Object.keys(body.questions.route.criteria), ['openai']);
        return {
          ok: true,
          json: async () => ({
            model: 'jev-1',
            answers: { route: { type: 'choice', choice: 'openai', confidence: 0.9 } },
          }),
        };
      },
    },
  });
  assert.equal(result.status, 'invoked');
  assert.deepEqual(calls, [
    'limit',
    'secret:secret/jev',
    'audit:selection-started',
    'jev',
    'audit:decision',
    'provider:openai',
    'audit:attempt',
  ]);
  assert.equal(JSON.stringify(audit).includes('private content'), false);
  assert.equal(JSON.stringify(audit).includes('test-key'), false);
  assert.equal(JSON.stringify(audit).includes('response body'), false);
});

test('IAM denial does not reach limits, secret store, Jev, or direct adapter', async () => {
  const calls: string[] = [];
  const result = await invokeJevManagedRoute({
    ...base,
    principalActive: false,
    ports: {
      checkLimit: async () => {
        calls.push('limit');
        return true;
      },
      resolveSecret: async () => {
        calls.push('secret');
        return 'key';
      },
      writeAudit: async (event) => {
        calls.push(`audit:${event.kind}`);
      },
      invokeDirect: async () => {
        calls.push('provider');
        return {};
      },
      fetchJev: async () => {
        calls.push('jev');
        throw new Error('unexpected');
      },
    },
  });
  assert.deepEqual(result, { status: 'denied', reason: 'no-candidates' });
  assert.deepEqual(calls, ['audit:denied']);
});

test('limit rejection and missing Jev secret stop before upstream calls', async () => {
  for (const failure of ['limit', 'secret'] as const) {
    const calls: string[] = [];
    const result = await invokeJevManagedRoute({
      ...base,
      ports: {
        checkLimit: async () => {
          calls.push('limit');
          return failure !== 'limit';
        },
        resolveSecret: async () => {
          calls.push('secret');
          return failure === 'secret' ? undefined : 'key';
        },
        writeAudit: async (event) => {
          calls.push(`audit:${event.kind}`);
        },
        invokeDirect: async () => {
          calls.push('provider');
          return {};
        },
        fetchJev: async () => {
          calls.push('jev');
          throw new Error('unexpected');
        },
      },
    });
    assert.equal(result.status, 'denied');
    assert.equal(calls.includes('jev'), false);
    assert.equal(calls.includes('provider'), false);
  }
});

test('decision audit failure prevents direct invocation', async () => {
  let invoked = false;
  let calledJev = false;
  const result = await invokeJevManagedRoute({
    ...base,
    ports: {
      checkLimit: async () => true,
      resolveSecret: async () => 'key',
      writeAudit: async () => {
        throw new Error('audit database unavailable');
      },
      invokeDirect: async () => {
        invoked = true;
        return {};
      },
      fetchJev: async () => {
        calledJev = true;
        return {
          ok: true,
          json: async () => ({
            model: 'jev-1',
            answers: { route: { type: 'choice', choice: 'openai', confidence: 0.9 } },
          }),
        };
      },
    },
  });
  assert.deepEqual(result, { status: 'failed', reason: 'audit-unavailable' });
  assert.equal(invoked, false);
  assert.equal(calledJev, false);
});

test('direct adapter failure records a nonsecret attempt failure', async () => {
  const audit: unknown[] = [];
  const result = await invokeJevManagedRoute({
    ...base,
    ports: {
      checkLimit: async () => true,
      resolveSecret: async () => 'key',
      writeAudit: async (event) => {
        audit.push(event);
      },
      invokeDirect: async () => {
        throw new Error('sensitive provider response');
      },
      fetchJev: async () => ({
        ok: true,
        json: async () => ({
          model: 'jev-1',
          answers: { route: { type: 'choice', choice: 'openai', confidence: 0.9 } },
        }),
      }),
    },
  });
  assert.deepEqual(result, { status: 'failed', reason: 'provider-failed' });
  assert.equal(JSON.stringify(audit).includes('sensitive provider response'), false);
  assert.equal(JSON.stringify(audit).includes('"outcome":"failed"'), true);
});

test('post-invocation audit failure reports possible billing without replaying the provider', async () => {
  let directCalls = 0;
  const result = await invokeJevManagedRoute({
    ...base,
    ports: {
      checkLimit: async () => true,
      resolveSecret: async () => 'key',
      writeAudit: async (event) => {
        if (event.kind === 'attempt') throw new Error('audit write failed');
      },
      invokeDirect: async () => {
        directCalls++;
        return { content: 'response body' };
      },
      fetchJev: async () => ({
        ok: true,
        json: async () => ({
          model: 'jev-1',
          answers: { route: { type: 'choice', choice: 'openai', confidence: 0.9 } },
        }),
      }),
    },
  });
  assert.deepEqual(result, {
    status: 'failed',
    reason: 'outcome-audit-unavailable',
    possiblyBilled: true,
  });
  assert.equal(directCalls, 1);
});
