import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresProxyCredentialStore } from '../src/gateway/postgres-proxy-credentials.ts';
import { createPostgresTokenManagementService } from '../src/gateway/postgres-token-management-service.ts';
import { createProxyTokenService } from '../src/gateway/proxy-tokens.ts';

const issue = {
  authenticatedActorId: 'admin-1',
  requestId: 'issue-1',
  principalId: 'service-1',
  expiresAt: 10_000,
};
const denied = { name: 'TokenManagementDenied', message: 'Token management denied' };
const unavailable = { name: 'TokenManagementUnavailable', message: 'Token management unavailable' };
const allow = [{ effect: 'Allow', actions: ['iam:Manage'], resources: ['principal:service-1'] }];
const deny = [{ effect: 'Deny', actions: ['iam:Manage'], resources: ['*'] }];

async function fixture() {
  const db = new PGlite();
  for (const name of [
    '002_proxy_credentials.sql',
    '004_iam_snapshots.sql',
    '008_token_management_decisions.sql',
  ]) {
    await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  await db.exec(`
    INSERT INTO iam_principals VALUES ('admin-1', 'human', true), ('service-1', 'service', true), ('unattached', 'human', true);
    INSERT INTO iam_roles VALUES ('managers');
    INSERT INTO iam_principal_roles VALUES ('admin-1', 'managers');
    INSERT INTO iam_policies VALUES ('manage', 'v1', '[]');
    INSERT INTO iam_role_policies VALUES ('managers', 'manage');
  `);
  await db.query('UPDATE iam_policies SET statements = $1::jsonb', [JSON.stringify(allow)]);
  const client = { query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]) };
  const now = () => 1_000;
  const service = createPostgresTokenManagementService({ client, now });
  const tokens = createProxyTokenService({
    store: createPostgresProxyCredentialStore(client),
    now,
  });
  const decisions = async () =>
    (
      await db.query<Record<string, unknown>>(
        'SELECT outcome, actor_id, target_principal_id, policy_versions FROM token_management_decisions ORDER BY event_id',
      )
    ).rows;
  return { db, client, now, service, tokens, decisions };
}

test('fresh persisted role policies grant issuance and owner-scoped revocation', async () => {
  const { db, service, tokens, decisions } = await fixture();
  try {
    const issued = await service.issue(issue);
    assert.equal((await tokens.verifyCredential(issued.token))?.principalId, 'service-1');
    assert.equal(
      await service.revoke({
        authenticatedActorId: 'admin-1',
        requestId: 'revoke-1',
        credentialId: issued.credentialId,
      }),
      true,
    );
    assert.equal(await tokens.verifyCredential(issued.token), undefined);
    assert.deepEqual(
      await decisions(),
      Array.from({ length: 2 }, () => ({
        outcome: 'allowed',
        actor_id: 'admin-1',
        target_principal_id: 'service-1',
        policy_versions: [{ id: 'manage', version: 'v1' }],
      })),
    );
    assert.deepEqual(
      (await db.query('SELECT action FROM proxy_credential_events ORDER BY event_id')).rows,
      [{ action: 'issued' }, { action: 'revoked' }],
    );
    assert.equal(JSON.stringify(await decisions()).includes(issued.token), false);
  } finally {
    await db.close();
  }
});

test('next operation observes policy versions, direct Deny, attachment removal and inactive state', async () => {
  const { db, service, tokens, decisions } = await fixture();
  try {
    const issued = await service.issue(issue);
    const revoke = {
      authenticatedActorId: 'admin-1',
      requestId: 'revoke',
      credentialId: issued.credentialId,
    };
    await db.query("UPDATE iam_policies SET version = 'v2', statements = $1::jsonb", [
      JSON.stringify(deny),
    ]);
    await assert.rejects(service.revoke(revoke), denied);
    assert.ok(await tokens.verifyCredential(issued.token));
    assert.deepEqual((await decisions()).at(-1)?.policy_versions, [
      { id: 'manage', version: 'v2' },
    ]);
    await db.query("UPDATE iam_policies SET version = 'v3', statements = $1::jsonb", [
      JSON.stringify(allow),
    ]);
    await db.query("INSERT INTO iam_policies VALUES ('direct-deny', 'd1', $1::jsonb)", [
      JSON.stringify(deny),
    ]);
    await db.exec("INSERT INTO iam_principal_policies VALUES ('admin-1', 'direct-deny')");
    await assert.rejects(service.revoke(revoke), denied);
    assert.deepEqual((await decisions()).at(-1)?.policy_versions, [
      { id: 'direct-deny', version: 'd1' },
      { id: 'manage', version: 'v3' },
    ]);
    await db.exec('DELETE FROM iam_principal_policies; DELETE FROM iam_principal_roles');
    await assert.rejects(service.revoke(revoke), denied);
    assert.deepEqual((await decisions()).at(-1)?.policy_versions, []);
    await db.exec(
      "INSERT INTO iam_principal_roles VALUES ('admin-1', 'managers'); UPDATE iam_principals SET active = false WHERE principal_id = 'admin-1'",
    );
    await assert.rejects(service.revoke(revoke), denied);
    assert.equal((await decisions()).at(-1)?.target_principal_id, null);
    assert.deepEqual((await decisions()).at(-1)?.policy_versions, []);
    assert.ok(await tokens.verifyCredential(issued.token));
    await db.exec("UPDATE iam_principals SET active = true WHERE principal_id = 'admin-1'");
    assert.equal(await service.revoke(revoke), true);
    assert.equal(await tokens.verifyCredential(issued.token), undefined);
  } finally {
    await db.close();
  }
});

test('missing, inactive and unattached actors deny despite forged caller grants', async () => {
  const { db, service, decisions } = await fixture();
  try {
    await db.exec("UPDATE iam_principals SET active = false WHERE principal_id = 'admin-1'");
    for (const authenticatedActorId of ['missing', 'admin-1', 'unattached']) {
      await assert.rejects(
        service.issue({
          ...issue,
          authenticatedActorId,
          actor: {
            id: 'forged',
            active: true,
            statements: allow,
            policyVersions: [{ id: 'forged', version: 'secret' }],
          },
          active: true,
          statements: allow,
          policyVersions: [{ id: 'forged', version: 'secret' }],
        } as Parameters<typeof service.issue>[0]),
        denied,
      );
    }
    assert.deepEqual(
      await decisions(),
      ['missing', 'admin-1', 'unattached'].map((actor_id) => ({
        outcome: 'denied',
        actor_id,
        target_principal_id: 'service-1',
        policy_versions: [],
      })),
    );
    assert.equal((await db.query('SELECT * FROM proxy_credentials')).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM proxy_credential_events')).rows.length, 0);
    await assert.rejects(
      service.revoke({
        authenticatedActorId: 'missing',
        requestId: 'missing-revoke',
        credentialId: 'unknown',
      }),
      denied,
    );
    assert.equal((await decisions()).at(-1)?.target_principal_id, null);
  } finally {
    await db.close();
  }
});

test('revocation evaluates the stored owner rather than caller nominated targets', async () => {
  const { db, service, tokens, decisions } = await fixture();
  try {
    const issued = await tokens.issue({
      principalId: 'service-2',
      actorId: 'bootstrap',
      requestId: 'bootstrap',
      expiresAt: 10_000,
    });
    await assert.rejects(
      service.revoke({
        authenticatedActorId: 'admin-1',
        requestId: 'wrong-owner',
        credentialId: issued.credentialId,
        principalId: 'service-1',
        targetPrincipalId: 'service-1',
      } as Parameters<typeof service.revoke>[0]),
      denied,
    );
    assert.ok(await tokens.verifyCredential(issued.token));
    assert.equal((await decisions()).at(-1)?.target_principal_id, 'service-2');
    await assert.rejects(
      service.revoke({
        authenticatedActorId: 'admin-1',
        requestId: 'unknown',
        credentialId: 'missing',
      }),
      denied,
    );
    assert.equal((await decisions()).at(-1)?.target_principal_id, null);
  } finally {
    await db.close();
  }
});

test('malformed snapshots and required decision failures prevent mutation', async () => {
  const { db, service, tokens, decisions } = await fixture();
  try {
    const issued = await service.issue(issue);
    await db.exec("UPDATE iam_policies SET statements = '[{}]'::jsonb");
    const revoke = {
      authenticatedActorId: 'admin-1',
      requestId: 'revoke',
      credentialId: issued.credentialId,
    };
    await assert.rejects(service.issue(issue), unavailable);
    await assert.rejects(service.revoke(revoke), unavailable);
    assert.equal((await decisions()).length, 1);
    await db.query('UPDATE iam_policies SET statements = $1::jsonb', [JSON.stringify(allow)]);
    await db.exec('DROP TABLE token_management_decisions');
    await assert.rejects(service.issue(issue), unavailable);
    await assert.rejects(service.revoke(revoke), unavailable);
    assert.ok(await tokens.verifyCredential(issued.token));
    assert.equal((await db.query('SELECT * FROM proxy_credentials')).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM proxy_credential_events')).rows.length, 1);
  } finally {
    await db.close();
  }
});

test('snapshot failures expose fixed availability errors without driver secrets', async () => {
  const service = createPostgresTokenManagementService({
    client: {
      query: async () => {
        throw new Error('private-driver-secret');
      },
    },
    now: () => 1000,
  });
  for (const operation of [
    () => service.issue(issue),
    () => service.revoke({ authenticatedActorId: 'admin-1', requestId: 'r', credentialId: 'c' }),
  ]) {
    await assert.rejects(operation, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, unavailable.name);
      assert.equal(error.message, unavailable.message);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test('invalid operation input rejects before database reads or mutations', async () => {
  let calls = 0;
  const service = createPostgresTokenManagementService({
    client: {
      query: async () => {
        calls++;
        return { rows: [] };
      },
    },
    now: () => 1000,
  });
  const invalid = { name: 'InvalidTokenManagementInput' };
  for (const input of [
    null,
    { ...issue, authenticatedActorId: '' },
    { ...issue, authenticatedActorId: 'a'.repeat(257) },
    { ...issue, authenticatedActorId: 3 },
    { ...issue, requestId: '' },
    { ...issue, principalId: '' },
    { ...issue, expiresAt: -1 },
    { ...issue, expiresAt: 1.5 },
    { ...issue, expiresAt: Number.MAX_SAFE_INTEGER + 1 },
  ])
    await assert.rejects(service.issue(input as Parameters<typeof service.issue>[0]), invalid);
  for (const input of [
    null,
    { authenticatedActorId: '', requestId: 'r', credentialId: 'c' },
    { authenticatedActorId: 'admin-1', requestId: '', credentialId: 'c' },
    { authenticatedActorId: 'admin-1', requestId: 'r', credentialId: '' },
  ])
    await assert.rejects(service.revoke(input as Parameters<typeof service.revoke>[0]), invalid);
  assert.equal(calls, 0);
});
