import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type ChatHandlerPorts, createChatHandler } from '../src/gateway/chat-handler.ts';
import type { Statement } from '../src/policy/evaluate.ts';

function principal(statements: Statement[]) {
  return {
    id: 'original-user',
    active: true,
    credentialId: 'original-credential',
    policyVersions: [{ id: 'policy', version: 'original' }],
    statements,
  };
}
const grant = (): Statement => ({ effect: 'Allow', actions: ['*'], resources: ['*'] });
const candidate = {
  id: 'candidate',
  kind: 'managed' as const,
  providerId: 'openai',
  upstreamModelId: 'text',
};
function request(path = '/v1/chat/completions') {
  return new Request(`http://localhost${path}`, {
    method: path === '/v1/models' ? 'GET' : 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    ...(path === '/v1/models'
      ? {}
      : {
          body: JSON.stringify({ model: 'chat', messages: [{ role: 'user', content: 'fixture' }] }),
        }),
  });
}
function fixture(source: ReturnType<typeof principal>) {
  const audits: unknown[] = [];
  const limits: string[] = [];
  let calls = 0;
  const ports: { -readonly [K in keyof ChatHandlerPorts<unknown>]: ChatHandlerPorts<unknown>[K] } =
    {
      newRequestId: () => 'request',
      authenticate: async () => source,
      resolveRoute: async () => ({ version: 'v1', candidates: [candidate] }),
      checkLimit: async (id) => {
        limits.push(id);
        return true;
      },
      resolveSecret: async () => 'fixture',
      writeAudit: async (event) => {
        audits.push(event);
      },
      writeUsage: async () => {},
      invokeDirect: async () => {
        calls++;
        return { id: 'completion' };
      },
      invokeOpenRouter: async () => {
        calls++;
        return { id: 'completion' };
      },
      resolveVerifiedProviderSlug: async () => 'openai',
    };
  return { ports, audits, limits, calls: () => calls };
}

for (const kind of ['managed', 'delegated'] as const) {
  for (const denial of ['default', 'explicit'] as const) {
    test(`${kind} retains ${denial} Deny when route lookup changes authenticator policies`, async () => {
      const source = principal(
        denial === 'default'
          ? []
          : [grant(), { effect: 'Deny', actions: ['llm:InvokeModel'], resources: ['model:chat'] }],
      );
      const f = fixture(source);
      f.ports.resolveRoute = async () => {
        source.statements.splice(0, source.statements.length, grant());
        return {
          kind,
          version: 'v1',
          credentialRef: 'secret/reference',
          candidates: [{ ...candidate, kind }],
        };
      };
      const response = await createChatHandler(f.ports)(request());
      assert.equal(response.status, 403);
      assert.equal(f.calls(), 0);
      assert.deepEqual(f.limits, []);
      assert.equal(source.statements[0]?.effect, 'Allow');
    });
  }
}

test('catalog resolution cannot widen model-list permissions', async () => {
  const source = principal([]);
  const f = fixture(source);
  f.ports.listPublishedModels = async () => {
    source.statements.push(grant());
    return [
      {
        alias: 'chat',
        created: 1,
        enabled: true,
        routes: [{ kind: 'managed', candidates: [candidate] }],
      },
    ];
  };
  const response = await createChatHandler(f.ports)(request('/v1/models'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { object: 'list', data: [] });
  assert.equal(f.calls(), 0);
});

test('captured identity and nested grants survive lookup; later requests capture new state', async () => {
  const source = principal([grant()]);
  const f = fixture(source);
  f.ports.resolveRoute = async () => {
    source.id = 'changed-user';
    source.credentialId = 'changed-credential';
    source.policyVersions[0]!.version = 'changed';
    source.active = false;
    source.statements[0] = { effect: 'Deny', actions: ['*'], resources: ['*'] };
    return { version: 'v1', candidates: [candidate] };
  };
  const handler = createChatHandler(f.ports);
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(f.limits, ['original-user']);
  assert.equal(f.calls(), 1);
  for (const raw of f.audits) {
    const event = raw as Record<string, unknown>;
    assert.equal(event.principalId, 'original-user');
    assert.equal(event.credentialId, 'original-credential');
    assert.deepEqual(event.policyVersions, [{ id: 'policy', version: 'original' }]);
  }
  assert.equal((await handler(request())).status, 401);
});

test('snapshot construction failure is safely audited without downstream work', async () => {
  const source = principal([grant()]);
  Object.defineProperty(source, 'statements', {
    get() {
      throw new Error('private fixture failure');
    },
  });
  const f = fixture(source);
  const response = await createChatHandler(f.ports)(request());
  assert.equal(response.status, 503);
  assert.match(await response.text(), /authentication_unavailable/u);
  assert.deepEqual(f.audits, [{ kind: 'auth-unavailable', requestId: 'request' }]);
  assert.equal(f.calls(), 0);
});

test('required authentication-failure audit blocks when unavailable', async () => {
  const source = principal([grant()]);
  Object.defineProperty(source, 'statements', {
    get() {
      throw new Error('private fixture failure');
    },
  });
  const f = fixture(source);
  f.ports.writeAudit = async () => {
    throw new Error('private audit failure');
  };
  const response = await createChatHandler(f.ports)(request());
  assert.equal(response.status, 503);
  assert.match(await response.text(), /audit_unavailable/u);
  assert.equal(f.calls(), 0);
});
