import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  SsoManagementAuthenticationUnavailable,
  SsoManagementUnauthenticated,
} from '../src/identity/postgres-sso-human-authentication.ts';
import {
  createPostgresRfc9068SsoPolicyAuthenticator,
  createPostgresSsoPolicyAuthenticator,
} from '../src/identity/postgres-sso-policy-context.ts';
import { evaluate } from '../src/policy/evaluate.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
const snapshot = {
  principal: { id: 'human', kind: 'human', active: true, directPolicyIds: ['allow'], roleIds: [] },
  roles: [],
  policies: [
    {
      id: 'allow',
      version: 'v1',
      statements: [{ effect: 'Allow', actions: ['llm:InvokeModel'], resources: ['model:chat'] }],
    },
  ],
};
function fake(value: unknown = snapshot) {
  const queries: string[] = [];
  const authenticate = createPostgresSsoPolicyAuthenticator({
    verifyAccessToken: async () => ({ issuer: jwt.issuer, subject: jwt.subject }),
    client: {
      query: async (sql) => {
        queries.push(sql);
        return {
          rows: sql.includes('FROM iam_sso_identity_bindings')
            ? [
                {
                  issuer: jwt.issuer,
                  subject: jwt.subject,
                  principal_id: 'human',
                  kind: 'human',
                  active: true,
                },
              ]
            : value === null
              ? []
              : [{ snapshot: value }],
        };
      },
    },
  });
  return { authenticate, queries };
}
test('internal context resolves current policy without inventing a proxy credential', async () => {
  const { authenticate, queries } = fake();
  const result = await authenticate(token);
  assert.deepEqual(result, {
    id: 'human',
    active: true,
    statements: snapshot.policies[0]?.statements,
    policyVersions: [{ id: 'allow', version: 'v1' }],
  });
  assert.doesNotMatch(JSON.stringify(result), /credential|issuer|subject|token|roleIds/u);
  assert.equal(queries.length, 2);
  assert.ok(
    queries.every(
      (sql) => !/INSERT|UPDATE|DELETE|proxy_credentials|usage|gateway_audit/u.test(sql),
    ),
  );
});
for (const [name, value, error] of [
  ['missing', null, SsoManagementUnauthenticated],
  [
    'inactive',
    { ...snapshot, principal: { ...snapshot.principal, active: false } },
    SsoManagementUnauthenticated,
  ],
  [
    'changed kind',
    { ...snapshot, principal: { ...snapshot.principal, kind: 'service' } },
    SsoManagementUnauthenticated,
  ],
  [
    'wrong principal',
    { ...snapshot, principal: { ...snapshot.principal, id: 'other' } },
    SsoManagementAuthenticationUnavailable,
  ],
  [
    'missing attached policy',
    { ...snapshot, policies: [] },
    SsoManagementAuthenticationUnavailable,
  ],
  [
    'missing attached role',
    { ...snapshot, principal: { ...snapshot.principal, roleIds: ['absent'] } },
    SsoManagementAuthenticationUnavailable,
  ],
  [
    'bad statement',
    { ...snapshot, policies: [{ ...snapshot.policies[0], statements: [{ effect: 'Admin' }] }] },
    SsoManagementAuthenticationUnavailable,
  ],
] as const) {
  test(`context fails closed for ${name}`, async () => {
    await assert.rejects(fake(value).authenticate(token), error);
  });
}
test('rejected identity never reaches IAM; SQL errors are fixed and private', async () => {
  let queries = 0;
  const rejected = createPostgresSsoPolicyAuthenticator({
    client: {
      query: async () => {
        queries++;
        throw Error('private');
      },
    },
    verifyAccessToken: async () => undefined,
  });
  await assert.rejects(rejected(token), SsoManagementUnauthenticated);
  assert.equal(queries, 0);
  const unavailable = createPostgresSsoPolicyAuthenticator({
    client: {
      query: async (sql) => {
        if (sql.includes('FROM iam_sso_identity_bindings'))
          return {
            rows: [
              {
                issuer: jwt.issuer,
                subject: jwt.subject,
                principal_id: 'human',
                kind: 'human',
                active: true,
              },
            ],
          };
        throw Error('private SQL and access token');
      },
    },
    verifyAccessToken: async () => ({ issuer: jwt.issuer, subject: jwt.subject }),
  });
  await assert.rejects(unavailable(token), (error) => {
    assert.ok(error instanceof SsoManagementAuthenticationUnavailable);
    assert.equal(error.message, 'SSO management authentication unavailable');
    assert.equal(error.cause, undefined);
    return true;
  });
});
test('signed JWT + SQL: role/direct policies, fresh Deny/version, binding and principal changes', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL('../migrations/004_iam_snapshots.sql', import.meta.url), 'utf8'),
    );
    await db.exec(
      await readFile(
        new URL('../migrations/011_sso_identity_bindings.sql', import.meta.url),
        'utf8',
      ),
    );
    await db.query("INSERT INTO iam_principals VALUES ('human', 'human', true)");
    await db.query(
      'INSERT INTO iam_sso_identity_bindings (issuer, subject, principal_id) VALUES ($1,$2,$3)',
      [jwt.issuer, jwt.subject, 'human'],
    );
    await db.query("INSERT INTO iam_roles VALUES ('reader')");
    await db.query('INSERT INTO iam_policies VALUES ($1,$2,$3::jsonb)', [
      'allow',
      'v1',
      JSON.stringify(snapshot.policies[0]?.statements),
    ]);
    await db.query("INSERT INTO iam_principal_roles VALUES ('human','reader')");
    await db.query("INSERT INTO iam_role_policies VALUES ('reader','allow')");
    const sql: string[] = [];
    const authenticate = createPostgresRfc9068SsoPolicyAuthenticator({
      ...jwt.config,
      client: {
        query: async (query, params) => {
          sql.push(query);
          return db.query(query, [...params]);
        },
      },
    });
    const decide = async () =>
      evaluate({
        principalActive: true,
        action: 'llm:InvokeModel',
        resource: 'model:chat',
        statements: (await authenticate(token)).statements,
      });
    assert.equal((await decide()).effect, 'Allow');
    await db.query('INSERT INTO iam_policies VALUES ($1,$2,$3::jsonb)', [
      'deny',
      'v2',
      JSON.stringify([{ effect: 'Deny', actions: ['llm:InvokeModel'], resources: ['model:chat'] }]),
    ]);
    await db.query("INSERT INTO iam_principal_policies VALUES ('human','deny')");
    assert.equal((await decide()).effect, 'Deny');
    assert.deepEqual((await authenticate(token)).policyVersions, [
      { id: 'deny', version: 'v2' },
      { id: 'allow', version: 'v1' },
    ]);
    await db.query("UPDATE iam_policies SET version='v3' WHERE policy_id='deny'");
    assert.equal((await authenticate(token)).policyVersions[0]?.version, 'v3');
    await assert.rejects(
      authenticate(await jwt.token({ exp: jwt.nowSeconds - 100 })),
      SsoManagementUnauthenticated,
    );
    await db.query("UPDATE iam_principals SET active=false WHERE principal_id='human'");
    await assert.rejects(authenticate(token), SsoManagementUnauthenticated);
    await db.query(
      "UPDATE iam_principals SET active=true, kind='service' WHERE principal_id='human'",
    );
    await assert.rejects(authenticate(token), SsoManagementUnauthenticated);
    await db.query("UPDATE iam_principals SET kind='human' WHERE principal_id='human'");
    await db.query('DELETE FROM iam_sso_identity_bindings');
    await assert.rejects(authenticate(token), SsoManagementUnauthenticated);
    assert.ok(
      sql.every(
        (query) => !/INSERT|UPDATE|DELETE|proxy_credentials|usage|gateway_audit/u.test(query),
      ),
    );
  } finally {
    await db.close();
  }
});

test('every call verifies and reads again; prior context cannot grant future rights', async () => {
  let verifies = 0;
  let reads = 0;
  let current = snapshot;
  const authenticate = createPostgresSsoPolicyAuthenticator({
    verifyAccessToken: async () => {
      verifies++;
      return { issuer: jwt.issuer, subject: jwt.subject };
    },
    client: {
      query: async (sql) => {
        reads++;
        return {
          rows: sql.includes('FROM iam_sso_identity_bindings')
            ? [
                {
                  issuer: jwt.issuer,
                  subject: jwt.subject,
                  principal_id: 'human',
                  kind: 'human',
                  active: true,
                },
              ]
            : [{ snapshot: current }],
        };
      },
    },
  });
  const first = await authenticate(token);
  current = {
    ...snapshot,
    principal: { ...snapshot.principal, directPolicyIds: [] },
    policies: [],
  };
  const second = await authenticate(token);
  assert.equal(first.statements.length, 1);
  assert.deepEqual(second.statements, []);
  assert.deepEqual(second.policyVersions, []);
  assert.equal(
    evaluate({
      principalActive: true,
      action: 'llm:InvokeModel',
      resource: 'model:chat',
      statements: second.statements,
    }).effect,
    'Deny',
  );
  assert.deepEqual({ verifies, reads }, { verifies: 2, reads: 4 });
});
test('RFC factory rejects malformed configuration before creating an authenticator', () => {
  for (const value of [
    null,
    [],
    {},
    { ...jwt.config, client: {} },
    { ...jwt.config, client: null },
    { ...jwt.config, issuer: '', client: { query: async () => ({ rows: [] }) } },
  ]) {
    assert.throws(
      () =>
        createPostgresRfc9068SsoPolicyAuthenticator(
          value as Parameters<typeof createPostgresRfc9068SsoPolicyAuthenticator>[0],
        ),
      {
        name: 'InvalidSsoAccessTokenConfiguration',
        message: 'Invalid SSO access token configuration',
      },
    );
  }
});
