import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type ChatHandlerPorts, createChatHandler } from '../src/gateway/chat-handler.ts';
import { OpenRouterChatFailure } from '../src/providers/openrouter-chat.ts';

const delegatedRoute = {
  kind: 'delegated' as const,
  version: 'v7',
  credentialRef: 'secret/openrouter',
  candidates: [
    {
      id: 'denied',
      kind: 'delegated' as const,
      upstreamModelId: 'openai/gpt-4o',
      providerId: 'anthropic',
    },
    {
      id: 'allowed',
      kind: 'delegated' as const,
      upstreamModelId: 'openai/gpt-4o',
      providerId: 'openai',
    },
  ],
};
const principal = {
  id: 'user-1',
  active: true,
  credentialId: 'credential-1',
  policyVersions: [{ id: 'policy-1', version: 'v3' }],
  statements: [
    { effect: 'Allow' as const, actions: ['llm:InvokeModel'], resources: ['model:chat'] },
    {
      effect: 'Allow' as const,
      actions: ['llm:UseProvider'],
      resources: ['provider:openai', 'provider:anthropic'],
    },
    { effect: 'Deny' as const, actions: ['llm:UseProvider'], resources: ['provider:anthropic'] },
  ],
};
const completion = {
  id: 'generation-1',
  object: 'chat.completion',
  created: 100,
  model: 'chat',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
};
function request(token = 'proxy-token') {
  return new Request('http://localhost/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'chat', messages: [{ role: 'user', content: 'Hello' }] }),
  });
}

test('delegated HTTP route sends only IAM-authorized final-provider slugs', async () => {
  const calls: string[] = [];
  const audit: unknown[] = [];
  const handler = createChatHandler({
    newRequestId: () => 'req-delegated',
    authenticate: async () => {
      calls.push('authenticate');
      return principal;
    },
    resolveRoute: async () => {
      calls.push('route');
      return delegatedRoute;
    },
    resolveVerifiedProviderSlug: async (providerId: string, modelId: string) => {
      calls.push(`map:${providerId}:${modelId}`);
      return providerId === 'openai' ? 'azure' : undefined;
    },
    checkLimit: async () => {
      calls.push('limit');
      return true;
    },
    resolveSecret: async () => {
      throw new Error('unexpected Jev secret resolution');
    },
    writeAudit: async (event) => {
      calls.push(`audit:${event.kind}`);
      audit.push(event);
    },
    invokeDirect: async () => {
      throw new Error('unexpected direct call');
    },
    invokeOpenRouter: async (credentialRef: string, attempt: unknown, chat: unknown) => {
      calls.push('openrouter');
      assert.equal(credentialRef, 'secret/openrouter');
      assert.deepEqual(attempt, {
        upstreamModelId: 'openai/gpt-4o',
        authorizedProviderSlugs: ['azure'],
      });
      assert.deepEqual(chat, { model: 'chat', messages: [{ role: 'user', content: 'Hello' }] });
      return completion;
    },
    fetchJev: async () => {
      throw new Error('unexpected Jev call');
    },
  });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), completion);
  assert.deepEqual(calls, [
    'authenticate',
    'route',
    'map:openai:openai/gpt-4o',
    'limit',
    'audit:delegated-selection',
    'openrouter',
    'audit:delegated-attempt',
  ]);
  assert.deepEqual(
    audit.map((event) => (event as { kind: string }).kind),
    ['delegated-selection', 'delegated-attempt'],
  );
  for (const event of audit) {
    assert.deepEqual(
      (event as { authorizedProviderSlugs?: readonly string[] }).authorizedProviderSlugs,
      ['azure'],
    );
  }
  assert.equal(JSON.stringify(audit).includes('proxy-token'), false);
});

function fixture() {
  const state = {
    routeCalls: 0,
    mappingCalls: 0,
    limitCalls: 0,
    upstreamCalls: 0,
    audit: [] as unknown[],
  };
  const ports: ChatHandlerPorts<typeof completion> = {
    newRequestId: () => 'req-guard',
    authenticate: async () => principal,
    resolveRoute: async () => {
      state.routeCalls++;
      return delegatedRoute;
    },
    resolveVerifiedProviderSlug: async () => {
      state.mappingCalls++;
      return 'azure';
    },
    checkLimit: async () => {
      state.limitCalls++;
      return true;
    },
    resolveSecret: async () => {
      throw new Error('unexpected direct secret resolution');
    },
    writeAudit: async (event) => {
      state.audit.push(event);
    },
    invokeDirect: async () => {
      throw new Error('unexpected direct call');
    },
    invokeOpenRouter: async () => {
      state.upstreamCalls++;
      return completion;
    },
  };
  return { ports, state };
}

test('delegated route rejects missing identity and inactive principal before route lookup', async () => {
  for (const active of [undefined, false]) {
    const { ports, state } = fixture();
    const response = await createChatHandler({
      ...ports,
      authenticate: async () => (active === undefined ? undefined : { ...principal, active }),
    })(request());
    assert.equal(response.status, 401);
    assert.equal(state.routeCalls, 0);
    assert.equal(state.upstreamCalls, 0);
    assert.deepEqual(state.audit, [{ kind: 'auth-denied', requestId: 'req-guard' }]);
  }
});

test('delegated route stops on model or final-provider Deny before mapping and limits', async () => {
  for (const denial of [
    { effect: 'Deny' as const, actions: ['llm:InvokeModel'], resources: ['model:chat'] },
    { effect: 'Deny' as const, actions: ['llm:UseProvider'], resources: ['provider:openai'] },
  ]) {
    const { ports, state } = fixture();
    const response = await createChatHandler({
      ...ports,
      authenticate: async () => ({ ...principal, statements: [...principal.statements, denial] }),
    })(request());
    assert.equal(response.status, 403);
    assert.equal(state.mappingCalls, 0);
    assert.equal(state.limitCalls, 0);
    assert.equal(state.upstreamCalls, 0);
    assert.equal((state.audit[0] as { kind: string }).kind, 'delegated-denied');
    assert.equal((state.audit[0] as { reason: string }).reason, 'no-candidates');
    assert.equal((state.audit[0] as { principalId: string }).principalId, 'user-1');
  }
});

test('delegated route rejects absent, failed, malformed, and ambiguous provider mappings', async () => {
  for (const mapping of [
    async () => undefined,
    async () => {
      throw new Error('sensitive mapping detail');
    },
    async () => 'unsafe\nslug',
  ]) {
    const { ports, state } = fixture();
    const response = await createChatHandler({
      ...ports,
      resolveVerifiedProviderSlug: mapping,
    })(request());
    assert.equal(response.status, 503);
    assert.equal(state.limitCalls, 0);
    assert.equal(state.upstreamCalls, 0);
    assert.equal((state.audit[0] as { reason: string }).reason, 'mapping-unavailable');
    assert.equal((await response.text()).includes('sensitive'), false);
  }

  const { ports, state } = fixture();
  const response = await createChatHandler({
    ...ports,
    authenticate: async () => ({
      ...principal,
      statements: [
        { effect: 'Allow', actions: ['llm:InvokeModel'], resources: ['model:chat'] },
        {
          effect: 'Allow',
          actions: ['llm:UseProvider'],
          resources: ['provider:openai', 'provider:anthropic'],
        },
      ],
    }),
    resolveVerifiedProviderSlug: async () => 'same-slug',
  })(request());
  assert.equal(response.status, 503);
  assert.equal(state.upstreamCalls, 0);
  assert.equal((state.audit[0] as { reason: string }).reason, 'mapping-unavailable');
});

test('delegated limit denial and failure stop before selection and upstream calls', async () => {
  for (const checkLimit of [
    async () => false,
    async () => {
      throw new Error('sensitive limit detail');
    },
  ]) {
    const { ports, state } = fixture();
    const response = await createChatHandler({ ...ports, checkLimit })(request());
    assert.equal(response.status, 429);
    assert.equal(state.upstreamCalls, 0);
    assert.deepEqual(
      state.audit.map((event) => (event as { kind: string }).kind),
      ['delegated-denied'],
    );
    assert.equal((state.audit[0] as { reason: string }).reason, 'limit');
    assert.equal((await response.text()).includes('sensitive'), false);
  }
});

test('required selection audit blocks invocation and failed outcome audit never replays it', async () => {
  for (const failKind of ['delegated-selection', 'delegated-attempt']) {
    const { ports, state } = fixture();
    const response = await createChatHandler({
      ...ports,
      writeAudit: async (event) => {
        if (event.kind === failKind) throw new Error('sensitive audit detail');
        state.audit.push(event);
      },
    })(request());
    assert.equal(response.status, 503);
    assert.equal(
      ((await response.json()) as { error: { code: string } }).error.code,
      'audit_unavailable',
    );
    assert.equal(state.upstreamCalls, failKind === 'delegated-selection' ? 0 : 1);
    assert.equal(JSON.stringify(state.audit).includes('sensitive'), false);
  }
});

test('safe upstream failure is attributed and never replays a possibly billed call', async () => {
  for (const [category, status] of [
    ['rate-limit', 502],
    ['credential', 503],
    ['configuration', 503],
  ] as const) {
    const { ports, state } = fixture();
    const response = await createChatHandler({
      ...ports,
      invokeOpenRouter: async () => {
        state.upstreamCalls++;
        throw new OpenRouterChatFailure(
          category,
          category !== 'credential',
          category !== 'credential',
        );
      },
    })(request());
    assert.equal(response.status, status);
    assert.equal(state.upstreamCalls, 1);
    assert.equal((state.audit[1] as { kind: string }).kind, 'delegated-attempt');
    assert.equal((state.audit[1] as { failureCategory: string }).failureCategory, category);
    assert.equal(
      (state.audit[1] as { possiblyBilled: boolean }).possiblyBilled,
      category !== 'credential',
    );
  }
});
