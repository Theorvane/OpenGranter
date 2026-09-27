import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DirectProviderFailure,
  invokeJevManagedRoute,
} from '../src/routing/invoke-jev-managed-route.ts';

const base = {
  principalId: 'user-1',
  credentialId: 'credential-1',
  policyVersions: [{ id: 'policy-1', version: 'v3' }],
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

const twoAllowed = {
  ...base,
  statements: [
    { effect: 'Allow' as const, actions: ['llm:InvokeModel'], resources: ['model:chat'] },
    { effect: 'Allow' as const, actions: ['llm:UseProvider'], resources: ['provider:openai'] },
    { effect: 'Allow' as const, actions: ['llm:UseProvider'], resources: ['provider:anthropic'] },
  ],
};

function jevSelectsOpenAi() {
  return {
    ok: true,
    json: async () => ({
      model: 'jev-1',
      answers: { route: { type: 'choice', choice: 'openai', confidence: 0.9 } },
    }),
  };
}

test('pre-response timeout falls back to next authorized managed candidate once', async () => {
  const attempted: string[] = [];
  const audit: unknown[] = [];
  let jevCalls = 0;
  const result = await invokeJevManagedRoute({
    ...twoAllowed,
    ports: {
      checkLimit: async () => true,
      resolveSecret: async () => 'key',
      writeAudit: async (event) => {
        audit.push(event);
      },
      invokeDirect: async (candidate) => {
        attempted.push(candidate.id);
        if (candidate.id === 'openai') {
          throw new DirectProviderFailure('timeout', false, true);
        }
        return { content: 'from backup' };
      },
      fetchJev: async () => {
        jevCalls++;
        return jevSelectsOpenAi();
      },
    },
  });
  assert.equal(result.status, 'invoked');
  if (result.status === 'invoked') assert.equal(result.candidate.id, 'anthropic');
  assert.deepEqual(attempted, ['openai', 'anthropic']);
  assert.equal(jevCalls, 1);
  assert.deepEqual(
    audit
      .filter((event) => (event as { kind: string }).kind === 'attempt')
      .map((event) => ({
        candidateId: (event as { candidateId: string }).candidateId,
        outcome: (event as { outcome: string }).outcome,
      })),
    [
      { candidateId: 'openai', outcome: 'failed' },
      { candidateId: 'anthropic', outcome: 'succeeded' },
    ],
  );
  for (const event of audit) {
    assert.equal((event as { principalId?: string }).principalId, 'user-1');
    assert.equal((event as { credentialId?: string }).credentialId, 'credential-1');
    assert.deepEqual((event as { policyVersions?: unknown }).policyVersions, [
      { id: 'policy-1', version: 'v3' },
    ]);
  }
});

test('unclassified or post-response failure does not fall back', async () => {
  for (const failure of [
    new Error('sensitive upstream error'),
    new DirectProviderFailure('server-error', true, true),
    new DirectProviderFailure('other', false, false),
  ]) {
    const attempted: string[] = [];
    const result = await invokeJevManagedRoute({
      ...twoAllowed,
      ports: {
        checkLimit: async () => true,
        resolveSecret: async () => 'key',
        writeAudit: async () => {},
        invokeDirect: async (candidate) => {
          attempted.push(candidate.id);
          throw failure;
        },
        fetchJev: async () => jevSelectsOpenAi(),
      },
    });
    assert.equal(result.status, 'failed');
    assert.deepEqual(attempted, ['openai']);
  }
});

test('exhausted retryable candidates stop without repeating any route', async () => {
  const attempted: string[] = [];
  const result = await invokeJevManagedRoute({
    ...twoAllowed,
    ports: {
      checkLimit: async () => true,
      resolveSecret: async () => 'key',
      writeAudit: async () => {},
      invokeDirect: async (candidate) => {
        attempted.push(candidate.id);
        throw new DirectProviderFailure('timeout', false, true);
      },
      fetchJev: async () => jevSelectsOpenAi(),
    },
  });
  assert.equal(result.status, 'failed');
  assert.deepEqual(attempted, ['openai', 'anthropic']);
});

test('failed attempt audit write stops fallback before the next provider', async () => {
  const attempted: string[] = [];
  const result = await invokeJevManagedRoute({
    ...twoAllowed,
    ports: {
      checkLimit: async () => true,
      resolveSecret: async () => 'key',
      writeAudit: async (event) => {
        if (event.kind === 'attempt') throw new Error('audit failed');
      },
      invokeDirect: async (candidate) => {
        attempted.push(candidate.id);
        throw new DirectProviderFailure('server-error', false, true);
      },
      fetchJev: async () => jevSelectsOpenAi(),
    },
  });
  assert.equal(result.status, 'failed');
  assert.deepEqual(attempted, ['openai']);
});

test('Jev outage begins with the authorized first route and still permits provider fallback', async () => {
  const attempted: string[] = [];
  let jevCalls = 0;
  const result = await invokeJevManagedRoute({
    ...twoAllowed,
    ports: {
      checkLimit: async () => true,
      resolveSecret: async () => 'key',
      writeAudit: async () => {},
      invokeDirect: async (candidate) => {
        attempted.push(candidate.id);
        if (candidate.id === 'openai') {
          throw new DirectProviderFailure('timeout', false, true);
        }
        return { content: 'backup response' };
      },
      fetchJev: async () => {
        jevCalls++;
        return { ok: false, json: async () => ({}) };
      },
    },
  });
  assert.equal(result.status, 'invoked');
  if (result.status === 'invoked') {
    assert.equal(result.candidate.id, 'anthropic');
    assert.equal(result.decision.source, 'fallback');
    assert.equal(result.possiblyBilled, true);
  }
  assert.deepEqual(attempted, ['openai', 'anthropic']);
  assert.equal(jevCalls, 1);
});
