import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresChatHandler } from '../src/gateway/postgres-chat-handler.ts';
import { createPostgresProxyCredentialStore } from '../src/gateway/postgres-proxy-credentials.ts';
import { createProxyTokenService } from '../src/gateway/proxy-tokens.ts';
import { createPostgresPolicySimulator } from '../src/policy/postgres-policy-simulator.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';

const input = { principalId: 'user-1', action: 'llm:InvokeModel', resource: 'model:chat' };
const allow = [
  { effect: 'Allow', actions: ['llm:InvokeModel'], resources: ['model:chat*'] },
  { effect: 'Allow', actions: ['llm:UseProvider'], resources: ['provider:openai'] },
];
const deny = [{ effect: 'Deny', actions: ['llm:*'], resources: ['*'] }];
const allowed = {
  effect: 'Allow',
  reason: 'allowed',
  policyVersions: [{ id: 'role-allow', version: 'v1' }],
};
const unavailable = {
  name: 'PolicySimulationUnavailable',
  message: 'Policy simulation unavailable',
};

async function fixture() {
  const db = new PGlite();
  for (const migration of await loadPostgresMigrationSources()) await db.exec(migration.sql);
  await db.exec(`
    INSERT INTO iam_principals VALUES ('user-1', 'human', true), ('unattached', 'service', true), ('inactive', 'human', false);
    INSERT INTO iam_roles VALUES ('team');
    INSERT INTO iam_policies VALUES ('role-allow', 'v1', '[]');
    INSERT INTO iam_principal_roles VALUES ('user-1', 'team');
    INSERT INTO iam_role_policies VALUES ('team', 'role-allow');
    INSERT INTO iam_principal_policies VALUES ('inactive', 'role-allow');
  `);
  await db.query('UPDATE iam_policies SET statements = $1::jsonb', [JSON.stringify(allow)]);
  const reads: string[] = [];
  const client = {
    query: (sql: string, params: readonly unknown[]) => {
      reads.push(sql);
      return db.query(sql, [...params]);
    },
  };
  return { db, client, reads, simulate: createPostgresPolicySimulator(client) };
}

test('persisted simulation resolves role grants, mismatches, inactive and missing principals with projected output', async () => {
  const { db, simulate, reads } = await fixture();
  try {
    assert.deepEqual(await simulate(input), allowed);
    assert.deepEqual(await simulate({ ...input, resource: 'model:chat-expensive' }), allowed);
    for (const change of [{ action: 'iam:Manage' }, { resource: 'model:other' }]) {
      assert.deepEqual(await simulate({ ...input, ...change }), {
        ...allowed,
        effect: 'Deny',
        reason: 'implicit-deny',
      });
    }
    assert.deepEqual(await simulate({ ...input, principalId: 'unattached' }), {
      effect: 'Deny',
      reason: 'implicit-deny',
      policyVersions: [],
    });
    assert.deepEqual(await simulate({ ...input, principalId: 'inactive' }), {
      effect: 'Deny',
      reason: 'inactive',
      policyVersions: [],
    });
    assert.equal(await simulate({ ...input, principalId: 'missing' }), undefined);
    const forged = {
      ...input,
      principal: { active: false },
      statements: deny,
      policyVersions: [{ id: 'forged', version: 'private' }],
    };
    assert.deepEqual(await simulate(forged), allowed);
    const forgedGrant = { ...input, principalId: 'unattached', active: true, statements: allow };
    assert.deepEqual(await simulate(forgedGrant), {
      effect: 'Deny',
      reason: 'implicit-deny',
      policyVersions: [],
    });
    assert.equal(reads.length, 9);
    assert.ok(reads.every((sql) => sql.trimStart().startsWith('SELECT')));
    for (const table of [
      'proxy_credentials',
      'proxy_credential_events',
      'usage_records',
      'gateway_audit_events',
      'token_management_decisions',
    ]) {
      assert.equal((await db.query(`SELECT * FROM ${table}`)).rows.length, 0);
    }
  } finally {
    await db.close();
  }
});

test('direct Deny wins and policy/version/attachment/state changes affect the next call', async () => {
  const { db, simulate } = await fixture();
  try {
    assert.deepEqual(await simulate(input), allowed);
    await db.query("INSERT INTO iam_policies VALUES ('direct-deny', 'd1', $1::jsonb)", [
      JSON.stringify(deny),
    ]);
    await db.exec("INSERT INTO iam_principal_policies VALUES ('user-1', 'direct-deny')");
    assert.deepEqual(await simulate(input), {
      effect: 'Deny',
      reason: 'explicit-deny',
      policyVersions: [
        { id: 'direct-deny', version: 'd1' },
        { id: 'role-allow', version: 'v1' },
      ],
    });
    await db.exec("DELETE FROM iam_principal_policies WHERE principal_id = 'user-1'");
    await db.query(
      "UPDATE iam_policies SET version = 'v2', statements = $1::jsonb WHERE policy_id = 'role-allow'",
      [JSON.stringify(deny)],
    );
    assert.deepEqual(await simulate(input), {
      effect: 'Deny',
      reason: 'explicit-deny',
      policyVersions: [{ id: 'role-allow', version: 'v2' }],
    });
    await db.exec("DELETE FROM iam_principal_roles WHERE principal_id = 'user-1'");
    assert.deepEqual(await simulate(input), {
      effect: 'Deny',
      reason: 'implicit-deny',
      policyVersions: [],
    });
    await db.query(
      "UPDATE iam_policies SET version = 'v3', statements = $1::jsonb WHERE policy_id = 'role-allow'",
      [JSON.stringify(allow)],
    );
    await db.exec("INSERT INTO iam_principal_policies VALUES ('user-1', 'role-allow')");
    assert.deepEqual(await simulate(input), {
      ...allowed,
      policyVersions: [{ id: 'role-allow', version: 'v3' }],
    });
    await db.exec("UPDATE iam_principals SET active = false WHERE principal_id = 'user-1'");
    assert.deepEqual(await simulate(input), {
      effect: 'Deny',
      reason: 'inactive',
      policyVersions: [],
    });
  } finally {
    await db.close();
  }
});

test('malformed and incomplete snapshots fail safely without partial grants', async () => {
  const { db, simulate } = await fixture();
  try {
    await db.exec('UPDATE iam_policies SET statements = \'[{"effect":"Allow"}]\'');
    await assert.rejects(simulate(input), unavailable);
  } finally {
    await db.close();
  }
  const snapshot = {
    principal: {
      id: 'user-1',
      kind: 'human',
      active: true,
      directPolicyIds: ['valid'],
      roleIds: ['missing'],
    },
    roles: [],
    policies: [{ id: 'valid', version: 'v1', statements: allow }],
  };
  await assert.rejects(
    createPostgresPolicySimulator({ query: async () => ({ rows: [{ snapshot }] }) })(input),
    unavailable,
  );
  await assert.rejects(
    createPostgresPolicySimulator({
      query: async () => {
        throw new Error('private-driver-secret');
      },
    })(input),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, unavailable.name);
      assert.equal(error.message, unavailable.message);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test('invalid simulation inputs reject before SQL', async () => {
  let reads = 0;
  const simulate = createPostgresPolicySimulator({
    query: async () => {
      reads++;
      return { rows: [] };
    },
  });
  for (const invalid of [
    null,
    [],
    {},
    { ...input, principalId: '' },
    { ...input, principalId: 'x'.repeat(257) },
    { ...input, action: '' },
    { ...input, action: 'x'.repeat(513) },
    { ...input, action: 3 },
    { ...input, resource: '' },
    { ...input, resource: 'x'.repeat(513) },
  ]) {
    await assert.rejects(simulate(invalid as Parameters<typeof simulate>[0]), {
      name: 'InvalidPolicySimulationInput',
    });
  }
  assert.equal(reads, 0);
});

test('persisted model/provider simulation agrees with actual gateway IAM decisions', async () => {
  const { db, client, simulate } = await fixture();
  try {
    await db.exec(`
      INSERT INTO catalog_models VALUES ('chat', 1000, true, NULL);
      INSERT INTO catalog_routes (route_id, alias, kind, version, candidates) VALUES
        ('route-v1', 'chat', 'managed', 'v1', '[{"id":"openai","kind":"managed","providerId":"openai","upstreamModelId":"fixture"}]');
      UPDATE catalog_models SET active_route_id = 'route-v1';
    `);
    const tokens = createProxyTokenService({
      store: createPostgresProxyCredentialStore(client),
      now: () => 1000,
    });
    const issued = await tokens.issue({
      principalId: 'user-1',
      actorId: 'bootstrap',
      requestId: 'issue',
      expiresAt: 10000,
    });
    let calls = 0;
    let requests = 0;
    const handler = createPostgresChatHandler({
      client,
      now: () => 1000,
      newRequestId: () => `live-${++requests}`,
      checkLimit: async () => true,
      resolveSecret: async () => {
        throw new Error('unexpected secret lookup');
      },
      invokeDirect: async () => {
        calls++;
        return { id: 'completion', model: 'chat' };
      },
    });
    const call = () =>
      handler(
        new Request('http://localhost/v1/chat/completions', {
          method: 'POST',
          headers: { authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'chat', messages: [{ role: 'user', content: 'fixture' }] }),
        }),
      );
    const provider = { ...input, action: 'llm:UseProvider', resource: 'provider:openai' };
    assert.equal((await simulate(input))?.effect, 'Allow');
    assert.equal((await simulate(provider))?.effect, 'Allow');
    assert.equal((await call()).status, 200);
    await db.query("INSERT INTO iam_policies VALUES ('deny', 'd1', $1::jsonb)", [
      JSON.stringify([
        { effect: 'Deny', actions: ['llm:UseProvider'], resources: ['provider:openai'] },
      ]),
    ]);
    await db.exec("INSERT INTO iam_principal_policies VALUES ('user-1', 'deny')");
    assert.equal((await simulate(input))?.effect, 'Allow');
    assert.equal((await simulate(provider))?.effect, 'Deny');
    assert.equal((await call()).status, 403);
    await db.exec(
      "DELETE FROM iam_principal_policies WHERE policy_id = 'deny'; DELETE FROM iam_principal_roles WHERE principal_id = 'user-1'",
    );
    assert.equal((await simulate(input))?.reason, 'implicit-deny');
    assert.equal((await call()).status, 403);
    await db.exec("UPDATE iam_principals SET active = false WHERE principal_id = 'user-1'");
    assert.equal((await simulate(input))?.reason, 'inactive');
    assert.equal((await call()).status, 401);
    assert.equal(calls, 1);
    assert.equal((await db.query('SELECT * FROM usage_records')).rows.length, 1);
  } finally {
    await db.close();
  }
});
