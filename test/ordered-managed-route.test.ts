import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatHandler, type ManagedChatRoute } from '../src/gateway/chat-handler.ts';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';

const candidates = [
  { id: 'openai', kind: 'managed' as const, upstreamModelId: 'gpt', providerId: 'openai' },
  { id: 'anthropic', kind: 'managed' as const, upstreamModelId: 'claude', providerId: 'anthropic' },
];

function fixture(
  options: {
    statements?: readonly { effect: 'Allow' | 'Deny'; actions: string[]; resources: string[] }[];
    checkLimit?: () => Promise<boolean>;
    writeAudit?: (event: unknown) => Promise<void>;
    invokeDirect?: (candidateId: string) => Promise<unknown>;
    route?: ManagedChatRoute;
  } = {},
) {
  const state = { calls: [] as string[], audit: [] as unknown[], usage: [] as unknown[] };
  const handler = createChatHandler({
    newRequestId: () => 'ordered-1',
    authenticate: async () => ({
      id: 'service-1',
      active: true,
      credentialId: 'credential-1',
      policyVersions: [{ id: 'policy-1', version: 'v1' }],
      statements: options.statements ?? [
        { effect: 'Allow', actions: ['llm:InvokeModel'], resources: ['model:chat'] },
        {
          effect: 'Allow',
          actions: ['llm:UseProvider'],
          resources: ['provider:openai', 'provider:anthropic'],
        },
      ],
    }),
    resolveRoute: async () => options.route ?? { kind: 'managed', version: 'v1', candidates },
    checkLimit: async () => {
      state.calls.push('limit');
      return options.checkLimit?.() ?? true;
    },
    resolveSecret: async () => {
      state.calls.push('secret');
      throw new Error('Jev secret must not be read');
    },
    writeAudit: async (event) => {
      state.calls.push(`audit:${event.kind}`);
      state.audit.push(event);
      await options.writeAudit?.(event);
    },
    writeUsage: async (record) => {
      state.usage.push(record);
    },
    invokeDirect: async (candidate) => {
      state.calls.push(`direct:${candidate.id}`);
      return (
        (await options.invokeDirect?.(candidate.id)) ?? {
          id: 'response-1',
          usage: { total_tokens: 5 },
        }
      );
    },
    fetchJev: async () => {
      state.calls.push('jev');
      throw new Error('Jev must not be called');
    },
  });
  const request = new Request('http://localhost/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: 'Bearer proxy-token', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'chat',
      messages: [{ role: 'user', content: 'private prompt' }],
    }),
  });
  return { handler, request, state };
}

test('ordered managed route invokes the first IAM-eligible provider without Jev', async () => {
  const { handler, request, state } = fixture();
  const response = await handler(request);
  assert.equal(response.status, 200);
  assert.deepEqual(state.calls, [
    'limit',
    'audit:selection-started',
    'audit:decision',
    'direct:openai',
    'audit:attempt',
  ]);
  const decision = state.audit.find((event) => (event as { kind: string }).kind === 'decision') as {
    candidateId: string;
    decision: { source: string };
  };
  assert.equal(decision.candidateId, 'openai');
  assert.deepEqual(decision.decision, { source: 'order' });
  assert.equal(JSON.stringify(state.audit).includes('private prompt'), false);
  assert.equal(state.usage.length, 1);
});

test('ordered route filters denied providers before choosing by administrator order', async () => {
  const { handler, request, state } = fixture({
    statements: [
      { effect: 'Allow', actions: ['llm:InvokeModel'], resources: ['model:chat'] },
      { effect: 'Allow', actions: ['llm:UseProvider'], resources: ['provider:*'] },
      { effect: 'Deny', actions: ['llm:UseProvider'], resources: ['provider:openai'] },
    ],
  });
  assert.equal((await handler(request)).status, 200);
  assert.deepEqual(
    state.calls.filter((call) => call.startsWith('direct:')),
    ['direct:anthropic'],
  );
  const denied = fixture({ statements: [] });
  assert.equal((await denied.handler(denied.request)).status, 403);
  assert.equal(denied.state.calls.includes('limit'), false);
  assert.equal(
    denied.state.calls.some((call) => call.startsWith('direct:')),
    false,
  );
});

test('limit and required audit failures stop ordered inference', async () => {
  const limited = fixture({ checkLimit: async () => false });
  assert.equal((await limited.handler(limited.request)).status, 429);
  assert.equal(
    limited.state.calls.some((call) => call.startsWith('direct:')),
    false,
  );
  const auditFailed = fixture({
    writeAudit: async (event) => {
      if ((event as { kind: string }).kind === 'decision') throw new Error('private audit error');
    },
  });
  assert.equal((await auditFailed.handler(auditFailed.request)).status, 503);
  assert.equal(
    auditFailed.state.calls.some((call) => call.startsWith('direct:')),
    false,
  );
});

test('classified pre-response failure falls back only to the next authorized managed provider', async () => {
  const { handler, request, state } = fixture({
    invokeDirect: async (candidateId) => {
      if (candidateId === 'openai') throw new DirectProviderFailure('timeout', false, true);
      return { id: 'second-response', usage: { total_tokens: 3 } };
    },
  });
  assert.equal((await handler(request)).status, 200);
  assert.deepEqual(
    state.calls.filter((call) => call.startsWith('direct:')),
    ['direct:openai', 'direct:anthropic'],
  );
  assert.equal(state.usage.length, 2);
  assert.equal(JSON.stringify(state.calls).includes('jev'), false);
  assert.equal(JSON.stringify(state.calls).includes('secret'), false);
});

test('ordered audit metadata strips content and rejects invented decision fields', async () => {
  const { projectGatewayAuditEvent } = await import('../src/audit/postgres-gateway-audit.ts');
  const projected = projectGatewayAuditEvent(
    {
      kind: 'decision',
      principalId: 'service-1',
      credentialId: 'credential-1',
      policyVersions: [],
      requestId: 'ordered-1',
      routeVersion: 'v1',
      modelAlias: 'chat',
      candidateId: 'openai',
      decision: { source: 'order', prompt: 'private prompt', apiKey: 'private key' },
    },
    1000,
  );
  assert.deepEqual(projected.details.decision, { source: 'order' });
  assert.equal(JSON.stringify(projected).includes('private'), false);
});

test('malformed Jev settings do not downgrade into ordered routing', async () => {
  const malformed = fixture({
    route: { kind: 'managed', version: 'v1', candidates, jev: null } as unknown as ManagedChatRoute,
  });
  assert.equal((await malformed.handler(malformed.request)).status, 503);
  assert.equal(
    malformed.state.calls.some((call) => call.startsWith('direct:')),
    false,
  );
});
