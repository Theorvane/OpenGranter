import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type AuthenticatedPrincipal, createChatHandler } from '../src/gateway/chat-handler.ts';

function valid() {
  return {
    id: 'principal',
    active: true,
    credentialId: 'credential',
    statements: [{ effect: 'Allow', actions: ['*'], resources: ['*'] }],
    policyVersions: [{ id: 'policy', version: 'v1' }],
  };
}
function request(path: string) {
  return new Request(`http://localhost${path}`, {
    method: path === '/v1/chat/completions' ? 'POST' : 'GET',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    ...(path === '/v1/chat/completions'
      ? {
          body: JSON.stringify({ model: 'chat', messages: [{ role: 'user', content: 'fixture' }] }),
        }
      : {}),
  });
}
function setup(result: unknown, auditFails = false) {
  const audit: unknown[] = [];
  const activity: string[] = [];
  const handler = createChatHandler({
    newRequestId: () => 'request',
    authenticate: async () => result as AuthenticatedPrincipal | undefined,
    resolveRoute: async () => {
      activity.push('route');
      return {
        version: 'v1',
        candidates: [
          { id: 'direct', kind: 'managed', providerId: 'provider', upstreamModelId: 'model' },
        ],
      };
    },
    listPublishedModels: async () => {
      activity.push('catalog');
      return [];
    },
    listUsage: async () => {
      activity.push('usage');
      return { records: [], hasMore: false };
    },
    listAudit: async () => {
      activity.push('history');
      return { events: [], nextCursor: null };
    },
    checkLimit: async () => {
      activity.push('limit');
      return true;
    },
    resolveSecret: async () => {
      activity.push('secret');
      return 'fixture';
    },
    writeAudit: async (event) => {
      if (auditFails) throw new Error('private audit fixture');
      audit.push(event);
    },
    writeUsage: async () => {
      activity.push('ledger');
    },
    invokeDirect: async () => {
      activity.push('provider');
      return { id: 'completion' };
    },
  });
  return { handler, audit, activity };
}

const malformed: readonly [string, () => unknown][] = [
  [
    'unknown effect',
    () => ({ ...valid(), statements: [{ effect: 'Unknown', actions: ['*'], resources: ['*'] }] }),
  ],
  ['missing effect', () => ({ ...valid(), statements: [{ actions: ['*'], resources: ['*'] }] })],
  [
    'string actions',
    () => ({ ...valid(), statements: [{ effect: 'Allow', actions: '*', resources: ['*'] }] }),
  ],
  [
    'string resources',
    () => ({ ...valid(), statements: [{ effect: 'Allow', actions: ['*'], resources: '*' }] }),
  ],
  ['string active', () => ({ ...valid(), active: 'true' })],
  ['number active', () => ({ ...valid(), active: 1 })],
  ['sparse statements', () => ({ ...valid(), statements: new Array(1) })],
  ['sparse versions', () => ({ ...valid(), policyVersions: new Array(1) })],
  [
    'sparse actions',
    () => ({
      ...valid(),
      statements: [{ effect: 'Allow', actions: new Array(1), resources: ['*'] }],
    }),
  ],
  ['invalid version', () => ({ ...valid(), policyVersions: [{ id: 'policy', version: '' }] })],
  ['invalid identity', () => ({ ...valid(), id: '' })],
  [
    'invalid resource entry',
    () => ({ ...valid(), statements: [{ effect: 'Allow', actions: ['*'], resources: [1] }] }),
  ],
];
for (const [name, build] of malformed) {
  test(`reject malformed authentication: ${name}`, async () => {
    const f = setup(build());
    const response = await f.handler(request('/v1/chat/completions'));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: { code: 'authentication_unavailable' },
      request_id: 'request',
    });
    assert.deepEqual(f.activity, []);
    assert.deepEqual(f.audit, [{ kind: 'auth-unavailable', requestId: 'request' }]);
  });
}
for (const path of ['/v1/models', '/v1/usage', '/v1/audit']) {
  test(`invalid policies stop ${path} before reads`, async () => {
    const f = setup({
      ...valid(),
      statements: [{ effect: 'Unknown', actions: ['*'], resources: ['*'] }],
    });
    const response = await f.handler(request(path));
    assert.equal(response.status, 503);
    assert.deepEqual(f.activity, []);
  });
}

test('valid wildcard Allow, empty/default Deny and explicit Deny remain intact', async () => {
  for (const [statements, expected] of [
    [valid().statements, 200],
    [[], 403],
    [[{ effect: 'Allow', actions: [], resources: ['*'] }], 403],
    [[...valid().statements, { effect: 'Deny', actions: ['*'], resources: ['*'] }], 403],
  ] as const) {
    const f = setup({ ...valid(), statements });
    const response = await f.handler(request('/v1/chat/completions'));
    assert.equal(response.status, expected);
    assert.equal(f.activity.includes('provider'), expected === 200);
  }
});

test('missing and boolean-inactive authentication retain anonymous denial', async () => {
  for (const result of [undefined, { ...valid(), active: false }]) {
    const f = setup(result);
    assert.equal((await f.handler(request('/v1/models'))).status, 401);
    assert.deepEqual(f.activity, []);
    assert.deepEqual(f.audit, [{ kind: 'auth-denied', requestId: 'request' }]);
  }
});

test('malformed authentication with failed required audit returns safe audit error', async () => {
  const f = setup({ ...valid(), active: 'true' }, true);
  const response = await f.handler(request('/v1/chat/completions'));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: { code: 'audit_unavailable' },
    request_id: 'request',
  });
  assert.deepEqual(f.activity, []);
});
