import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAttachmentAuthenticator } from '../src/gateway/attachment-authenticator.ts';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import type {
  PrincipalSnapshot,
  RoleSnapshot,
  VersionedPolicy,
} from '../src/policy/evaluate-attachments.ts';

const principal: PrincipalSnapshot = {
  id: 'service-1',
  kind: 'service',
  active: true,
  directPolicyIds: [],
  roleIds: ['developer'],
};
const roles: RoleSnapshot[] = [{ id: 'developer', policyIds: ['model-allow', 'provider-allow'] }];
const policies: VersionedPolicy[] = [
  {
    id: 'model-allow',
    version: 'v1',
    statements: [{ effect: 'Allow', actions: ['llm:InvokeModel'], resources: ['model:chat'] }],
  },
  {
    id: 'provider-allow',
    version: 'v2',
    statements: [{ effect: 'Allow', actions: ['llm:UseProvider'], resources: ['provider:openai'] }],
  },
];
const route = {
  version: 'v1',
  candidates: [
    { id: 'openai', kind: 'managed' as const, upstreamModelId: 'gpt', providerId: 'openai' },
  ],
  jev: { credentialRef: 'secret/jev', minimumConfidence: 0.6, sendPrompt: false },
};
const request = () =>
  new Request('http://localhost/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: 'Bearer sensitive-proxy-token', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'chat', messages: [{ role: 'user', content: 'Hello' }] }),
  });

type Snapshot = {
  principal: PrincipalSnapshot;
  roles: readonly RoleSnapshot[];
  policies: readonly VersionedPolicy[];
};
function harness(
  options: {
    credentialActive?: boolean;
    snapshot?: Snapshot | undefined;
    loaderFails?: boolean;
    verifierFails?: boolean;
  } = {},
) {
  const called: string[] = [];
  const audit: unknown[] = [];
  const authenticate = createAttachmentAuthenticator({
    verifyCredential: async (token) => {
      called.push('credential');
      assert.equal(token, 'sensitive-proxy-token');
      if (options.verifierFails) throw new Error('sensitive credential-store detail');
      return {
        credentialId: 'credential-1',
        principalId: 'service-1',
        active: options.credentialActive ?? true,
      };
    },
    loadSnapshot: async (id) => {
      called.push('snapshot');
      assert.equal(id, 'service-1');
      if (options.loaderFails) throw new Error('sensitive database detail');
      return 'snapshot' in options ? options.snapshot : { principal, roles, policies };
    },
  });
  const handler = createChatHandler({
    newRequestId: () => 'req-1',
    authenticate,
    resolveRoute: async () => {
      called.push('route');
      return route;
    },
    checkLimit: async () => {
      called.push('limit');
      return true;
    },
    resolveSecret: async () => 'jev-key',
    writeUsage: async () => {},
    writeAudit: async (event) => {
      audit.push(event);
    },
    invokeDirect: async () => {
      called.push('provider');
      return { id: 'completion-1' };
    },
    fetchJev: async () => ({
      ok: true,
      json: async () => ({
        model: 'jev-1',
        answers: { route: { type: 'choice', choice: 'openai', confidence: 0.9 } },
      }),
    }),
  });
  return { handler, authenticate, called, audit };
}

test('role permissions allow a gateway call and expose only safe attachment metadata', async () => {
  const { handler, authenticate, called, audit } = harness();
  const identity = await authenticate('sensitive-proxy-token');
  assert.equal(identity?.credentialId, 'credential-1');
  assert.deepEqual(identity?.policyVersions, [
    { id: 'model-allow', version: 'v1' },
    { id: 'provider-allow', version: 'v2' },
  ]);
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(called.includes('provider'), true);
  assert.equal(JSON.stringify(audit).includes('sensitive-proxy-token'), false);
  assert.equal(JSON.stringify(audit).includes('statements'), false);
});

test('a human principal can invoke through directly attached policies', async () => {
  const { handler, called } = harness({
    snapshot: {
      principal: {
        ...principal,
        kind: 'human',
        directPolicyIds: ['model-allow', 'provider-allow'],
        roleIds: [],
      },
      roles: [],
      policies,
    },
  });
  assert.equal((await handler(request())).status, 200);
  assert.equal(called.includes('provider'), true);
});

test('direct Deny overrides an inherited role Allow before provider invocation', async () => {
  const deniedPolicy: VersionedPolicy = {
    id: 'direct-deny',
    version: 'v3',
    statements: [{ effect: 'Deny', actions: ['llm:UseProvider'], resources: ['provider:openai'] }],
  };
  const { handler, called } = harness({
    snapshot: {
      principal: { ...principal, directPolicyIds: ['direct-deny'] },
      roles,
      policies: [...policies, deniedPolicy],
    },
  });
  const response = await handler(request());
  assert.equal(response.status, 403);
  assert.equal(called.includes('provider'), false);
});

test('revoked credential and inactive principal fail before route lookup', async () => {
  for (const options of [
    { credentialActive: false },
    { snapshot: { principal: { ...principal, active: false }, roles, policies } },
  ]) {
    const { handler, called } = harness(options);
    const response = await handler(request());
    assert.equal(response.status, 401);
    assert.equal(called.includes('route'), false);
    assert.equal(called.includes('provider'), false);
  }
});

test('missing or ambiguous attachment denies without partial Allow', async () => {
  for (const snapshot of [
    { principal, roles: [], policies },
    { principal, roles: [...roles, ...roles], policies },
    { principal, roles, policies: policies.slice(0, 1) },
    { principal, roles, policies: [...policies, ...policies] },
  ]) {
    const { handler, called } = harness({ snapshot });
    const response = await handler(request());
    assert.equal(response.status, 401);
    assert.equal(called.includes('route'), false);
  }
});

test('mismatched or unavailable snapshot fails closed without disclosing internals', async () => {
  for (const options of [
    { snapshot: { principal: { ...principal, id: 'other' }, roles, policies } },
    { loaderFails: true },
    { verifierFails: true },
    { snapshot: undefined },
  ]) {
    const { handler, called, audit } = harness(options);
    const response = await handler(request());
    assert.equal(response.status, 503);
    assert.equal(called.includes('route'), false);
    assert.equal((await response.text()).includes('sensitive'), false);
    assert.equal(JSON.stringify(audit).includes('sensitive'), false);
  }
});
