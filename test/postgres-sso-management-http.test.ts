import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { request as nodeRequest } from 'node:http';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import {
  type CredentialSqlClient,
  createPostgresProxyCredentialStore,
} from '../src/gateway/postgres-proxy-credentials.ts';
import {
  createPostgresRfc9068SsoManagementHandler,
  createPostgresRfc9068SsoManagementServer,
} from '../src/gateway/postgres-sso-management-http.ts';
import { createProxyTokenService } from '../src/gateway/proxy-tokens.ts';
import { createSsoManagementHandler } from '../src/gateway/sso-management-http.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
const now = jwt.config.now;
const day = 86400000;
type Config = Parameters<typeof createPostgresRfc9068SsoManagementHandler>[0];
const issuePath = '/management/v1/proxy-tokens';
const revokePath = `${issuePath}/revoke`;
function req(
  path = issuePath,
  body: unknown = { principalId: 'human-owner', expiresAt: now() + day },
  authorization = token,
) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${authorization}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
async function fixture() {
  const db = new PGlite();
  for (const name of [
    '002_proxy_credentials.sql',
    '003_gateway_audit.sql',
    '004_iam_snapshots.sql',
    '008_token_management_decisions.sql',
    '011_sso_identity_bindings.sql',
  ])
    await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  await db.exec(
    `INSERT INTO iam_principals VALUES ('human-admin','human',true),('human-owner','human',true),('service-owner','service',true); INSERT INTO iam_policies VALUES ('manage','v1','[{"effect":"Allow","actions":["iam:Manage"],"resources":["principal:*"]}]'); INSERT INTO iam_principal_policies VALUES ('human-admin','manage');`,
  );
  await db.query(
    'INSERT INTO iam_sso_identity_bindings (issuer, subject, principal_id) VALUES ($1,$2,$3)',
    [jwt.issuer, jwt.subject, 'human-admin'],
  );
  const sqls: string[] = [];
  const client: CredentialSqlClient = {
    query: (sql, params) => {
      sqls.push(sql);
      return db.query(sql, [...params]);
    },
  };
  let sequence = 0;
  const config: Config = { ...jwt.config, client, newRequestId: () => `server-${++sequence}` };
  const handler = createPostgresRfc9068SsoManagementHandler(config);
  const tokens = createProxyTokenService({
    store: createPostgresProxyCredentialStore(client),
    now,
  });
  const count = async (table: string) =>
    (await db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${table}`)).rows[0]
      ?.count;
  return { db, client, config, handler, tokens, sqls, count };
}
async function error(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, code);
  return body;
}

test('real JWT, migrated identity and Fetch boundary issue/revoke with current IAM and private audits', async () => {
  const f = await fixture();
  try {
    const response = await f.handler(req());
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-request-id'), 'server-1');
    const issued = (await response.json()) as { credentialId: string; token: string };
    assert.deepEqual(Object.keys(issued), ['credentialId', 'token']);
    assert.equal((await f.tokens.verifyCredential(issued.token))?.principalId, 'human-owner');
    assert.equal(
      (await f.handler(req(revokePath, { credentialId: issued.credentialId }))).status,
      200,
    );
    assert.equal(await f.tokens.verifyCredential(issued.token), undefined);
    const again = await f.handler(req(revokePath, { credentialId: issued.credentialId }));
    assert.deepEqual(await again.json(), { revoked: false });
    await error(await f.handler(req(revokePath, { credentialId: 'unknown' })), 403, 'forbidden');
    await f.db.exec(
      `UPDATE iam_policies SET version='v2', statements='[{"effect":"Deny","actions":["iam:Manage"],"resources":["*"]}]'`,
    );
    await error(
      await f.handler(req(revokePath, { credentialId: issued.credentialId })),
      403,
      'forbidden',
    );
    assert.deepEqual(
      (
        await f.db.query(
          'SELECT operation,outcome,actor_id,target_principal_id,policy_versions FROM token_management_decisions ORDER BY event_id',
        )
      ).rows,
      [
        {
          operation: 'issue',
          outcome: 'allowed',
          actor_id: 'human-admin',
          target_principal_id: 'human-owner',
          policy_versions: [{ id: 'manage', version: 'v1' }],
        },
        {
          operation: 'revoke',
          outcome: 'allowed',
          actor_id: 'human-admin',
          target_principal_id: 'human-owner',
          policy_versions: [{ id: 'manage', version: 'v1' }],
        },
        {
          operation: 'revoke',
          outcome: 'allowed',
          actor_id: 'human-admin',
          target_principal_id: 'human-owner',
          policy_versions: [{ id: 'manage', version: 'v1' }],
        },
        {
          operation: 'revoke',
          outcome: 'denied',
          actor_id: 'human-admin',
          target_principal_id: null,
          policy_versions: [{ id: 'manage', version: 'v1' }],
        },
        {
          operation: 'revoke',
          outcome: 'denied',
          actor_id: 'human-admin',
          target_principal_id: 'human-owner',
          policy_versions: [{ id: 'manage', version: 'v2' }],
        },
      ],
    );
    assert.equal(await f.count('proxy_credential_events'), 2);
    assert.equal(await f.count('gateway_audit_events'), 0);
    const audits =
      JSON.stringify((await f.db.query('SELECT * FROM proxy_credential_events')).rows) +
      JSON.stringify((await f.db.query('SELECT * FROM token_management_decisions')).rows);
    for (const secret of [token, issued.token, jwt.issuer, jwt.subject])
      assert.equal(audits.includes(secret), false);
  } finally {
    await f.db.close();
  }
});
for (const [owner, days] of [
  ['human-owner', 30],
  ['service-owner', 90],
] as const) {
  test(`public issuance enforces the persisted ${owner} cap as 400 after Allow audit`, async () => {
    const f = await fixture();
    try {
      const expiry = now() + days * day;
      assert.equal(
        (await f.handler(req(issuePath, { principalId: owner, expiresAt: expiry }))).status,
        201,
      );
      for (const expiresAt of [0, now() - 1, now(), expiry + 1])
        await error(
          await f.handler(req(issuePath, { principalId: owner, expiresAt })),
          400,
          'invalid_request',
        );
      assert.equal(await f.count('token_management_decisions'), 5);
      assert.equal(await f.count('proxy_credentials'), 1);
      assert.equal(await f.count('proxy_credential_events'), 1);
    } finally {
      await f.db.close();
    }
  });
}
for (const [label, claims] of [
  ['bad audience', { aud: 'urn:wrong' }],
  ['wrong issuer', { iss: 'https://wrong.example' }],
  ['client token', { auth_time: undefined }],
  ['expired', { exp: jwt.nowSeconds - 61 }],
] as const) {
  test(`public real JWT rejects ${label} with anonymous auth audit before body/IAM`, async () => {
    const f = await fixture();
    try {
      await error(
        await f.handler(req(issuePath, { private: 'body' }, await jwt.token(claims))),
        401,
        'unauthorized',
      );
      assert.equal(f.sqls.length, 1);
      assert.match(f.sqls[0] ?? '', /^INSERT INTO gateway_audit_events/u);
      assert.equal(await f.count('token_management_decisions'), 0);
      assert.deepEqual(
        (
          await f.db.query(
            'SELECT kind,request_id,principal_id,credential_id,policy_versions,details FROM gateway_audit_events',
          )
        ).rows,
        [
          {
            kind: 'management-auth-denied',
            request_id: 'server-1',
            principal_id: null,
            credential_id: null,
            policy_versions: null,
            details: { operation: 'issue' },
          },
        ],
      );
    } finally {
      await f.db.close();
    }
  });
}
for (const change of [
  'DELETE FROM iam_sso_identity_bindings',
  "UPDATE iam_principals SET active=false WHERE principal_id='human-admin'",
  "UPDATE iam_principals SET kind='service' WHERE principal_id='human-admin'",
]) {
  test(`next HTTP request observes binding/principal change: ${change}`, async () => {
    const f = await fixture();
    try {
      assert.equal((await f.handler(req())).status, 201);
      await f.db.exec(change);
      await error(
        await f.handler(req(revokePath, { credentialId: 'unknown' })),
        401,
        'unauthorized',
      );
      assert.equal(await f.count('token_management_decisions'), 1);
      assert.equal(await f.count('proxy_credentials'), 1);
      assert.deepEqual((await f.db.query('SELECT kind,details FROM gateway_audit_events')).rows, [
        { kind: 'management-auth-denied', details: { operation: 'revoke' } },
      ]);
    } finally {
      await f.db.close();
    }
  });
}
for (const statements of [
  '[]',
  '[{"effect":"Allow","actions":["iam:Manage"],"resources":["*"]},{"effect":"Deny","actions":["iam:Manage"],"resources":["*"]}]',
]) {
  test(`public current IAM Deny precedes expired validation: ${statements}`, async () => {
    const f = await fixture();
    try {
      await f.db.query('UPDATE iam_policies SET statements=$1::jsonb', [statements]);
      await error(
        await f.handler(req(issuePath, { principalId: 'human-owner', expiresAt: 0 })),
        403,
        'forbidden',
      );
      assert.equal(await f.count('proxy_credentials'), 0);
      assert.equal(
        f.sqls.some((s) => s.startsWith('SELECT principal_id, kind')),
        false,
      );
      assert.deepEqual((await f.db.query('SELECT outcome FROM token_management_decisions')).rows, [
        { outcome: 'denied' },
      ]);
    } finally {
      await f.db.close();
    }
  });
}
for (const stage of ['binding', 'policy', 'decision', 'owner', 'mutation', 'auth-audit'] as const) {
  test(`public safe database failure at ${stage} never reports success or leaks data`, async () => {
    const f = await fixture();
    try {
      const failed = (sql: string) =>
        stage === 'binding'
          ? sql.includes('iam_sso_identity_bindings')
          : stage === 'policy'
            ? sql.includes('iam_principal_roles')
            : stage === 'decision'
              ? sql.startsWith('INSERT INTO token_management_decisions')
              : stage === 'owner'
                ? sql.startsWith('SELECT principal_id, kind')
                : stage === 'mutation'
                  ? sql.startsWith('WITH inserted')
                  : sql.startsWith('INSERT INTO gateway_audit_events');
      const handler = createPostgresRfc9068SsoManagementHandler({
        ...f.config,
        client: {
          query: (sql, params) =>
            failed(sql)
              ? Promise.reject(Error('private-database-token-and-claims'))
              : f.client.query(sql, params),
        },
      });
      await error(
        await handler(
          req(
            issuePath,
            { principalId: 'human-owner', expiresAt: now() + day },
            stage === 'auth-audit' ? 'invalid' : token,
          ),
        ),
        503,
        stage === 'binding'
          ? 'authentication_unavailable'
          : stage === 'auth-audit'
            ? 'audit_unavailable'
            : 'internal_error',
      );
      assert.equal(await f.count('proxy_credentials'), 0);
      assert.equal(await f.count('proxy_credential_events'), 0);
      assert.equal(
        await f.count('token_management_decisions'),
        ['owner', 'mutation'].includes(stage) ? 1 : 0,
      );
      const audit = JSON.stringify((await f.db.query('SELECT * FROM gateway_audit_events')).rows);
      for (const privateValue of [jwt.issuer, jwt.subject, token, 'private-database'])
        assert.equal(audit.includes(privateValue), false);
    } finally {
      await f.db.close();
    }
  });
}
test('atomic lifecycle audit failure suppresses success and rolls back public issuance', async () => {
  const f = await fixture();
  try {
    await f.db.exec('DROP TABLE proxy_credential_events');
    await error(await f.handler(req()), 503, 'internal_error');
    assert.equal(await f.count('proxy_credentials'), 0);
    assert.equal(await f.count('token_management_decisions'), 1);
  } finally {
    await f.db.close();
  }
});
test('decision audit failure prevents revocation and leaves the token active', async () => {
  const f = await fixture();
  try {
    const response = await f.handler(req());
    const issued = (await response.json()) as { credentialId: string; token: string };
    await f.db.exec('DROP TABLE token_management_decisions');
    await error(
      await f.handler(req(revokePath, { credentialId: issued.credentialId })),
      503,
      'internal_error',
    );
    assert.ok(await f.tokens.verifyCredential(issued.token));
    assert.equal(await f.count('proxy_credential_events'), 1);
  } finally {
    await f.db.close();
  }
});
test('clock outage cannot become an invalid expiry or disclose the error; auth audit outage wins', async () => {
  const f = await fixture();
  try {
    const handler = createPostgresRfc9068SsoManagementHandler({
      ...f.config,
      now: () => {
        throw Error('private-clock');
      },
    });
    await error(await handler(req()), 503, 'audit_unavailable');
    assert.equal(await f.count('proxy_credentials'), 0);
    assert.equal(await f.count('gateway_audit_events'), 0);
  } finally {
    await f.db.close();
  }
});
test('management anonymous audit projection never stores body/claim/credential extras', async () => {
  const f = await fixture();
  try {
    const store = createPostgresGatewayAuditStore(f.client, now);
    const handler = createSsoManagementHandler({
      newRequestId: () => 'anonymous-request',
      authenticate: async () => {
        throw Error('private-claims');
      },
      issue: async () => {
        throw Error('unexpected mutation');
      },
      revoke: async () => {
        throw Error('unexpected mutation');
      },
      writeAudit: (event) =>
        store.append({
          ...event,
          issuer: jwt.issuer,
          subject: jwt.subject,
          token,
          body: 'private-body',
          principalId: 'forged',
          credentialId: 'forged',
          policyVersions: [],
        } as typeof event),
    });
    await error(await handler(req()), 503, 'authentication_unavailable');
    assert.deepEqual(
      (
        await f.db.query(
          'SELECT principal_id,credential_id,policy_versions,details FROM gateway_audit_events',
        )
      ).rows,
      [
        {
          principal_id: null,
          credential_id: null,
          policy_versions: null,
          details: { operation: 'issue' },
        },
      ],
    );
  } finally {
    await f.db.close();
  }
});
for (const patch of [
  { issuer: 'http://bad.example' },
  { audience: '' },
  { jwks: { keys: [] } },
  { newRequestId: undefined },
]) {
  test(`configured factory rejects invalid deployment configuration: ${JSON.stringify(patch)}`, () => {
    assert.throws(
      () =>
        createPostgresRfc9068SsoManagementHandler({
          ...jwt.config,
          client: { query: async () => ({ rows: [] }) },
          newRequestId: () => 'req',
          ...patch,
        } as Config),
      {
        name: 'InvalidSsoAccessTokenConfiguration',
        message: 'Invalid SSO access token configuration',
      },
    );
  });
}

test('configured unbound Node sockets enforce the same issue/revoke/errors and no-store', async () => {
  const f = await fixture();
  const server = createPostgresRfc9068SsoManagementServer(f.config);
  try {
    assert.equal(server.listening, false);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(base + issuePath, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ principalId: 'service-owner', expiresAt: now() + 90 * day }),
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const issued = (await response.json()) as { credentialId: string; token: string };
    const revoke = () =>
      fetch(base + revokePath, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ credentialId: issued.credentialId }),
      });
    assert.deepEqual(await (await revoke()).json(), { revoked: true });
    assert.deepEqual(await (await revoke()).json(), { revoked: false });
    await error(
      await fetch(base + issuePath, { method: 'POST', body: '{invalid' }),
      401,
      'unauthorized',
    );
    await error(
      await fetch(base + issuePath, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: '{invalid',
      }),
      400,
      'invalid_request',
    );
    const fallback = await new Promise<{
      status: number;
      headers: Record<string, unknown>;
      body: string;
    }>((resolve, reject) => {
      const request = nodeRequest(base + issuePath, { method: 'TRACE' }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      });
      request.on('error', reject);
      request.end();
    });
    assert.equal(fallback.status, 503);
    assert.equal(fallback.headers['cache-control'], 'no-store');
    assert.equal(JSON.parse(fallback.body).error.code, 'internal_error');
    assert.equal(fallback.body.includes('token'), false);
    assert.equal(await f.tokens.verifyCredential(issued.token), undefined);
    assert.equal(await f.count('proxy_credential_events'), 2);
  } finally {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    await f.db.close();
  }
});

for (const value of [
  null,
  [],
  {},
  Object.create({
    ...jwt.config,
    client: { query: async () => ({ rows: [] }) },
    newRequestId: () => 'id',
  }),
  { ...jwt.config, newRequestId: () => 'id', client: null },
  { ...jwt.config, newRequestId: () => 'id', client: 3 },
  { ...jwt.config, newRequestId: () => 'id', client: {} },
  {
    ...jwt.config,
    newRequestId: () => 'id',
    get client() {
      throw Error('private-client');
    },
  },
]) {
  test('configured public factory rejects malformed own settings without dependency work', () => {
    assert.throws(() => createPostgresRfc9068SsoManagementHandler(value as Config), {
      name: 'InvalidSsoAccessTokenConfiguration',
      message: 'Invalid SSO access token configuration',
    });
  });
}
test('configured public factory snapshots all settings once, including admin keys and callbacks', async () => {
  const f = await fixture();
  try {
    const reads: Record<string, number> = {};
    const source = Object.defineProperties(
      {},
      Object.fromEntries(
        Object.entries(f.config).map(([key, value]) => [
          key,
          {
            get() {
              reads[key] = (reads[key] ?? 0) + 1;
              return value;
            },
            enumerable: true,
          },
        ]),
      ),
    ) as Config;
    const handler = createPostgresRfc9068SsoManagementHandler(source);
    assert.equal((await handler(req())).status, 201);
    assert.deepEqual(reads, Object.fromEntries(Object.keys(f.config).map((key) => [key, 1])));
  } finally {
    await f.db.close();
  }
});
