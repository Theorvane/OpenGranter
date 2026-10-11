import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  SsoManagementUnauthenticated as GatewayUnauthenticated,
  SsoManagementAuthenticationUnavailable as GatewayUnavailable,
} from '../src/gateway/postgres-sso-token-management-service.ts';
import {
  createPostgresSsoHumanAuthenticator,
  SsoManagementAuthenticationUnavailable,
  SsoManagementUnauthenticated,
} from '../src/identity/postgres-sso-human-authentication.ts';
import { createRfc9068SsoAccessTokenVerifier } from '../src/identity/rfc9068-sso-access-tokens.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
const identity = { issuer: jwt.issuer, subject: jwt.subject };
const bound = { ...identity, principal_id: 'human', kind: 'human', active: true };
type Ports = Parameters<typeof createPostgresSsoHumanAuthenticator>[0];
function fixed(errorClass: typeof SsoManagementUnauthenticated, message: string) {
  return (error: unknown) => {
    assert.ok(error instanceof errorClass);
    assert.equal(error.message, message);
    assert.equal(error.cause, undefined);
    assert.deepEqual(Object.keys(error), ['name']);
    return true;
  };
}
const unauthenticated = fixed(SsoManagementUnauthenticated, 'SSO management unauthenticated');
const unavailable = fixed(
  SsoManagementAuthenticationUnavailable,
  'SSO management authentication unavailable',
);

for (const [name, input] of [
  ['null', null],
  ['undefined', undefined],
  ['number', 1],
  ['array', []],
  ['claims object', identity],
  ['empty', ''],
  ['oversized', 'x'.repeat(16385)],
  ['NUL', 'x\0y'],
  ['high surrogate', '\ud800'],
  ['low surrogate', '\udfff'],
] as const) {
  test(`human authenticator rejects ${name} before verifier and SQL`, async () => {
    let verifies = 0;
    let queries = 0;
    const authenticate = createPostgresSsoHumanAuthenticator({
      verifyAccessToken: async () => {
        verifies++;
        return identity;
      },
      client: {
        query: async () => {
          queries++;
          return { rows: [bound] };
        },
      },
    });
    await assert.rejects(authenticate(input as string), unauthenticated);
    assert.equal(verifies, 0);
    assert.equal(queries, 0);
  });
}
for (const [name, verify, expected] of [
  ['rejected JWT', async () => undefined, unauthenticated],
  [
    'verifier failure',
    async () => {
      throw Error('private access token and claims');
    },
    unavailable,
  ],
  [
    'spoofed domain failure',
    async () => {
      throw new SsoManagementUnauthenticated();
    },
    unavailable,
  ],
  ['null claims', async () => null, unavailable],
  ['array claims', async () => [], unavailable],
  ['inherited claims', async () => Object.create(identity), unavailable],
  ['caller principal', async () => ({ principalId: 'human' }), unavailable],
  ['blank issuer', async () => ({ ...identity, issuer: '' }), unavailable],
  ['overlong issuer', async () => ({ ...identity, issuer: 'x'.repeat(2049) }), unavailable],
  ['NUL issuer', async () => ({ ...identity, issuer: 'x\0y' }), unavailable],
  ['blank subject', async () => ({ ...identity, subject: '' }), unavailable],
  ['overlong subject', async () => ({ ...identity, subject: 'x'.repeat(257) }), unavailable],
  ['ill-formed subject', async () => ({ ...identity, subject: '\ud800' }), unavailable],
  [
    'claim getter failure',
    async () => ({
      ...identity,
      get subject() {
        throw Error('private claims');
      },
    }),
    unavailable,
  ],
] as const) {
  test(`human authenticator handles ${name} before SQL`, async () => {
    let queries = 0;
    const authenticate = createPostgresSsoHumanAuthenticator({
      verifyAccessToken: verify as Ports['verifyAccessToken'],
      client: {
        query: async () => {
          queries++;
          return { rows: [bound] };
        },
      },
    });
    await assert.rejects(authenticate(token), expected);
    assert.equal(queries, 0);
  });
}
for (const [name, result, expected] of [
  ['missing binding', { rows: [] }, unauthenticated],
  ['inactive human', { rows: [{ ...bound, active: false }] }, unauthenticated],
  ['active service', { rows: [{ ...bound, kind: 'service' }] }, unauthenticated],
  ['duplicate bindings', { rows: [bound, bound] }, unavailable],
  ['mismatched issuer', { rows: [{ ...bound, issuer: 'https://other.example' }] }, unavailable],
  ['mismatched subject', { rows: [{ ...bound, subject: 'other' }] }, unavailable],
  ['invalid principal', { rows: [{ ...bound, principal_id: 'x\0y' }] }, unavailable],
  ['unknown kind', { rows: [{ ...bound, kind: 'admin' }] }, unavailable],
  ['invalid active', { rows: [{ ...bound, active: 'true' }] }, unavailable],
  ['inherited row fields', { rows: [Object.create(bound)] }, unavailable],
  ['rows hole', { rows: new Array(1) }, unavailable],
  ['missing rows', {}, unavailable],
  ['null rows', { rows: null }, unavailable],
  [
    'throwing result',
    {
      get rows() {
        throw Error('private database fixture');
      },
    },
    unavailable,
  ],
] as const) {
  test(`human authenticator safely handles ${name} binding result`, async () => {
    let queries = 0;
    const authenticate = createPostgresSsoHumanAuthenticator({
      verifyAccessToken: async () => identity,
      client: {
        query: async (sql, params) => {
          queries++;
          assert.match(sql, /JOIN iam_principals/u);
          assert.deepEqual(params, [jwt.issuer, jwt.subject]);
          return result as Awaited<ReturnType<Ports['client']['query']>>;
        },
      },
    });
    await assert.rejects(authenticate(token), expected);
    assert.equal(queries, 1);
  });
}
test('binding failure loses private database messages and causes', async () => {
  const authenticate = createPostgresSsoHumanAuthenticator({
    verifyAccessToken: async () => identity,
    client: {
      query: async () => {
        throw Error('private SQL, issuer, subject and token');
      },
    },
  });
  await assert.rejects(authenticate(token), unavailable);
});

test('ports are captured once and each call verifies/reads again without policies or mutations', async () => {
  let clientReads = 0;
  let verifierReads = 0;
  let verifies = 0;
  let queries = 0;
  let currentVerifier: Ports['verifyAccessToken'] = async (input) => {
    assert.equal(input, token);
    verifies++;
    return identity;
  };
  let currentClient: Ports['client'] = {
    query: async (sql, params) => {
      queries++;
      assert.match(sql, /FROM iam_sso_identity_bindings/u);
      assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE|polic|proxy_credentials|audit|usage/u);
      assert.deepEqual(params, [jwt.issuer, jwt.subject]);
      assert.ok(Object.isFrozen(params));
      return { rows: [bound] };
    },
  };
  const authenticate = createPostgresSsoHumanAuthenticator({
    get client() {
      assert.equal(++clientReads, 1);
      return currentClient;
    },
    get verifyAccessToken() {
      assert.equal(++verifierReads, 1);
      return currentVerifier;
    },
    get principalId() {
      throw Error('Extra caller authority');
    },
  } as Ports);
  currentVerifier = async () => {
    throw Error('Mutated port');
  };
  currentClient = {
    query: async () => {
      throw Error('Mutated query port');
    },
  };
  assert.equal(await authenticate(token), 'human');
  assert.equal(await authenticate(token), 'human');
  assert.deepEqual(
    { clientReads, verifierReads, verifies, queries },
    { clientReads: 1, verifierReads: 1, verifies: 2, queries: 2 },
  );
});

test('verified own claims are captured once and cannot change parameters across SQL awaits', async () => {
  let issuer = jwt.issuer;
  let subject = jwt.subject;
  let issuerReads = 0;
  let subjectReads = 0;
  const authenticate = createPostgresSsoHumanAuthenticator({
    verifyAccessToken: async () => ({
      get issuer() {
        assert.equal(++issuerReads, 1);
        return issuer;
      },
      get subject() {
        assert.equal(++subjectReads, 1);
        return subject;
      },
      get principalId() {
        throw Error('Extra caller identity');
      },
    }),
    client: {
      query: async (_sql, params) => {
        issuer = 'https://other.example';
        subject = 'worker';
        await Promise.resolve();
        assert.deepEqual(params, [jwt.issuer, jwt.subject]);
        assert.ok(Object.isFrozen(params));
        return { rows: [bound] };
      },
    },
  });
  assert.equal(await authenticate(token), 'human');
  assert.equal(issuerReads, 1);
  assert.equal(subjectReads, 1);
});

test('gateway error exports preserve the same authenticator constructors', () => {
  assert.equal(GatewayUnauthenticated, SsoManagementUnauthenticated);
  assert.equal(GatewayUnavailable, SsoManagementAuthenticationUnavailable);
});

test('runtime-signed authentication sees exact current active-human bindings without management work', async () => {
  const db = new PGlite();
  try {
    for (const migration of await loadPostgresMigrationSources()) await db.exec(migration.sql);
    await db.exec(
      "INSERT INTO iam_principals VALUES ('human','human',true),('other','human',true),('worker','service',true)",
    );
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    const queries: string[] = [];
    const authenticate = createPostgresSsoHumanAuthenticator({
      verifyAccessToken: createRfc9068SsoAccessTokenVerifier(jwt.config),
      client: {
        query: async (sql, params) => {
          queries.push(sql);
          return db.query(sql, [...params]);
        },
      },
    });
    assert.equal(await authenticate(token), 'human');
    await db.query(
      'UPDATE iam_sso_identity_bindings SET principal_id=$3 WHERE issuer=$1 AND subject=$2',
      [jwt.issuer, jwt.subject, 'other'],
    );
    assert.equal(await authenticate(token), 'other');
    await db.exec("UPDATE iam_principals SET active=false WHERE principal_id='other'");
    await assert.rejects(authenticate(token), unauthenticated);
    await db.exec(
      "UPDATE iam_principals SET active=true, kind='service' WHERE principal_id='other'",
    );
    await assert.rejects(authenticate(token), unauthenticated);
    await db.exec('DELETE FROM iam_sso_identity_bindings');
    await assert.rejects(authenticate(token), unauthenticated);
    const prior = queries.length;
    for (const invalidToken of [
      await jwt.token({ auth_time: undefined }),
      await jwt.token({ aud: 'urn:wrong' }),
      await jwt.token({ sub: 'missing' }),
    ])
      await assert.rejects(authenticate(invalidToken), unauthenticated);
    assert.equal(queries.length, prior + 1);
    assert.ok(
      queries.every(
        (sql) =>
          sql.includes('FROM iam_sso_identity_bindings') &&
          !/INSERT|UPDATE|DELETE|polic|audit|usage/u.test(sql),
      ),
    );
    assert.deepEqual((await db.query('SELECT count(*)::int AS count FROM iam_principals')).rows, [
      { count: 3 },
    ]);
    for (const table of [
      'proxy_credentials',
      'token_management_decisions',
      'proxy_credential_events',
      'gateway_audit_events',
      'usage_records',
    ])
      assert.deepEqual((await db.query(`SELECT count(*)::int AS count FROM ${table}`)).rows, [
        { count: 0 },
      ]);
  } finally {
    await db.close();
  }
});
