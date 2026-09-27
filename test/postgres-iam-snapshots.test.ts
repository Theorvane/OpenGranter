import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createAttachmentAuthenticator } from '../src/gateway/attachment-authenticator.ts';
import { createPostgresIdentitySnapshotStore } from '../src/identity/postgres-snapshots.ts';
import { evaluate } from '../src/policy/evaluate.ts';

const migration = await readFile(
  new URL('../migrations/004_iam_snapshots.sql', import.meta.url),
  'utf8',
);

async function fixture() {
  const db = new PGlite();
  await db.exec(migration);
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const store = createPostgresIdentitySnapshotStore({
    query: (sql, params) => {
      calls.push({ sql, params });
      return db.query(sql, [...params]);
    },
  });
  return { db, store, calls };
}

test('one SQL statement loads direct and role policies for authentication', async () => {
  const { db, store, calls } = await fixture();
  try {
    await db.exec(`
      INSERT INTO iam_principals (principal_id, kind, active) VALUES ('service-1', 'service', true);
      INSERT INTO iam_roles (role_id) VALUES ('developer');
      INSERT INTO iam_policies (policy_id, version, statements) VALUES
        ('model-allow', 'v1', '[{"effect":"Allow","actions":["llm:InvokeModel"],"resources":["model:chat"]}]'),
        ('provider-allow', 'v2', '[{"effect":"Allow","actions":["llm:UseProvider"],"resources":["provider:openai"]}]');
      INSERT INTO iam_principal_policies VALUES ('service-1', 'model-allow');
      INSERT INTO iam_principal_roles VALUES ('service-1', 'developer');
      INSERT INTO iam_role_policies VALUES ('developer', 'provider-allow');
    `);
    const authenticate = createAttachmentAuthenticator({
      verifyCredential: async () => ({
        credentialId: 'credential-1',
        principalId: 'service-1',
        active: true,
      }),
      loadSnapshot: store.loadSnapshot,
    });
    const identity = await authenticate('token-not-persisted');
    assert.equal(identity?.id, 'service-1');
    assert.deepEqual(identity?.policyVersions, [
      { id: 'model-allow', version: 'v1' },
      { id: 'provider-allow', version: 'v2' },
    ]);
    assert.deepEqual(
      evaluate({
        principalActive: true,
        action: 'llm:UseProvider',
        resource: 'provider:openai',
        statements: identity?.statements ?? [],
      }),
      { effect: 'Allow', reason: 'allowed' },
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.params, ['service-1']);
  } finally {
    await db.close();
  }
});

test('direct Deny overrides role Allow and inactive principals cannot authenticate', async () => {
  const { db, store } = await fixture();
  try {
    await db.exec(`
      INSERT INTO iam_principals VALUES ('service-1', 'service', true);
      INSERT INTO iam_roles VALUES ('developer');
      INSERT INTO iam_policies VALUES
        ('allow', 'v1', '[{"effect":"Allow","actions":["llm:InvokeModel"],"resources":["model:chat"]}]'),
        ('deny', 'v1', '[{"effect":"Deny","actions":["llm:InvokeModel"],"resources":["model:chat"]}]');
      INSERT INTO iam_principal_roles VALUES ('service-1', 'developer');
      INSERT INTO iam_role_policies VALUES ('developer', 'allow');
      INSERT INTO iam_principal_policies VALUES ('service-1', 'deny');
    `);
    const authenticate = createAttachmentAuthenticator({
      verifyCredential: async () => ({
        credentialId: 'credential-1',
        principalId: 'service-1',
        active: true,
      }),
      loadSnapshot: store.loadSnapshot,
    });
    const identity = await authenticate('token-not-persisted');
    assert.deepEqual(
      evaluate({
        principalActive: true,
        action: 'llm:InvokeModel',
        resource: 'model:chat',
        statements: identity?.statements ?? [],
      }),
      { effect: 'Deny', reason: 'explicit-deny' },
    );
    await db.exec("UPDATE iam_principals SET active = false WHERE principal_id = 'service-1'");
    assert.equal(await authenticate('token-not-persisted'), undefined);
  } finally {
    await db.close();
  }
});

test('missing principal and parameterized lookup do not expose another identity', async () => {
  const { db, store, calls } = await fixture();
  try {
    await db.exec("INSERT INTO iam_principals VALUES ('service-1', 'service', true)");
    assert.equal(await store.loadSnapshot('missing'), undefined);
    assert.equal(await store.loadSnapshot("service-1' OR true --"), undefined);
    assert.deepEqual(
      calls.map((call) => call.params),
      [['missing'], ["service-1' OR true --"]],
    );
  } finally {
    await db.close();
  }
});

test('malformed policy JSON and missing referenced role fail closed', async () => {
  const { db, store } = await fixture();
  try {
    await db.exec(`
      INSERT INTO iam_principals VALUES ('service-1', 'service', true);
      INSERT INTO iam_policies VALUES ('broken', 'v1', '[{"effect":"Allow","actions":"bad","resources":["model:chat"]}]');
      INSERT INTO iam_principal_policies VALUES ('service-1', 'broken');
    `);
    await assert.rejects(store.loadSnapshot('service-1'), {
      name: 'IdentitySnapshotUnavailable',
      message: 'Identity attachment snapshot unavailable',
    });
  } finally {
    await db.close();
  }

  const missingRole = createPostgresIdentitySnapshotStore({
    query: async () => ({
      rows: [
        {
          snapshot: {
            principal: {
              id: 'service-1',
              kind: 'service',
              active: true,
              directPolicyIds: [],
              roleIds: ['missing'],
            },
            roles: [],
            policies: [],
          },
        },
      ],
    }),
  });
  await assert.rejects(missingRole.loadSnapshot('service-1'), {
    name: 'IdentitySnapshotUnavailable',
    message: 'Identity attachment snapshot unavailable',
  });
});

test('database errors and unexpected JSONB fields do not leak sensitive content', async () => {
  const failing = createPostgresIdentitySnapshotStore({
    query: async () => {
      throw new Error('private database detail');
    },
  });
  await assert.rejects(failing.loadSnapshot('service-1'), {
    name: 'IdentitySnapshotUnavailable',
    message: 'Identity attachment snapshot unavailable',
  });

  const extra = createPostgresIdentitySnapshotStore({
    query: async () => ({
      rows: [
        {
          snapshot: {
            principal: {
              id: 'service-1',
              kind: 'service',
              active: true,
              directPolicyIds: ['allow'],
              roleIds: [],
              token: 'private token',
            },
            roles: [],
            policies: [
              {
                id: 'allow',
                version: 'v1',
                statements: [
                  {
                    effect: 'Allow',
                    actions: ['llm:InvokeModel'],
                    resources: ['model:chat'],
                    providerKey: 'private key',
                  },
                ],
                secret: 'private secret',
              },
            ],
          },
        },
      ],
    }),
  });
  const snapshot = await extra.loadSnapshot('service-1');
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
});
