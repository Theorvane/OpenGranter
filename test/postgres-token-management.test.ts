import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresTokenManagementAuditStore } from '../src/audit/postgres-token-management.ts';
import { createPostgresProxyCredentialStore } from '../src/gateway/postgres-proxy-credentials.ts';
import { createPostgresTokenManagementCoordinator } from '../src/gateway/postgres-token-management.ts';
import { createProxyTokenService } from '../src/gateway/proxy-tokens.ts';
import type {
  TokenManagementActor,
  TokenManagementAuditEvent,
} from '../src/gateway/token-management.ts';

const actor: TokenManagementActor = {
  id: 'admin-1',
  active: true,
  statements: [{ effect: 'Allow', actions: ['iam:Manage'], resources: ['principal:service-1'] }],
  policyVersions: [{ id: 'manage', version: 'v1' }],
};
const issue = { actor, requestId: 'issue-1', principalId: 'service-1', expiresAt: 10_000 };
const event: TokenManagementAuditEvent = {
  kind: 'token-management-allowed',
  operation: 'issue',
  actorId: actor.id,
  requestId: 'issue-1',
  targetPrincipalId: 'service-1',
  policyVersions: actor.policyVersions,
};
const unavailable = { name: 'TokenManagementUnavailable', message: 'Token management unavailable' };

async function fixture() {
  const db = new PGlite();
  for (const name of ['002_proxy_credentials.sql', '008_token_management_decisions.sql']) {
    await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  const client = { query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]) };
  const now = () => 1_000;
  const coordinator = createPostgresTokenManagementCoordinator({ client, now });
  const tokens = createProxyTokenService({
    store: createPostgresProxyCredentialStore(client),
    now,
  });
  return { db, client, now, coordinator, tokens };
}

test('persisted IAM grants precede successful issue and owner-scoped revocation', async () => {
  const { db, coordinator, tokens } = await fixture();
  try {
    const issued = await coordinator.issue(issue);
    assert.equal((await tokens.verifyCredential(issued.token))?.principalId, 'service-1');
    await assert.rejects(
      coordinator.revoke({
        actor: { ...actor, statements: [] },
        requestId: 'deny-revoke',
        credentialId: issued.credentialId,
      }),
      { name: 'TokenManagementDenied' },
    );
    assert.ok(await tokens.verifyCredential(issued.token));
    assert.equal(
      await coordinator.revoke({ actor, requestId: 'revoke-1', credentialId: issued.credentialId }),
      true,
    );
    assert.equal(await tokens.verifyCredential(issued.token), undefined);
    const decisions = await db.query(
      'SELECT operation, outcome, actor_id, target_principal_id, credential_id, request_id, policy_versions, occurred_at_ms::text FROM token_management_decisions ORDER BY event_id',
    );
    assert.deepEqual(decisions.rows, [
      {
        operation: 'issue',
        outcome: 'allowed',
        actor_id: actor.id,
        target_principal_id: 'service-1',
        credential_id: null,
        request_id: 'issue-1',
        policy_versions: actor.policyVersions,
        occurred_at_ms: '1000',
      },
      {
        operation: 'revoke',
        outcome: 'denied',
        actor_id: actor.id,
        target_principal_id: 'service-1',
        credential_id: issued.credentialId,
        request_id: 'deny-revoke',
        policy_versions: actor.policyVersions,
        occurred_at_ms: '1000',
      },
      {
        operation: 'revoke',
        outcome: 'allowed',
        actor_id: actor.id,
        target_principal_id: 'service-1',
        credential_id: issued.credentialId,
        request_id: 'revoke-1',
        policy_versions: actor.policyVersions,
        occurred_at_ms: '1000',
      },
    ]);
    assert.deepEqual(
      (await db.query('SELECT action, request_id FROM proxy_credential_events ORDER BY event_id'))
        .rows,
      [
        { action: 'issued', request_id: 'issue-1' },
        { action: 'revoked', request_id: 'revoke-1' },
      ],
    );
    assert.equal(JSON.stringify(decisions.rows).includes(issued.token), false);
  } finally {
    await db.close();
  }
});

test('default/explicit deny, inactive actors and unknown owners persist denials without mutations', async () => {
  const { db, coordinator } = await fixture();
  try {
    for (const denied of [
      { ...actor, statements: [] },
      { ...actor, active: false },
      {
        ...actor,
        statements: [
          ...actor.statements,
          { effect: 'Deny' as const, actions: ['iam:Manage'], resources: ['*'] },
        ],
      },
    ]) {
      await assert.rejects(coordinator.issue({ ...issue, actor: denied }), {
        name: 'TokenManagementDenied',
      });
    }
    await assert.rejects(
      coordinator.revoke({ actor, requestId: 'unknown', credentialId: 'missing' }),
      { name: 'TokenManagementDenied' },
    );
    assert.deepEqual(
      (
        await db.query(
          'SELECT outcome, target_principal_id FROM token_management_decisions ORDER BY event_id',
        )
      ).rows,
      [
        ...Array.from({ length: 3 }, () => ({
          outcome: 'denied',
          target_principal_id: 'service-1',
        })),
        { outcome: 'denied', target_principal_id: null },
      ],
    );
    assert.equal((await db.query('SELECT * FROM proxy_credentials')).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM proxy_credential_events')).rows.length, 0);
  } finally {
    await db.close();
  }
});

test('decision write failure prevents issue and leaves an existing token active on failed revoke', async () => {
  const { db, coordinator, tokens } = await fixture();
  try {
    const issued = await coordinator.issue(issue);
    await db.exec('DROP TABLE token_management_decisions');
    await assert.rejects(coordinator.issue(issue), unavailable);
    await assert.rejects(
      coordinator.revoke({ actor, requestId: 'revoke', credentialId: issued.credentialId }),
      unavailable,
    );
    assert.ok(await tokens.verifyCredential(issued.token));
    assert.equal((await db.query('SELECT * FROM proxy_credentials')).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM proxy_credential_events')).rows.length, 1);
  } finally {
    await db.close();
  }
});

test('grant survives a failed mutation and does not claim successful completion', async () => {
  const { db, coordinator } = await fixture();
  try {
    await db.exec('DROP TABLE proxy_credential_events');
    await assert.rejects(coordinator.issue(issue), unavailable);
    assert.deepEqual((await db.query('SELECT outcome FROM token_management_decisions')).rows, [
      { outcome: 'allowed' },
    ]);
    assert.equal((await db.query('SELECT * FROM proxy_credentials')).rows.length, 0);
  } finally {
    await db.close();
  }
});

test('append projects only known fields and binds hostile-looking IDs as literal values', async () => {
  const { db, client, now } = await fixture();
  try {
    const extra = {
      ...event,
      actorId: "admin'; DROP TABLE proxy_credentials; --",
      token: 'secret-token',
      prompt: 'secret-content',
      policyVersions: [{ id: 'manage', version: 'v1', statements: ['secret-policy'] }],
    };
    await createPostgresTokenManagementAuditStore(client, now).append(extra);
    const rows = await db.query('SELECT * FROM token_management_decisions');
    const encoded = JSON.stringify(rows.rows);
    for (const secret of ['secret-token', 'secret-content', 'secret-policy', 'token_digest'])
      assert.equal(encoded.includes(secret), false);
    assert.ok(encoded.includes(extra.actorId));
    assert.equal((await db.query('SELECT * FROM proxy_credentials')).rows.length, 0);
  } finally {
    await db.close();
  }
});

test('invalid events and clocks reject before SQL', async () => {
  let calls = 0;
  const client = {
    query: async () => {
      calls++;
      return { rows: [{ event_id: '1' }] };
    },
  };
  for (const invalid of [
    null,
    [],
    { ...event, kind: 'unknown' },
    { ...event, operation: 'delete' },
    { ...event, actorId: '' },
    { ...event, requestId: 'a'.repeat(257) },
    { ...event, targetPrincipalId: null },
    { ...event, credentialId: 'unexpected' },
    { ...event, operation: 'revoke' },
    { ...event, policyVersions: [{ id: 'x', version: '' }] },
  ]) {
    await assert.rejects(
      createPostgresTokenManagementAuditStore(client, () => 1000).append(
        invalid as TokenManagementAuditEvent,
      ),
      { name: 'InvalidTokenManagementAuditEvent' },
    );
  }
  for (const clock of [NaN, -1, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      createPostgresTokenManagementAuditStore(client, () => clock).append(event),
      { name: 'InvalidTokenManagementAuditEvent' },
    );
  }
  assert.equal(calls, 0);
});

test('SQL, clock, and acknowledgement failures expose only fixed availability errors', async () => {
  const safe = {
    name: 'TokenManagementAuditUnavailable',
    message: 'Token management audit store unavailable',
  };
  for (const rows of [[], [null], [{ event_id: '0' }], [{ event_id: '1' }, { event_id: '2' }]]) {
    await assert.rejects(
      createPostgresTokenManagementAuditStore({ query: async () => ({ rows }) }, () => 1000).append(
        event,
      ),
      safe,
    );
  }
  await assert.rejects(
    createPostgresTokenManagementAuditStore(
      {
        query: async () => {
          throw new Error('private-sql-secret');
        },
      },
      () => 1000,
    ).append(event),
    (error: unknown) => {
      assert.equal((error as Error).message, safe.message);
      assert.equal((error as Error).cause, undefined);
      return true;
    },
  );
  await assert.rejects(
    createPostgresTokenManagementAuditStore({ query: async () => ({ rows: [] }) }, () => {
      throw new Error('private-clock');
    }).append(event),
    safe,
  );
});
