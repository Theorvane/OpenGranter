import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  createPostgresSsoReadApiHandler,
  createPostgresSsoReadApiServer,
} from '../src/gateway/postgres-sso-read-api.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

async function fixture() {
  const jwt = await createSsoAccessTokenFixture();
  const db = new PGlite();
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
  await db.exec(`
      INSERT INTO iam_principals VALUES ('human', 'human', true);
      INSERT INTO iam_policies VALUES ('allow', 'v1',
        '[{"effect":"Allow","actions":["llm:InvokeModel","llm:UseProvider"],"resources":["model:*","provider:openai"]}]');
      INSERT INTO iam_roles VALUES ('reader');
      INSERT INTO iam_principal_roles VALUES ('human', 'reader');
      INSERT INTO iam_role_policies VALUES ('reader', 'allow');
      INSERT INTO catalog_models (alias, created_at_seconds, enabled) VALUES ('team/chat', 42, true);
      INSERT INTO catalog_routes (route_id, alias, kind, version, credential_ref, candidates) VALUES
        ('direct', 'team/chat', 'managed', 'v1', NULL,
         '[{"id":"one","kind":"managed","providerId":"openai","upstreamModelId":"private-secret"}]');
      UPDATE catalog_models SET active_route_id = 'direct' WHERE alias = 'team/chat';
    `);
  await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1, $2, $3)', [
    jwt.issuer,
    jwt.subject,
    'human',
  ]);
  await db.exec(
    await readFile(
      new URL('../contracts/sql/current-principal-audit.sql', import.meta.url),
      'utf8',
    ),
  );
  let sequence = 0;
  const ports = {
    ...jwt.config,
    client: { query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]) },
    principalAuditClient: {
      query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]),
    },
    newRequestId: () => `composed-${++sequence}`,
  };
  const token = await jwt.token();
  const request = (suffix = '', authenticated = true) =>
    new Request(`http://localhost/management/v1/models${suffix}`, {
      headers: {
        ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
        'x-request-id': 'client-forged',
      },
    });
  return { db, ports, request, token, jwt };
}

async function safe(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const text = await response.text();
  assert.doesNotMatch(text, /private-secret|client-forged|Bearer|SELECT|INSERT/u);
  return JSON.parse(text);
}

test('one unbound listener exposes fresh principal and independently authorized model reads', async () => {
  const f = await fixture();
  const server = createPostgresSsoReadApiServer(f.ports);
  try {
    assert.equal(server.listening, false);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const get = (path: string, value = f.token) =>
      fetch(`http://127.0.0.1:${address.port}/management/v1/${path}`, {
        headers: { authorization: `Bearer ${value}` },
        redirect: 'error',
      });
    assert.deepEqual(await safe(await get('principal'), 200), { id: 'human', kind: 'human' });
    const model = { id: 'team/chat', object: 'model', created: 42, owned_by: 'opengranter' };
    assert.deepEqual(await safe(await get('models'), 200), { object: 'list', data: [model] });
    assert.deepEqual(await safe(await get('models/team%2Fchat'), 200), model);
    await f.db.exec(
      `UPDATE iam_policies SET version = 'v2', statements = '[{"effect":"Deny","actions":["llm:InvokeModel"],"resources":["model:*"]}]' WHERE policy_id = 'allow'`,
    );
    assert.deepEqual(await safe(await get('principal'), 200), { id: 'human', kind: 'human' });
    assert.deepEqual(await safe(await get('models'), 200), { object: 'list', data: [] });
    await safe(await get('models/team%2Fchat'), 404);
    await f.db.exec('DELETE FROM iam_sso_identity_bindings');
    await safe(await get('principal'), 401);
    await safe(await get('models'), 401);
    const identity = (
      await f.db.query(
        'SELECT outcome,principal_id FROM sso_current_principal_audit_events ORDER BY event_id',
      )
    ).rows;
    assert.deepEqual(identity, [
      { outcome: 'ready', principal_id: 'human' },
      { outcome: 'ready', principal_id: 'human' },
      { outcome: 'unauthenticated', principal_id: null },
    ]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.db.close();
  }
});

test('unknown paths and methods perform zero private work and never fall through to writes', async () => {
  let calls = 0;
  const jwt = await createSsoAccessTokenFixture();
  const query = async () => {
    calls++;
    throw new Error('private database');
  };
  const handler = createPostgresSsoReadApiHandler({
    ...jwt.config,
    client: { query },
    principalAuditClient: { query },
    newRequestId: () => {
      calls++;
      return 'unused';
    },
  });
  for (const path of [
    'me/',
    'me-other',
    'me/child',
    'principal/',
    'principals',
    'models-other',
    'proxy-tokens',
    '../v1/chat/completions',
  ])
    await safe(await handler(new Request(`http://localhost/management/v1/${path}`)), 404);
  for (const method of ['POST', 'DELETE', 'OPTIONS', 'HEAD'])
    for (const path of ['me', 'principal', 'models', 'models/team%2Fchat'])
      await safe(
        await handler(new Request(`http://localhost/management/v1/${path}`, { method })),
        404,
      );
  assert.equal(calls, 0);
});

test('malformed selected reads fail before SQL, identity lookup and authentication', async () => {
  let calls = 0;
  const jwt = await createSsoAccessTokenFixture();
  const query = async () => {
    calls++;
    throw new Error('private database');
  };
  const handler = createPostgresSsoReadApiHandler({
    ...jwt.config,
    client: { query },
    principalAuditClient: { query },
    newRequestId: () => 'valid-id',
  });
  for (const path of ['me?x=1', 'principal?x=1', 'models?x=1', 'models/%ZZ', 'models/team/chat'])
    await safe(await handler(new Request(`http://localhost/management/v1/${path}`)), 400);
  for (const path of ['me', 'principal', 'models', 'models/team%2Fchat']) {
    const controller = new AbortController();
    controller.abort();
    await safe(
      await handler(
        new Request(`http://localhost/management/v1/${path}`, { signal: controller.signal }),
      ),
      400,
    );
  }
  assert.equal(calls, 0);
});

test('both reads reject absent and expired credentials with independent durable anonymous audit', async () => {
  const f = await fixture();
  try {
    const handler = createPostgresSsoReadApiHandler(f.ports);
    const expired = await f.jwt.token({
      auth_time: f.jwt.nowSeconds - 700,
      iat: f.jwt.nowSeconds - 600,
      exp: f.jwt.nowSeconds - 300,
    });
    for (const path of ['me', 'principal', 'models', 'models/team%2Fchat']) {
      for (const authorization of ['', `Bearer ${expired}`]) {
        const response = await handler(
          new Request(`http://localhost/management/v1/${path}`, { headers: { authorization } }),
        );
        assert.equal(response.status, 401, path);
        assert.equal(response.headers.get('www-authenticate'), 'Bearer');
        await safe(response, 401);
      }
    }
    assert.equal(
      (await f.db.query('SELECT * FROM sso_current_principal_audit_events')).rows.length,
      4,
    );
    assert.equal((await f.db.query('SELECT * FROM sso_catalog_audit_events')).rows.length, 4);
    const audit = JSON.stringify(
      (await f.db.query('SELECT * FROM sso_current_principal_audit_events')).rows,
    );
    for (const secret of [expired, f.jwt.issuer, f.jwt.subject, 'human'])
      assert.equal(audit.includes(secret), false);
  } finally {
    await f.db.close();
  }
});

test('each required audit failure suppresses its own read, without turning identity into catalog authority', async () => {
  const f = await fixture();
  try {
    const handler = createPostgresSsoReadApiHandler(f.ports);
    await f.db.exec('DROP TABLE sso_current_principal_audit_events');
    const principal = await handler(
      new Request('http://localhost/management/v1/principal', {
        headers: { authorization: `Bearer ${f.token}` },
      }),
    );
    const body = await safe(principal, 503);
    assert.equal(JSON.stringify(body).includes('audit_unavailable'), true);
    assert.equal(JSON.stringify(body).includes('human'), false);
    await safe(await handler(f.request()), 200);
    await f.db.exec('DROP TABLE sso_catalog_audit_events');
    for (const suffix of ['', '/team%2Fchat']) {
      const failed = await safe(await handler(f.request(suffix)), 503);
      assert.equal(JSON.stringify(failed).includes('audit_unavailable'), true);
      assert.equal(JSON.stringify(failed).includes('team/chat'), false);
    }
  } finally {
    await f.db.close();
  }
});

test('captures configuration and ignores untrusted authenticator, verifier, catalog and callback overrides', async () => {
  const f = await fixture();
  try {
    let overrides = 0;
    const override = () => {
      overrides++;
      throw new Error('untrusted override');
    };
    const supplied = {
      ...f.ports,
      authenticate: override,
      verifyAccessToken: override,
      writeAudit: override,
      catalog: { list: override, detail: override },
    };
    const handler = createPostgresSsoReadApiHandler(supplied);
    supplied.client = { query: override };
    supplied.principalAuditClient = { query: override };
    supplied.newRequestId = override;
    supplied.now = override;
    supplied.issuer = 'https://changed.invalid';
    const response = await handler(
      new Request('http://localhost/management/v1/principal', {
        headers: { authorization: `Bearer ${f.token}`, 'x-principal-id': 'forged' },
      }),
    );
    assert.deepEqual(await safe(response, 200), { id: 'human', kind: 'human' });
    await safe(await handler(f.request()), 200);
    await safe(await handler(f.request('', false)), 401);
    assert.equal(overrides, 0);
  } finally {
    await f.db.close();
  }
});

test('rejects inherited and absent required configuration rather than implicit audit wiring', async () => {
  const jwt = await createSsoAccessTokenFixture();
  const client = { query: async () => ({ rows: [] }) };
  const configuration = {
    ...jwt.config,
    client,
    principalAuditClient: client,
    newRequestId: () => 'valid-id',
  };
  for (const key of Object.keys(configuration)) {
    const partial: Record<string, unknown> = { ...configuration };
    delete partial[key];
    assert.throws(() =>
      createPostgresSsoReadApiHandler(
        partial as unknown as Parameters<typeof createPostgresSsoReadApiHandler>[0],
      ),
    );
    assert.throws(() =>
      createPostgresSsoReadApiHandler(Object.assign(Object.create(configuration), partial)),
    );
  }
  assert.throws(() =>
    createPostgresSsoReadApiHandler({
      ...configuration,
      principalAuditClient: undefined,
    } as unknown as Parameters<typeof createPostgresSsoReadApiHandler>[0]),
  );
});

test('configuration getters cannot leak private startup diagnostics', async () => {
  const jwt = await createSsoAccessTokenFixture();
  const client = { query: async () => ({ rows: [] }) };
  for (const key of [
    'client',
    'principalAuditClient',
    'newRequestId',
    'now',
    'issuer',
    'audience',
    'jwks',
  ]) {
    const ports = {
      ...jwt.config,
      client,
      principalAuditClient: client,
      newRequestId: () => 'valid-id',
    };
    Object.defineProperty(ports, key, {
      get() {
        throw new Error('private startup diagnostic');
      },
    });
    assert.throws(() => createPostgresSsoReadApiHandler(ports), {
      name: 'InvalidSsoAccessTokenConfiguration',
      message: 'Invalid SSO access token configuration',
    });
  }
});

test('Account me contract uses the same fresh SQL-audited identity without granting catalog access', async () => {
  const f = await fixture();
  const server = createPostgresSsoReadApiServer(f.ports);
  try {
    await f.db.exec('DELETE FROM iam_principal_roles');
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const get = (path: string, token = f.token) =>
      fetch(`http://127.0.0.1:${address.port}/management/v1/${path}`, {
        headers: { authorization: `Bearer ${token}` },
        redirect: 'error',
      });
    // Exact payload consumed by the existing Account view; no synthetic IAM context.
    assert.deepEqual(await safe(await get('me'), 200), { principalId: 'human' });
    assert.deepEqual(await safe(await get('principal'), 200), { id: 'human', kind: 'human' });
    assert.deepEqual(await safe(await get('models'), 200), { object: 'list', data: [] });
    const denied = await get('me', 'invalid');
    assert.equal(denied.headers.get('www-authenticate'), 'Bearer');
    await safe(denied, 401);
    await f.db.exec('DELETE FROM iam_sso_identity_bindings');
    await safe(await get('me'), 401);
    assert.deepEqual(
      (
        await f.db.query(
          'SELECT outcome,principal_id FROM sso_current_principal_audit_events ORDER BY event_id',
        )
      ).rows,
      [
        { outcome: 'ready', principal_id: 'human' },
        { outcome: 'ready', principal_id: 'human' },
        { outcome: 'unauthenticated', principal_id: null },
        { outcome: 'unauthenticated', principal_id: null },
      ],
    );
    await f.db.exec('DROP TABLE sso_current_principal_audit_events');
    const unavailable = await safe(await get('me'), 503);
    assert.equal(unavailable.error.code, 'audit_unavailable');
    assert.doesNotMatch(JSON.stringify(unavailable), /human|principalId|issuer|subject/u);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.db.close();
  }
});
