import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresProxyCredentialStore } from '../src/gateway/postgres-proxy-credentials.ts';
import { createPostgresTokenManagementService } from '../src/gateway/postgres-token-management-service.ts';
import { createProxyTokenService } from '../src/gateway/proxy-tokens.ts';
import {
  createTokenManagementCoordinator,
  type TokenManagementActor,
  type TokenManagementAuditEvent,
} from '../src/gateway/token-management.ts';

function actor() {
  return {
    id: 'admin',
    active: true,
    statements: [
      { effect: 'Allow' as const, actions: ['iam:Manage'], resources: ['principal:service-1'] },
    ],
    policyVersions: [{ id: 'manage', version: 'v1' }],
    extra: 'private-extra',
  };
}

function ports() {
  const issued: unknown[] = [],
    revoked: unknown[] = [],
    audit: TokenManagementAuditEvent[] = [];
  return {
    issued,
    revoked,
    audit,
    findOwner: async (_id: string) => 'service-1',
    issueToken: async (input: unknown) => {
      issued.push(input);
      return { credentialId: 'new', token: 'fixture-token' };
    },
    revokeToken: async (input: unknown) => {
      revoked.push(input);
      return true;
    },
    writeAudit: async (event: TokenManagementAuditEvent) => {
      audit.push(event);
    },
  };
}

test('issue retains its evaluated target, expiry, identity and versions during audit', async () => {
  const source = actor();
  const input = {
    actor: source,
    requestId: 'original',
    principalId: 'service-1',
    expiresAt: 10_000,
  };
  const p = ports();
  const coordinator = createTokenManagementCoordinator({
    ...p,
    writeAudit: async (event) => {
      p.audit.push(event);
      input.requestId = 'changed';
      input.principalId = 'service-2';
      input.expiresAt = 20_000;
      source.id = 'other';
      source.active = false;
      source.policyVersions[0]!.version = 'v2';
    },
  });
  await coordinator.issue(input);
  assert.deepEqual(p.issued, [
    { principalId: 'service-1', actorId: 'admin', requestId: 'original', expiresAt: 10_000 },
  ]);
  assert.equal(p.audit[0]?.actorId, 'admin');
  assert.equal(p.audit[0]?.requestId, 'original');
  assert.deepEqual(p.audit[0]?.policyVersions, [{ id: 'manage', version: 'v1' }]);
  assert.equal(source.id, 'other');
});

test('revoke retains original credential and actor context across owner lookup', async () => {
  const source = actor();
  const input = { actor: source, requestId: 'original', credentialId: 'credential-1' };
  const p = ports();
  const lookedUp: string[] = [];
  const coordinator = createTokenManagementCoordinator({
    ...p,
    findOwner: async (id) => {
      lookedUp.push(id);
      input.credentialId = 'credential-2';
      input.requestId = 'changed';
      source.id = 'other';
      source.active = false;
      source.statements[0]!.resources[0] = 'principal:service-2';
      return 'service-1';
    },
  });
  assert.equal(await coordinator.revoke(input), true);
  assert.deepEqual(lookedUp, ['credential-1']);
  assert.deepEqual(p.revoked, [
    { credentialId: 'credential-1', actorId: 'admin', requestId: 'original' },
  ]);
  assert.equal(p.audit[0]?.credentialId, 'credential-1');
});

for (const initial of ['default', 'explicit'] as const) {
  test(`${initial} Deny cannot be replaced during owner lookup`, async () => {
    const source: TokenManagementActor & {
      statements: { effect: 'Allow' | 'Deny'; actions: string[]; resources: string[] }[];
    } = {
      ...actor(),
      statements:
        initial === 'default'
          ? []
          : [{ effect: 'Deny', actions: ['iam:Manage'], resources: ['*'] }],
    };
    const p = ports();
    const coordinator = createTokenManagementCoordinator({
      ...p,
      findOwner: async () => {
        source.statements.splice(0, source.statements.length, {
          effect: 'Allow',
          actions: ['iam:Manage'],
          resources: ['*'],
        });
        return 'service-1';
      },
    });
    await assert.rejects(
      coordinator.revoke({ actor: source, requestId: 'original', credentialId: 'credential-1' }),
      { name: 'TokenManagementDenied' },
    );
    assert.deepEqual(p.revoked, []);
    assert.equal(p.audit[0]?.kind, 'token-management-denied');
  });
}

test('decision events and nested policy versions are immutable projections', async () => {
  const source = actor();
  const p = ports();
  const coordinator = createTokenManagementCoordinator({
    ...p,
    writeAudit: async (event) => {
      assert.equal(Object.isFrozen(event), true);
      assert.equal(Object.isFrozen(event.policyVersions), true);
      assert.equal(Object.isFrozen(event.policyVersions[0]), true);
      assert.equal(JSON.stringify(event).includes('private-extra'), false);
      assert.throws(() => {
        (event.policyVersions[0] as { version: string }).version = 'changed';
      }, TypeError);
    },
  });
  await coordinator.issue({
    actor: source,
    requestId: 'original',
    principalId: 'service-1',
    expiresAt: 10_000,
  });
  assert.equal(p.issued.length, 1);
});

test('audit failure after source mutation still prevents credential writes', async () => {
  const source = actor();
  const p = ports();
  const coordinator = createTokenManagementCoordinator({
    ...p,
    writeAudit: async () => {
      source.id = 'other';
      throw new Error('private-audit-error');
    },
  });
  await assert.rejects(
    coordinator.issue({
      actor: source,
      requestId: 'original',
      principalId: 'service-1',
      expiresAt: 10_000,
    }),
    { name: 'TokenManagementUnavailable', message: 'Token management unavailable' },
  );
  assert.deepEqual(p.issued, []);
});

async function fixture() {
  const db = new PGlite();
  for (const name of [
    '002_proxy_credentials.sql',
    '004_iam_snapshots.sql',
    '008_token_management_decisions.sql',
  ])
    await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  await db.exec(`INSERT INTO iam_principals VALUES ('admin', 'human', true), ('service-1', 'service', true), ('service-2', 'service', true);
    INSERT INTO iam_policies VALUES ('manage', 'v1', '[{"effect":"Allow","actions":["iam:Manage"],"resources":["principal:service-1"]}]');
    INSERT INTO iam_principal_policies VALUES ('admin', 'manage');`);
  const client = { query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]) };
  const tokens = createProxyTokenService({
    store: createPostgresProxyCredentialStore(client),
    now: () => 1_000,
  });
  return { db, client, tokens };
}

for (const operation of ['issue', 'revoke'] as const) {
  test(`service captures ${operation} fields before asynchronous actor lookup`, async () => {
    const f = await fixture();
    try {
      const first = await f.tokens.issue({
        actorId: 'admin',
        requestId: 'seed-1',
        principalId: 'service-1',
        expiresAt: 10_000,
      });
      const second = await f.tokens.issue({
        actorId: 'admin',
        requestId: 'seed-2',
        principalId: 'service-2',
        expiresAt: 10_000,
      });
      const input = {
        authenticatedActorId: 'admin',
        requestId: 'original',
        principalId: 'service-1',
        expiresAt: 10_000,
        credentialId: first.credentialId,
      };
      let updated = false;
      const service = createPostgresTokenManagementService({
        now: () => 1_000,
        client: {
          query: async (sql, params) => {
            const result = await f.client.query(sql, params);
            if (!updated) {
              updated = true;
              input.requestId = 'changed';
              input.authenticatedActorId = 'other';
              input.principalId = 'service-2';
              input.credentialId = second.credentialId;
              input.expiresAt = 20_000;
            }
            return result;
          },
        },
      });
      if (operation === 'issue') {
        const issued = await service.issue(input);
        assert.equal((await f.tokens.verifyCredential(issued.token))?.principalId, 'service-1');
        assert.deepEqual(
          (
            await f.db.query(
              'SELECT principal_id, request_id FROM proxy_credential_events WHERE credential_id = $1',
              [issued.credentialId],
            )
          ).rows,
          [{ principal_id: 'service-1', request_id: 'original' }],
        );
      } else {
        assert.equal(await service.revoke(input), true);
        assert.equal(await f.tokens.verifyCredential(first.token), undefined);
        assert.ok(await f.tokens.verifyCredential(second.token));
      }
      assert.deepEqual(
        (
          await f.db.query(
            'SELECT actor_id, request_id, target_principal_id FROM token_management_decisions',
          )
        ).rows,
        [{ actor_id: 'admin', request_id: 'original', target_principal_id: 'service-1' }],
      );
    } finally {
      await f.db.close();
    }
  });
}
