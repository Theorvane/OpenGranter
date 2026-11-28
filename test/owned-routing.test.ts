import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOpenRouterChatInvoker } from '../src/providers/openrouter-chat.ts';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';
import { invokeOwnedRoute, type OwnedCandidate } from '../src/routing/owned-route.ts';
import { createJevStrategy } from '../src/routing/owned-strategy.ts';

const candidateZ: OwnedCandidate = {
  id: 'z',
  upstreamModelId: 'gpt',
  providerId: 'openai',
  registrationId: 'direct',
  priority: 1,
  capabilityEligible: true,
  healthy: true,
  quotaEligible: true,
};
const candidateA: OwnedCandidate = { ...candidateZ, id: 'a' };
const candidates = [candidateZ, candidateA];
function fixture(overrides: Partial<Parameters<typeof invokeOwnedRoute<string>>[0]> = {}) {
  const calls: string[] = [];
  const usage: unknown[] = [];
  const audit: unknown[] = [];
  const input: Parameters<typeof invokeOwnedRoute<string>>[0] = {
    principalId: 'user',
    credentialId: 'token',
    policyVersions: [],
    requestId: 'request',
    routeVersion: 'v1',
    modelAlias: 'chat',
    principalActive: true,
    statements: [{ effect: 'Allow', actions: ['llm:*'], resources: ['*'] }],
    registrations: [{ id: 'direct', providerId: 'openai', kind: 'direct' }],
    candidates,
    ports: {
      reserve: async () => {
        calls.push('reserve');
        return {
          complete: async () => {
            calls.push('complete');
          },
        };
      },
      writeAudit: async (event) => {
        audit.push(event);
      },
      writeUsage: async (record) => {
        usage.push(record);
      },
      invokeDirect: async (candidate) => {
        calls.push(candidate.id);
        return 'ok';
      },
      invokeOpenRouter: async () => {
        throw new Error('unexpected OpenRouter');
      },
    },
    ...overrides,
  };
  return { input, calls, usage, audit };
}
test('owned routing uses priority then stable ID and accounts the attempt', async () => {
  const f = fixture();
  assert.equal((await invokeOwnedRoute(f.input)).status, 'invoked');
  assert.deepEqual(f.calls, ['reserve', 'a', 'complete']);
  assert.equal(f.usage.length, 1);
  const priority = fixture({
    candidates: candidates.map((c) => ({ ...c, priority: c.id === 'z' ? 0 : 1 })),
  });
  await invokeOwnedRoute(priority.input);
  assert.deepEqual(priority.calls, ['reserve', 'z', 'complete']);
});
test('default Deny and capability health quota exclusions precede reservation and strategy', async () => {
  for (const override of [
    { statements: [] },
    { principalActive: false },
    ...(['capabilityEligible', 'healthy', 'quotaEligible'] as const).map((flag) => ({
      candidates: candidates.map((c) => ({ ...c, [flag]: false })),
    })),
  ]) {
    const f = fixture(override);
    assert.equal((await invokeOwnedRoute(f.input)).status, 'denied');
    assert.deepEqual(f.calls, []);
  }
});
test('OpenRouter needs transport and final-provider permission and uses a singleton bound', async () => {
  const f = fixture({
    candidates: [{ ...candidateZ, registrationId: 'router', providerSlug: 'OpenAI' }],
    registrations: [
      {
        id: 'router',
        providerId: 'openrouter',
        kind: 'openrouter',
        credentialRef: 'secret/router',
      },
    ],
  });
  for (const resource of ['provider:openai', 'provider:openrouter']) {
    const denied = await invokeOwnedRoute({
      ...f.input,
      statements: [
        ...f.input.statements,
        { effect: 'Deny', actions: ['llm:UseProvider'], resources: [resource] },
      ],
    });
    assert.equal(denied.status, 'denied');
  }
  assert.deepEqual(f.calls, []);
  let attempts = 0;
  const result = await invokeOwnedRoute({
    ...f.input,
    ports: {
      ...f.input.ports,
      invokeOpenRouter: async (ref, attempt) => {
        attempts++;
        assert.equal(ref, 'secret/router');
        assert.deepEqual(attempt, { upstreamModelId: 'gpt', authorizedProviderSlugs: ['OpenAI'] });
        return 'router';
      },
    },
  });
  assert.equal(result.status, 'invoked');
  assert.equal(attempts, 1);
});
test('reservation denial failure and reconciliation failure are explicit and fail closed', async () => {
  for (const reserve of [
    async () => undefined,
    async () => {
      throw new Error('secret');
    },
  ]) {
    const f = fixture();
    assert.equal(
      (await invokeOwnedRoute({ ...f.input, ports: { ...f.input.ports, reserve } })).status,
      'denied',
    );
    assert.deepEqual(f.calls, []);
  }
  const f = fixture();
  const result = await invokeOwnedRoute({
    ...f.input,
    ports: {
      ...f.input.ports,
      reserve: async () => ({
        complete: async () => {
          throw new Error('secret');
        },
      }),
    },
  });
  assert.deepEqual(result, {
    status: 'failed',
    reason: 'reservation-reconciliation',
    possiblyBilled: true,
  });
});
test('untyped composition cannot silently omit required usage accounting', async () => {
  const f = fixture();
  const ports = { ...f.input.ports, writeUsage: undefined } as unknown as typeof f.input.ports;
  assert.deepEqual(await invokeOwnedRoute({ ...f.input, ports }), {
    status: 'denied',
    reason: 'configuration',
  });
  assert.deepEqual(f.calls, []);
});
test('fallback records each attempt and stops at response start or usage failure', async () => {
  for (const responseStarted of [false, true]) {
    const f = fixture();
    let attempts = 0;
    const result = await invokeOwnedRoute({
      ...f.input,
      ports: {
        ...f.input.ports,
        invokeDirect: async () => {
          if (++attempts === 1) throw new DirectProviderFailure('timeout', responseStarted, true);
          return 'ok';
        },
      },
    });
    assert.equal(attempts, responseStarted ? 1 : 2);
    assert.equal(result.status, responseStarted ? 'failed' : 'invoked');
    assert.equal(f.usage.length, responseStarted ? 1 : 2);
  }
  const f = fixture();
  let attempts = 0;
  await invokeOwnedRoute({
    ...f.input,
    ports: {
      ...f.input.ports,
      writeUsage: async () => {
        throw new Error('ledger');
      },
      invokeDirect: async () => {
        attempts++;
        throw new DirectProviderFailure('timeout', false, true);
      },
    },
  });
  assert.equal(attempts, 1);
});
test('owned execution records even explicitly unbilled failed attempts', async () => {
  const f = fixture();
  let attempts = 0;
  await invokeOwnedRoute({
    ...f.input,
    ports: {
      ...f.input.ports,
      invokeDirect: async () => {
        if (++attempts === 1) throw new DirectProviderFailure('timeout', false, false);
        return 'ok';
      },
    },
  });
  assert.equal(attempts, 2);
  assert.equal(f.usage.length, 2);
});
test('required pre-selection audit failure prevents external selection and inference', async () => {
  const f = fixture();
  let decisions = 0;
  const result = await invokeOwnedRoute({
    ...f.input,
    strategy: {
      id: 'fixture',
      select: async () => {
        decisions++;
        return { candidateId: 'a' };
      },
    },
    ports: {
      ...f.input.ports,
      writeAudit: async () => {
        throw new Error('audit');
      },
    },
  });
  assert.equal(result.status, 'failed');
  assert.equal(decisions, 0);
  assert.deepEqual(f.calls, ['reserve', 'complete']);
});
test('Jev disabled and production gates make zero network calls; invalid answers fall back', async () => {
  let calls = 0;
  for (const config of [
    {},
    { enabled: true, environment: 'production' as const },
    { enabled: true, environment: 'research' as const },
  ]) {
    const f = fixture({
      strategy: createJevStrategy({
        ...config,
        fetchDecision: async () => {
          calls++;
          return {};
        },
      }),
    });
    await invokeOwnedRoute(f.input);
    assert.equal(f.calls.includes('a'), true);
  }
  assert.equal(calls, 1);
  const f = fixture({
    strategy: { id: 'untrusted', select: async () => ({ candidateId: 'forbidden' }) },
  });
  await invokeOwnedRoute(f.input);
  assert.equal(f.calls.includes('a'), true);
});
test('strategy receives only eligible metadata and may select a nondefault destination once', async () => {
  const f = fixture({
    candidates: [...candidates, { ...candidateZ, id: 'forbidden', healthy: false }],
  });
  let decisions = 0;
  await invokeOwnedRoute({
    ...f.input,
    strategy: {
      id: 'fixture',
      select: async (metadata) => {
        decisions++;
        assert.deepEqual(
          metadata.map((c) => c.id),
          ['a', 'z'],
        );
        assert.equal(JSON.stringify(metadata).includes('registrationId'), false);
        assert.equal(Object.isFrozen(metadata), true);
        return { candidateId: 'z' };
      },
    },
  });
  assert.equal(decisions, 1);
  assert.deepEqual(f.calls, ['reserve', 'z', 'complete']);
  assert.deepEqual(
    f.audit.find((event) => (event as { kind: string }).kind === 'owned-selection'),
    {
      principalId: 'user',
      credentialId: 'token',
      policyVersions: [],
      requestId: 'request',
      routeVersion: 'v1',
      modelAlias: 'chat',
      kind: 'owned-selection',
      candidateId: 'z',
      selection: 'strategy',
      strategy: 'custom',
    },
  );
});
test('mixed transport fallback composes the existing OpenRouter adapter and records distinct attempts', async () => {
  const f = fixture({
    candidates: [
      candidateA,
      {
        ...candidateZ,
        registrationId: 'router',
        upstreamModelId: 'openai/gpt',
        providerSlug: 'OpenAI',
      },
    ],
    registrations: [
      { id: 'direct', providerId: 'openai', kind: 'direct' },
      {
        id: 'router',
        providerId: 'openrouter',
        kind: 'openrouter',
        credentialRef: 'secret/router',
      },
    ],
  });
  let calls = 0;
  const response = {
    id: 'generation',
    object: 'chat.completion',
    created: 1,
    model: 'openai/gpt',
    choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
  };
  const result = await invokeOwnedRoute({
    ...f.input,
    ports: {
      ...f.input.ports,
      invokeDirect: async () => {
        throw new DirectProviderFailure('timeout', false, false);
      },
      invokeOpenRouter: async (credentialRef, attempt) =>
        createOpenRouterChatInvoker({
          credentialRef,
          resolveSecret: async () => 'fixture-key',
          fetcher: async (url, init) => {
            calls++;
            assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
            const body = JSON.parse(String(init?.body));
            assert.deepEqual(body.provider, { only: ['OpenAI'] });
            assert.equal(body.models, undefined);
            return new Response(JSON.stringify(response));
          },
        })(attempt, { model: 'chat', messages: [{ role: 'user', content: 'fixture prompt' }] }),
    },
  });
  assert.equal(result.status, 'invoked');
  assert.equal(calls, 1);
  assert.equal(f.usage.length, 2);
  assert.deepEqual(
    f.usage.map((record) => (record as { attemptId: string }).attemptId),
    ['request/managed/1', 'request/managed/2'],
  );
  assert.equal(JSON.stringify(f.audit).includes('fixture-key'), false);
  assert.equal(JSON.stringify(f.audit).includes('fixture prompt'), false);
});
