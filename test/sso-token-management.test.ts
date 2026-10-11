import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresProxyCredentialStore } from '../src/gateway/postgres-proxy-credentials.ts';
import {
  createPostgresRfc9068SsoTokenManagementService,
  createPostgresSsoTokenManagementService,
} from '../src/gateway/postgres-sso-token-management-service.ts';
import { createProxyTokenService } from '../src/gateway/proxy-tokens.ts';
import { createRfc9068SsoAccessTokenVerifier } from '../src/identity/rfc9068-sso-access-tokens.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const accessToken = await jwt.token();
const issue = {
  accessToken,
  requestId: 'issue',
  principalId: 'target-service',
  expiresAt: jwt.nowSeconds * 1000 + 10000,
};
type Service = ReturnType<typeof createPostgresSsoTokenManagementService>;
type Verifier = Parameters<typeof createPostgresSsoTokenManagementService>[0]['verifyAccessToken'];
const identity = { issuer: jwt.issuer, subject: jwt.subject };
function fixed(name: string, message: string) {
  return (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, name);
    assert.equal(error.message, message);
    assert.equal(error.cause, undefined);
    assert.deepEqual(Object.keys(error), ['name']);
    return true;
  };
}
const invalid = fixed('InvalidSsoTokenManagementInput', 'Invalid SSO token management input');
const unauthenticated = fixed('SsoManagementUnauthenticated', 'SSO management unauthenticated');
const unavailable = fixed(
  'SsoManagementAuthenticationUnavailable',
  'SSO management authentication unavailable',
);
const denied = fixed('TokenManagementDenied', 'Token management denied');
const managementUnavailable = fixed('TokenManagementUnavailable', 'Token management unavailable');

function call(service: Service, operation: 'issue' | 'revoke', value: unknown) {
  return operation === 'issue'
    ? service.issue(value as Parameters<Service['issue']>[0])
    : service.revoke(value as Parameters<Service['revoke']>[0]);
}
function inputFor(operation: 'issue' | 'revoke') {
  return operation === 'issue'
    ? { ...issue }
    : { accessToken, requestId: 'revoke', credentialId: 'credential' };
}

for (const operation of ['issue', 'revoke'] as const) {
  const raw = inputFor(operation);
  for (const [name, value] of [
    ['null', null],
    ['array', []],
    ['inherited required fields', Object.create(raw)],
    ['missing access token', { ...raw, accessToken: undefined }],
    ['empty token', { ...raw, accessToken: '' }],
    ['oversized token', { ...raw, accessToken: 'x'.repeat(16385) }],
    ['NUL token', { ...raw, accessToken: 'x\0y' }],
    ['surrogate token', { ...raw, accessToken: '\ud800' }],
    ['numeric token', { ...raw, accessToken: 1 }],
    ['empty request ID', { ...raw, requestId: '' }],
    ['oversized request ID', { ...raw, requestId: 'x'.repeat(257) }],
    ['NUL request ID', { ...raw, requestId: 'x\0y' }],
    ['surrogate request ID', { ...raw, requestId: '\udfff' }],
    [
      'throwing input',
      {
        ...raw,
        get requestId() {
          throw Error('private request fixture');
        },
      },
    ],
    ...(operation === 'issue'
      ? [
          ['missing principal', { ...raw, principalId: undefined }],
          ['oversized principal', { ...raw, principalId: 'x'.repeat(257) }],
          ['NUL principal', { ...raw, principalId: 'x\0y' }],
          ['negative expiry', { ...raw, expiresAt: -1 }],
          ['fractional expiry', { ...raw, expiresAt: 1.5 }],
          ['unsafe expiry', { ...raw, expiresAt: Number.MAX_SAFE_INTEGER + 1 }],
        ]
      : [
          ['missing credential', { ...raw, credentialId: undefined }],
          ['empty credential', { ...raw, credentialId: '' }],
          ['oversized credential', { ...raw, credentialId: 'x'.repeat(257) }],
          ['NUL credential', { ...raw, credentialId: 'x\0y' }],
        ]),
  ] as const) {
    test(`${operation} invalid input before verification or SQL: ${name}`, async () => {
      let queries = 0;
      let verifies = 0;
      const service = createPostgresSsoTokenManagementService({
        now: jwt.config.now,
        client: {
          query: async () => {
            queries++;
            return { rows: [] };
          },
        },
        verifyAccessToken: async () => {
          verifies++;
          return identity;
        },
      });
      await assert.rejects(call(service, operation, value), invalid);
      assert.equal(queries, 0);
      assert.equal(verifies, 0);
    });
  }
  for (const [name, verify, expected] of [
    ['verifier rejects', async () => undefined, unauthenticated],
    [
      'verifier throws',
      async () => {
        throw Error('private token/claim fixture');
      },
      unavailable,
    ],
    [
      'verifier throws spoofed domain error',
      async () => {
        const error = Error('private token fixture');
        error.name = 'SsoManagementUnauthenticated';
        throw error;
      },
      unavailable,
    ],
    ['null verified claims', async () => null, unavailable],
    ['forged principal instead of claims', async () => ({ principalId: 'admin' }), unavailable],
    ['inherited verified claims', async () => Object.create(identity), unavailable],
    ['invalid verified issuer', async () => ({ ...identity, issuer: '' }), unavailable],
    [
      'claim getter throws',
      async () => ({
        ...identity,
        get subject() {
          throw Error('private subject fixture');
        },
      }),
      unavailable,
    ],
  ] as const) {
    test(`${operation} rejects ${name} before binding or management`, async () => {
      let queries = 0;
      const service = createPostgresSsoTokenManagementService({
        now: jwt.config.now,
        client: {
          query: async () => {
            queries++;
            return { rows: [] };
          },
        },
        verifyAccessToken: verify as Verifier,
      });
      await assert.rejects(
        call(service, operation, {
          ...raw,
          authenticatedActorId: 'admin',
          actor: { active: true },
        }),
        expected,
      );
      assert.equal(queries, 0);
    });
  }
  for (const [name, rows, expected] of [
    ['missing binding', [], unauthenticated],
    [
      'inactive human',
      [{ ...identity, principal_id: 'admin', kind: 'human', active: false }],
      unauthenticated,
    ],
    [
      'service',
      [{ ...identity, principal_id: 'worker', kind: 'service', active: true }],
      unauthenticated,
    ],
    [
      'mismatched binding',
      [
        {
          ...identity,
          issuer: 'https://other.example',
          principal_id: 'admin',
          kind: 'human',
          active: true,
        },
      ],
      unavailable,
    ],
    [
      'duplicate binding',
      [
        { ...identity, principal_id: 'admin', kind: 'human', active: true },
        { ...identity, principal_id: 'other', kind: 'human', active: true },
      ],
      unavailable,
    ],
  ] as const) {
    test(`${operation} denies ${name} before management`, async () => {
      let queries = 0;
      const service = createPostgresSsoTokenManagementService({
        now: jwt.config.now,
        verifyAccessToken: async () => identity,
        client: {
          query: async (sql, params) => {
            queries++;
            assert.match(sql, /JOIN iam_principals/u);
            assert.deepEqual(params, [identity.issuer, identity.subject]);
            assert.ok(Object.isFrozen(params));
            return { rows };
          },
        },
      });
      await assert.rejects(
        call(service, operation, {
          ...raw,
          authenticatedActorId: 'admin',
          active: true,
          kind: 'human',
        }),
        expected,
      );
      assert.equal(queries, 1);
    });
  }
}

async function fixture() {
  const db = new PGlite();
  for (const migration of await loadPostgresMigrationSources()) await db.exec(migration.sql);
  await db.exec(`
    INSERT INTO iam_principals VALUES ('human-admin','human',true),('other-human','human',true),('worker','service',true),('inactive','human',false),('target-service','service',true),('target-human','human',true);
    INSERT INTO iam_roles VALUES ('managers');
    INSERT INTO iam_principal_roles VALUES ('human-admin','managers');
    INSERT INTO iam_policies VALUES ('manage','v1','[{"effect":"Allow","actions":["iam:Manage"],"resources":["principal:target-service","principal:target-human"]}]');
    INSERT INTO iam_role_policies VALUES ('managers','manage');
  `);
  for (const [subject, principal] of [
    [jwt.subject, 'human-admin'],
    ['other', 'other-human'],
    ['worker', 'worker'],
    ['inactive', 'inactive'],
  ])
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      subject,
      principal,
    ]);
  const queries: string[] = [];
  const client = {
    query: (sql: string, params: readonly unknown[]) => {
      queries.push(sql);
      return db.query(sql, [...params]);
    },
  };
  const service = createPostgresRfc9068SsoTokenManagementService({ ...jwt.config, client });
  const tokens = createProxyTokenService({
    store: createPostgresProxyCredentialStore(client),
    now: jwt.config.now,
  });
  const injected = (verifyAccessToken: Verifier, query = client.query) =>
    createPostgresSsoTokenManagementService({
      now: jwt.config.now,
      verifyAccessToken,
      client: { query },
    });
  const counts = async () =>
    (
      await db.query<{ credentials: number; decisions: number; lifecycle: number }>(
        'SELECT (SELECT count(*)::int FROM proxy_credentials) AS credentials, (SELECT count(*)::int FROM token_management_decisions) AS decisions, (SELECT count(*)::int FROM proxy_credential_events) AS lifecycle',
      )
    ).rows[0];
  const records = async () => ({
    decisions: (await db.query('SELECT * FROM token_management_decisions ORDER BY event_id')).rows,
    lifecycle: (await db.query('SELECT * FROM proxy_credential_events ORDER BY event_id')).rows,
  });
  return { db, client, queries, service, tokens, injected, counts, records };
}

test('configured signed SSO human issues/revokes through current persisted IAM and private lifecycle/audit', async () => {
  const f = await fixture();
  try {
    const result = await f.service.issue({
      ...issue,
      authenticatedActorId: 'worker',
      actor: { statements: [] },
      owner: 'other-human',
    } as Parameters<Service['issue']>[0]);
    assert.equal((await f.tokens.verifyCredential(result.token))?.principalId, 'target-service');
    assert.match(f.queries[0] ?? '', /JOIN iam_principals/u);
    assert.ok(
      f.queries.findIndex((sql) => sql.includes('INSERT INTO token_management_decisions')) <
        f.queries.findIndex((sql) => sql.includes('WITH inserted AS')),
    );
    assert.equal(
      await f.service.revoke({
        accessToken,
        requestId: 'revoke',
        credentialId: result.credentialId,
        principalId: 'other-human',
      } as Parameters<Service['revoke']>[0]),
      true,
    );
    assert.equal(await f.tokens.verifyCredential(result.token), undefined);
    const state = await f.records();
    assert.deepEqual(
      state.decisions
        .map((row) => ({ ...(row as Record<string, unknown>) }))
        .map((row) => [row.actor_id, row.target_principal_id, row.outcome]),
      [
        ['human-admin', 'target-service', 'allowed'],
        ['human-admin', 'target-service', 'allowed'],
      ],
    );
    const serialized = JSON.stringify(state);
    for (const privateValue of [accessToken, jwt.issuer, jwt.subject, result.token])
      assert.ok(!serialized.includes(privateValue));
    assert.deepEqual(await f.counts(), { credentials: 1, decisions: 2, lifecycle: 2 });
  } finally {
    await f.db.close();
  }
});

test('configured verifier denial, unmapped/inactive/service identities and proxy tokens stop before management', async () => {
  const f = await fixture();
  try {
    const proxy = await f.tokens.issue({
      principalId: 'target-service',
      actorId: 'bootstrap',
      requestId: 'bootstrap',
      expiresAt: issue.expiresAt,
    });
    const baseline = await f.counts();
    for (const token of [
      await jwt.token({ auth_time: undefined }),
      await jwt.token({ sub: 'missing' }),
      await jwt.token({ sub: 'inactive' }),
      await jwt.token({ sub: 'worker' }),
      await jwt.token({ aud: 'urn:other' }),
      proxy.token,
    ]) {
      const start = f.queries.length;
      await assert.rejects(
        f.service.issue({
          ...issue,
          accessToken: token,
          authenticatedActorId: 'human-admin',
        } as Parameters<Service['issue']>[0]),
        unauthenticated,
      );
      assert.ok(f.queries.slice(start).every((sql) => sql.includes('JOIN iam_principals')));
      assert.deepEqual(await f.counts(), baseline);
    }
    assert.deepEqual((await f.db.query('SELECT count(*)::int AS count FROM iam_principals')).rows, [
      { count: 6 },
    ]);
  } finally {
    await f.db.close();
  }
});

test('fresh binding and policy state retains implicit/explicit Deny despite forged request authority', async () => {
  const f = await fixture();
  try {
    const request = {
      ...issue,
      statements: [{ effect: 'Allow', actions: ['*'], resources: ['*'] }],
      authenticatedActorId: 'human-admin',
    };
    await assert.rejects(
      f.service.issue({ ...request, accessToken: await jwt.token({ sub: 'other' }) }),
      denied,
    );
    await f.db.exec(
      'INSERT INTO iam_policies VALUES (\'direct-deny\',\'d1\',\'[{"effect":"Deny","actions":["iam:Manage"],"resources":["*"]}]\'); INSERT INTO iam_principal_policies VALUES (\'human-admin\',\'direct-deny\')',
    );
    await assert.rejects(f.service.issue(request), denied);
    await f.db.exec('DELETE FROM iam_principal_policies; DELETE FROM iam_principal_roles');
    await assert.rejects(f.service.issue(request), denied);
    await f.db.exec(
      "INSERT INTO iam_principal_roles VALUES ('human-admin','managers'); UPDATE iam_policies SET version='v2' WHERE policy_id='manage'",
    );
    const issued = await f.service.issue(request);
    await f.db.query(
      'UPDATE iam_sso_identity_bindings SET principal_id=$3 WHERE issuer=$1 AND subject=$2',
      [jwt.issuer, jwt.subject, 'other-human'],
    );
    await assert.rejects(
      f.service.revoke({
        accessToken,
        requestId: 'changed-binding',
        credentialId: issued.credentialId,
      }),
      denied,
    );
    await f.db.query(
      'UPDATE iam_sso_identity_bindings SET principal_id=$3 WHERE issuer=$1 AND subject=$2',
      [jwt.issuer, jwt.subject, 'human-admin'],
    );
    await f.db.exec("UPDATE iam_principals SET active=false WHERE principal_id='human-admin'");
    const baseline = await f.counts();
    await assert.rejects(
      f.service.revoke({ accessToken, requestId: 'inactive', credentialId: issued.credentialId }),
      unauthenticated,
    );
    assert.deepEqual(await f.counts(), baseline);
    await f.db.exec("UPDATE iam_principals SET active=true WHERE principal_id='human-admin'");
    assert.equal(
      await f.service.revoke({
        accessToken,
        requestId: 'reactivated',
        credentialId: issued.credentialId,
      }),
      true,
    );
    assert.ok(JSON.stringify((await f.records()).decisions).includes('v2'));
  } finally {
    await f.db.close();
  }
});

for (const operation of ['issue', 'revoke'] as const) {
  for (const stage of ['binding', 'policy', 'audit', 'owner', 'mutation'] as const) {
    test(`${operation} ${stage} dependency failure blocks credential/lifecycle changes privately`, async () => {
      const f = await fixture();
      try {
        const existing =
          operation === 'revoke'
            ? await f.tokens.issue({
                principalId: 'target-service',
                actorId: 'bootstrap',
                requestId: 'bootstrap',
                expiresAt: issue.expiresAt,
              })
            : undefined;
        const baseline = await f.counts();
        assert.ok(baseline);
        const service = f.injected(
          createRfc9068SsoAccessTokenVerifier(jwt.config),
          async (sql, params) => {
            if (
              (stage === 'binding' && sql.includes('JOIN iam_principals')) ||
              (stage === 'policy' && sql.includes('jsonb_build_object')) ||
              (stage === 'audit' && sql.includes('INSERT INTO token_management_decisions')) ||
              (stage === 'owner' &&
                (sql.includes('SELECT principal_id, kind FROM iam_principals') ||
                  sql.includes('SELECT principal_id FROM proxy_credentials'))) ||
              (stage === 'mutation' &&
                (sql.includes('WITH inserted AS') || sql.includes('WITH changed AS')))
            )
              throw Error('private SQL/access-token fixture');
            return f.client.query(sql, params);
          },
        );
        const input =
          operation === 'issue'
            ? issue
            : { accessToken, requestId: 'revoke', credentialId: existing?.credentialId };
        await assert.rejects(
          call(service, operation, input),
          stage === 'binding' ? unavailable : managementUnavailable,
        );
        const after = await f.counts();
        assert.ok(after);
        assert.equal(after.credentials, baseline.credentials);
        assert.equal(after.lifecycle, baseline.lifecycle);
        assert.equal(
          after.decisions - baseline.decisions,
          stage === 'mutation' || (stage === 'owner' && operation === 'issue') ? 1 : 0,
        );
        if (existing) assert.ok(await f.tokens.verifyCredential(existing.token));
      } finally {
        await f.db.close();
      }
    });
  }
}

test('configured composition preserves exact human/service proxy-token lifetime caps', async () => {
  const f = await fixture();
  try {
    for (const [principalId, days] of [
      ['target-human', 30],
      ['target-service', 90],
    ] as const) {
      const expiresAt = jwt.config.now() + days * 86_400_000;
      assert.ok((await f.service.issue({ ...issue, principalId, expiresAt })).token);
      await assert.rejects(
        f.service.issue({ ...issue, principalId, expiresAt: expiresAt + 1 }),
        fixed('InvalidTokenManagementLifetime', 'Invalid token management lifetime'),
      );
    }
    assert.deepEqual(await f.counts(), { credentials: 2, decisions: 4, lifecycle: 2 });
  } finally {
    await f.db.close();
  }
});

test('issue captures own request/verified getters once and prevents mutations across verifier and SQL awaits', async () => {
  const f = await fixture();
  try {
    const source: Record<string, unknown> = { ...issue };
    const counts = new Map<string, number>();
    const input = {};
    for (const name of Object.keys(issue))
      Object.defineProperty(input, name, {
        get() {
          counts.set(name, (counts.get(name) ?? 0) + 1);
          assert.equal(counts.get(name), 1);
          return source[name];
        },
      });
    Object.defineProperty(input, 'authenticatedActorId', {
      get() {
        throw Error('Forged extra getter must remain unread');
      },
    });
    let issuer = jwt.issuer;
    let subject = jwt.subject;
    let issuerReads = 0;
    let subjectReads = 0;
    const verified = {
      get issuer() {
        assert.equal(++issuerReads, 1);
        return issuer;
      },
      get subject() {
        assert.equal(++subjectReads, 1);
        return subject;
      },
      get role() {
        throw Error('Extra verified field');
      },
    };
    const service = f.injected(
      async (token) => {
        assert.equal(token, accessToken);
        Object.assign(source, {
          accessToken: 'invalid',
          principalId: 'target-human',
          requestId: 'mutated',
          expiresAt: 1,
        });
        await Promise.resolve();
        return verified;
      },
      async (sql, params) => {
        if (sql.includes('JOIN iam_principals')) {
          issuer = 'https://other.example';
          subject = 'worker';
          assert.deepEqual(params, [jwt.issuer, jwt.subject]);
          assert.ok(Object.isFrozen(params));
        }
        return f.client.query(sql, params);
      },
    );
    const result = await service.issue(input as Parameters<Service['issue']>[0]);
    assert.equal((await f.tokens.verifyCredential(result.token))?.principalId, 'target-service');
    assert.equal(counts.size, 4);
    assert.equal(issuerReads, 1);
    assert.equal(subjectReads, 1);
    assert.equal(((await f.records()).decisions[0] as Record<string, unknown>).request_id, 'issue');
  } finally {
    await f.db.close();
  }
});

test('revoke snapshots its credential and ignores caller owner/actor mutations during verification', async () => {
  const f = await fixture();
  try {
    const existing = await f.service.issue(issue);
    const source = { accessToken, requestId: 'captured', credentialId: existing.credentialId };
    const service = f.injected(async (token) => {
      assert.equal(token, accessToken);
      source.credentialId = 'missing';
      source.requestId = 'mutated';
      await Promise.resolve();
      return identity;
    });
    assert.equal(
      await service.revoke({
        get accessToken() {
          return source.accessToken;
        },
        get requestId() {
          return source.requestId;
        },
        get credentialId() {
          return source.credentialId;
        },
        principalId: 'other-human',
        authenticatedActorId: 'worker',
      } as Parameters<Service['revoke']>[0]),
      true,
    );
    assert.equal(await f.tokens.verifyCredential(existing.token), undefined);
    assert.equal(
      ((await f.records()).decisions.at(-1) as Record<string, unknown>).request_id,
      'captured',
    );
  } finally {
    await f.db.close();
  }
});

const configuredPorts = {
  ...jwt.config,
  client: { query: async () => ({ rows: [] }) },
};
for (const [name, value] of [
  ['null', null],
  ['array', []],
  ['inherited configuration', Object.create(configuredPorts)],
  ...['issuer', 'audience', 'jwks', 'now', 'client'].map((field) => [
    `throwing ${field}`,
    Object.defineProperty({ ...configuredPorts }, field, {
      get() {
        throw Error('private administrator configuration');
      },
    }),
  ]),
] as const) {
  test(`configured management factory rejects ${name} without exposing settings`, () => {
    assert.throws(
      () =>
        createPostgresRfc9068SsoTokenManagementService(
          value as Parameters<typeof createPostgresRfc9068SsoTokenManagementService>[0],
        ),
      fixed('InvalidSsoAccessTokenConfiguration', 'Invalid SSO access token configuration'),
    );
  });
}
test('configured management factory captures own settings once without reading extra authority', async () => {
  const counts = new Map<string, number>();
  const source = {};
  for (const [field, value] of Object.entries(configuredPorts)) {
    Object.defineProperty(source, field, {
      get() {
        counts.set(field, (counts.get(field) ?? 0) + 1);
        assert.equal(counts.get(field), 1);
        return value;
      },
    });
  }
  Object.defineProperty(source, 'authenticatedActorId', {
    get() {
      throw Error('Caller authority must not be read');
    },
  });
  const service = createPostgresRfc9068SsoTokenManagementService(
    source as Parameters<typeof createPostgresRfc9068SsoTokenManagementService>[0],
  );
  await assert.rejects(service.issue(issue), unauthenticated);
  assert.equal(counts.size, 5);
});
