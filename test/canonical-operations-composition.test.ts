import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresProxyCredentialStore } from '../src/gateway/postgres-proxy-credentials.ts';
import {
  createPostgresSsoCanonicalOperationsHandler,
  createPostgresSsoCanonicalOperationsServer,
} from '../src/gateway/postgres-sso-canonical-operations-http.ts';
import { createPostgresSsoCanonicalReviewHandler } from '../src/gateway/postgres-sso-canonical-review-http.ts';
import { createProxyTokenService } from '../src/gateway/proxy-tokens.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
const path = '/management/v1/proxy-tokens';
async function fixture() {
  const db = new PGlite();
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
  await db.exec(
    await readFile(
      new URL('../contracts/sql/current-principal-audit.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec(`
    INSERT INTO iam_principals VALUES ('admin','human',true),('owner','service',true);
    INSERT INTO iam_policies VALUES ('manage','v1','[{"effect":"Allow","actions":["iam:Manage"],"resources":["principal:owner"]},{"effect":"Allow","actions":["usage:ReadSelf","audit:Read"],"resources":["principal:admin"]}]');
    INSERT INTO iam_principal_policies VALUES ('admin','manage');
  `);
  await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
    jwt.issuer,
    jwt.subject,
    'admin',
  ]);
  let failAudit = false;
  const client = {
    query: async (sql: string, params: readonly unknown[]) => {
      if (failAudit && sql.includes('INSERT INTO token_management_decisions'))
        throw new Error('private SQL detail');
      return db.query(sql, [...params]);
    },
  };
  let sequence = 0;
  const ports = {
    ...jwt.config,
    client,
    newRequestId: () => `operations-${++sequence}`,
    javascript: 'export {};',
  };
  const server = createPostgresSsoCanonicalOperationsServer(ports);
  assert.equal(server.listening, false);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  return {
    db,
    ports,
    failAudit: () => {
      failAudit = true;
    },
    get: (resource: string, auth = token) =>
      fetch(base + resource, { headers: { authorization: `Bearer ${auth}` } }),
    post: (
      resource = path,
      body: unknown = { principalId: 'owner', expiresAt: jwt.config.now() + 60000 },
      auth = token,
    ) =>
      fetch(base + resource, {
        method: 'POST',
        headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    verify: createProxyTokenService({
      store: createPostgresProxyCredentialStore(client),
      now: jwt.config.now,
    }).verifyCredential,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      await db.close();
    },
  };
}
async function body(response: Response, status: number) {
  const text = await response.text();
  assert.equal(response.status, status, text);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.ok(!text.includes(token));
  assert.doesNotMatch(text, /private SQL detail|SELECT|INSERT/u);
  return JSON.parse(text);
}

test('one canonical operations socket serves private reads and authorized token issue/revoke', async () => {
  const f = await fixture();
  try {
    const shell = await f.get('/management', '');
    assert.equal(shell.status, 200);
    assert.match(await shell.text(), /OpenGranter management/u);
    assert.deepEqual(await body(await f.get('/management/v1/me'), 200), { principalId: 'admin' });
    assert.deepEqual((await body(await f.get('/management/v1/models'), 200)).data, []);
    assert.deepEqual((await body(await f.get('/management/v1/usage'), 200)).data, []);
    assert.deepEqual((await body(await f.get('/management/v1/audit'), 200)).data, []);
    const issued = await body(await f.post(), 201);
    assert.equal((await f.verify(issued.token))?.principalId, 'owner');
    assert.deepEqual(
      await body(await f.post(`${path}/revoke`, { credentialId: issued.credentialId }), 200),
      { revoked: true },
    );
    assert.equal(await f.verify(issued.token), undefined);
    assert.deepEqual(
      await body(await f.post(`${path}/revoke`, { credentialId: issued.credentialId }), 200),
      { revoked: false },
    );
    const decisions = await f.db.query<{ operation: string; outcome: string }>(
      'SELECT operation,outcome FROM token_management_decisions ORDER BY event_id',
    );
    assert.deepEqual(decisions.rows, [
      { operation: 'issue', outcome: 'allowed' },
      { operation: 'revoke', outcome: 'allowed' },
      { operation: 'revoke', outcome: 'allowed' },
    ]);
    const snapshots = await f.db.query('SELECT * FROM sso_current_principal_audit_events');
    assert.equal(snapshots.rows.length, 1);
  } finally {
    await f.close();
  }
});

test('fresh Deny, revoked identity, authentication and audit failure remain enforced after composition', async () => {
  const f = await fixture();
  try {
    const issued = await body(await f.post(), 201);
    await f.db.exec(
      `UPDATE iam_policies SET version='v2', statements='[{"effect":"Deny","actions":["iam:Manage"],"resources":["*"]}]'`,
    );
    assert.equal((await body(await f.post(), 403)).error.code, 'forbidden');
    assert.equal(
      (await body(await f.post(`${path}/revoke`, { credentialId: issued.credentialId }), 403)).error
        .code,
      'forbidden',
    );
    assert.ok(await f.verify(issued.token));
    await f.db.exec(
      `UPDATE iam_policies SET version='v3', statements='[{"effect":"Allow","actions":["iam:Manage"],"resources":["principal:owner"]}]'`,
    );
    f.failAudit();
    const failure = await body(await f.post(), 503);
    assert.ok(!JSON.stringify(failure).includes('credentialId'));
    const count = await f.db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM proxy_credentials',
    );
    assert.equal(count.rows[0]?.count, 1);
    await body(await f.post(`${path}/revoke`, { credentialId: issued.credentialId }), 503);
    assert.ok(await f.verify(issued.token));
    await f.db.exec('DELETE FROM iam_sso_identity_bindings');
    assert.equal((await body(await f.get('/management/v1/me'), 401)).error.code, 'unauthorized');
    assert.equal((await body(await f.post(), 401)).error.code, 'unauthorized');
  } finally {
    await f.close();
  }
});

test('no default write mount, proxy credential bridge, cookie session or endpoint fallback', async () => {
  const f = await fixture();
  try {
    const issued = await body(await f.post(), 201);
    assert.equal(
      (await body(await f.get('/management/v1/me', issued.token), 401)).error.code,
      'unauthorized',
    );
    assert.equal((await body(await f.post(path, {}, ''), 401)).error.code, 'unauthorized');
    const original = createPostgresSsoCanonicalReviewHandler(f.ports);
    assert.equal(
      (await original(new Request(`https://local.test${path}`, { method: 'POST' }))).status,
      404,
    );
    for (const resource of [
      `${path}/unknown`,
      `${path}/revoke/`,
      '/v1/chat/completions',
      '/management/v1/policies',
    ])
      assert.equal((await body(await f.post(resource), 404)).error.code, 'not_found');
    const handler = createPostgresSsoCanonicalOperationsHandler({
      ...f.ports,
      ...{
        authenticate: async () => 'admin',
        issue: async () => ({ token: 'forged' }),
        writeAudit: async () => {},
      },
    });
    const denied = await handler(
      new Request(`https://local.test${path}`, {
        method: 'POST',
        headers: { cookie: 'session=forged', 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    assert.equal((await body(denied, 401)).error.code, 'unauthorized');
    const noShell = createPostgresSsoCanonicalOperationsHandler({
      ...jwt.config,
      client: f.ports.client,
      newRequestId: f.ports.newRequestId,
    });
    assert.equal((await noShell(new Request('https://local.test/management'))).status, 404);
    assert.throws(() =>
      createPostgresSsoCanonicalOperationsHandler({ ...f.ports, javascript: '' }),
    );
  } finally {
    await f.close();
  }
});

test('shared handler and socket contain unexpected request-ID failures before SQL', async () => {
  let queries = 0;
  const ports = {
    ...jwt.config,
    client: {
      query: async () => {
        queries++;
        throw new Error('private SQL detail');
      },
    },
    newRequestId: (): string => {
      throw new Error('private SQL detail');
    },
  };
  const handler = createPostgresSsoCanonicalOperationsHandler(ports);
  for (const endpoint of [path, `${path}/revoke`]) {
    const response = await handler(
      new Request(`https://local.test${endpoint}`, { method: 'POST' }),
    );
    assert.equal((await body(response, 503)).error.code, 'internal_error');
  }
  const server = createPostgresSsoCanonicalOperationsServer(ports);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method: 'POST' });
    assert.equal((await body(response, 503)).error.code, 'internal_error');
    assert.equal(queries, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
