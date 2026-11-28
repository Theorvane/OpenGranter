import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createSsoManagementServer } from '../src/gateway/sso-management-http.ts';
import {
  createTokenManagementCoordinator,
  InvalidTokenManagementInput,
  type TokenManagementActor,
} from '../src/gateway/token-management.ts';

function actor(): TokenManagementActor {
  return {
    id: 'admin',
    active: true,
    statements: [{ effect: 'Allow', actions: ['iam:Manage'], resources: ['principal:target'] }],
    policyVersions: [{ id: 'manage', version: 'v1' }],
  };
}
function fixture() {
  const calls: string[] = [];
  const coordinator = createTokenManagementCoordinator({
    findOwner: async () => {
      calls.push('owner');
      return 'target';
    },
    writeAudit: async () => {
      calls.push('audit');
    },
    issueToken: async () => {
      calls.push('issue');
      return { credentialId: 'credential', token: 'synthetic-test-token' };
    },
    revokeToken: async () => {
      calls.push('revoke');
      return true;
    },
  });
  return { coordinator, calls };
}
function incomplete<T>(sample: T, hole: number, inherited = false): T[] {
  const result = [sample, sample, sample];
  delete result[hole];
  if (inherited) {
    const prototype = Object.create(Array.prototype);
    Object.defineProperty(prototype, String(hole), { value: sample, configurable: true });
    Object.setPrototypeOf(result, prototype);
  }
  return result;
}
for (const operation of ['issue', 'revoke'] as const) {
  for (const field of ['statements', 'actions', 'resources', 'policyVersions'] as const) {
    for (const [label, hole, inherited] of [
      ['leading', 0, false],
      ['interior', 1, false],
      ['trailing', 2, false],
      ['inherited', 1, true],
    ] as const) {
      test(`${operation} rejects ${label} missing ${field} before every port`, async () => {
        const original = actor();
        const first = original.statements[0];
        const policy = original.policyVersions[0];
        assert.ok(first);
        assert.ok(policy);
        const malformed =
          field === 'statements'
            ? { ...original, statements: incomplete(first, hole, inherited) }
            : field === 'policyVersions'
              ? {
                  ...original,
                  policyVersions: incomplete(policy, hole, inherited),
                }
              : {
                  ...original,
                  statements: [
                    {
                      ...first,
                      [field]: incomplete(
                        field === 'actions' ? 'iam:Manage' : 'principal:target',
                        hole,
                        inherited,
                      ),
                    },
                  ],
                };
        const f = fixture();
        await assert.rejects(
          operation === 'issue'
            ? f.coordinator.issue({
                actor: malformed,
                requestId: 'request',
                principalId: 'target',
                expiresAt: 10000,
              })
            : f.coordinator.revoke({
                actor: malformed,
                requestId: 'request',
                credentialId: 'credential',
              }),
          (error: unknown) =>
            error instanceof InvalidTokenManagementInput &&
            error.message === 'Invalid token management input',
        );
        assert.deepEqual(f.calls, []);
      });
    }
  }
  test(`${operation} dense context preserves required audit before mutation`, async () => {
    const f = fixture();
    if (operation === 'issue') {
      await f.coordinator.issue({
        actor: actor(),
        requestId: 'request',
        principalId: 'target',
        expiresAt: 10000,
      });
      assert.deepEqual(f.calls, ['audit', 'issue']);
    } else {
      await f.coordinator.revoke({
        actor: actor(),
        requestId: 'request',
        credentialId: 'credential',
      });
      assert.deepEqual(f.calls, ['owner', 'audit', 'revoke']);
    }
  });
}

for (const operation of ['issue', 'revoke'] as const) {
  for (const malformed of [true, false]) {
    test(`${operation} owned HTTP ${malformed ? 'rejects incomplete attribution' : 'preserves dense success'}`, async (t) => {
      const context = actor();
      const policy = context.policyVersions[0];
      assert.ok(policy);
      const current = malformed ? { ...context, policyVersions: incomplete(policy, 1) } : context;
      const f = fixture();
      const server = createSsoManagementServer({
        newRequestId: () => 'socket-request',
        authenticate: async (token) => {
          assert.equal(token, 'synthetic-sso');
          return current.id;
        },
        issue: (input) => {
          assert.equal(input.authenticatedActorId, current.id);
          return f.coordinator.issue({ ...input, actor: current });
        },
        revoke: (input) => {
          assert.equal(input.authenticatedActorId, current.id);
          return f.coordinator.revoke({ ...input, actor: current });
        },
        writeAudit: async () => {
          assert.fail('successful authentication is not a denial');
        },
      });
      t.after(
        () =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
            server.closeAllConnections();
          }),
      );
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const path = operation === 'issue' ? '' : '/revoke';
      const response = await fetch(
        `http://127.0.0.1:${address.port}/management/v1/proxy-tokens${path}`,
        {
          method: 'POST',
          headers: { authorization: 'Bearer synthetic-sso', 'content-type': 'application/json' },
          body: JSON.stringify(
            operation === 'issue'
              ? { principalId: 'target', expiresAt: 10000 }
              : { credentialId: 'credential' },
          ),
        },
      );
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-request-id'), 'socket-request');
      if (malformed) {
        assert.equal(response.status, 400);
        const body = await response.text();
        assert.match(body, /invalid_request/u);
        assert.equal(body.includes('manage'), false);
        assert.equal(body.includes('synthetic-test-token'), false);
        assert.deepEqual(f.calls, []);
      } else {
        assert.equal(response.status, operation === 'issue' ? 201 : 200);
        assert.deepEqual(
          await response.json(),
          operation === 'issue'
            ? { credentialId: 'credential', token: 'synthetic-test-token' }
            : { revoked: true },
        );
        assert.deepEqual(
          f.calls,
          operation === 'issue' ? ['audit', 'issue'] : ['owner', 'audit', 'revoke'],
        );
      }
    });
  }
}
