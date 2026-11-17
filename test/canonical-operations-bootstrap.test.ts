import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  ManagementBrowserArtifactUnavailable,
  startPostgresSsoCanonicalOperationsBrowserGateway,
} from '../src/gateway/postgres-sso-browser-bootstrap.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
const path = '/management/v1/proxy-tokens';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'og-operations-bootstrap-'));
  const artifact = join(directory, 'app.js');
  const javascript = 'export {}; // public approved bytes';
  await writeFile(artifact, javascript);
  const db = new PGlite();
  let opens = 0;
  let closes = 0;
  let failAudit = false;
  const connection: PostgresConnection = {
    query: async (sql, params) => {
      if (failAudit && sql.includes('INSERT INTO token_management_decisions'))
        throw new Error('private SQL detail');
      return db.query(sql, [...params]);
    },
    transaction: (callback) =>
      db.transaction((tx) =>
        callback({
          exec: (sql) => tx.exec(sql),
          query: (sql, params) => tx.query(sql, [...params]),
        }),
      ),
    close: async () => {
      closes++;
      await db.close();
    },
  };
  let sequence = 0;
  const ports = {
    ...jwt.config,
    host: '127.0.0.1',
    port: 0,
    newRequestId: () => `operations-bootstrap-${++sequence}`,
    browserArtifactPath: artifact,
    browserArtifactSha256: createHash('sha256').update(javascript).digest('hex'),
    openConnection: () => {
      opens++;
      return connection;
    },
  };
  return {
    directory,
    artifact,
    javascript,
    db,
    ports,
    counts: () => ({ opens, closes }),
    failAudit: () => {
      failAudit = true;
    },
    cleanup: async () => {
      if (!closes) await db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function seed(db: PGlite) {
  await db.exec(`
    INSERT INTO iam_principals VALUES ('admin','human',true),('owner','service',true);
    INSERT INTO iam_policies VALUES ('manage','v1','[{"effect":"Allow","actions":["iam:Manage"],"resources":["principal:owner"]}]');
    INSERT INTO iam_principal_policies VALUES ('admin','manage');
  `);
  await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
    jwt.issuer,
    jwt.subject,
    'admin',
  ]);
}
function post(
  base: string,
  suffix = '',
  body: unknown = { principalId: 'owner', expiresAt: jwt.config.now() + 60000 },
  auth = token,
) {
  return fetch(base + path + suffix, {
    method: 'POST',
    headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
async function payload(response: Response, status: number) {
  const text = await response.text();
  assert.equal(response.status, status, text);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.doesNotMatch(text, /private SQL detail|SELECT|INSERT/u);
  return JSON.parse(text);
}

test('owned operations bootstrap snapshots approved artifact, migrates and serves reads plus issue/revoke then closes once', async () => {
  const f = await fixture();
  let runtime:
    | Awaited<ReturnType<typeof startPostgresSsoCanonicalOperationsBrowserGateway>>
    | undefined;
  try {
    runtime = await startPostgresSsoCanonicalOperationsBrowserGateway(f.ports);
    const base = `http://127.0.0.1:${runtime.address.port}`;
    assert.deepEqual(f.counts(), { opens: 1, closes: 0 });
    await seed(f.db);
    const get = (resource: string) =>
      fetch(base + resource, { headers: { authorization: `Bearer ${token}` } });
    assert.equal((await get('/management')).status, 200);
    await writeFile(f.artifact, 'console.log("unreviewed replacement")');
    assert.equal(await (await get('/management/app.js')).text(), f.javascript);
    // Runtime does not silently install separately managed Account prerequisites.
    assert.equal((await get('/management/v1/me')).status, 503);
    await f.db.exec(
      await readFile(
        new URL('../contracts/sql/current-principal-audit.sql', import.meta.url),
        'utf8',
      ),
    );
    assert.deepEqual(await payload(await get('/management/v1/me'), 200), { principalId: 'admin' });
    assert.deepEqual((await payload(await get('/management/v1/models'), 200)).data, []);
    const issued = await payload(await post(base), 201);
    assert.equal(typeof issued.token, 'string');
    assert.deepEqual(
      await payload(await post(base, '/revoke', { credentialId: issued.credentialId }), 200),
      { revoked: true },
    );
    assert.deepEqual(
      await payload(await post(base, '/revoke', { credentialId: issued.credentialId }), 200),
      { revoked: false },
    );
    assert.equal((await get('/api/v1/models')).status, 404);
    assert.equal((await get('/v1/usage')).status, 404);
    await payload(await post(base, '', undefined, issued.token), 401);
    await f.db.query('UPDATE iam_principals SET active=false WHERE principal_id=$1', ['admin']);
    await payload(await post(base), 401);
    await runtime.close();
    await runtime.close();
    assert.deepEqual(f.counts(), { opens: 1, closes: 1 });
    await assert.rejects(fetch(`${base}/management`));
  } finally {
    await runtime?.close();
    await f.cleanup();
  }
});

test('operations owned listener preserves fresh Deny and transactional audit rollback', async () => {
  const f = await fixture();
  let runtime:
    | Awaited<ReturnType<typeof startPostgresSsoCanonicalOperationsBrowserGateway>>
    | undefined;
  try {
    runtime = await startPostgresSsoCanonicalOperationsBrowserGateway(f.ports);
    const base = `http://127.0.0.1:${runtime.address.port}`;
    await seed(f.db);
    await f.db.exec(
      `UPDATE iam_policies SET statements='[{"effect":"Deny","actions":["iam:Manage"],"resources":["principal:owner"]}]'`,
    );
    await payload(await post(base), 403);
    await f.db.exec(
      `UPDATE iam_policies SET statements='[{"effect":"Allow","actions":["iam:Manage"],"resources":["principal:owner"]}]'`,
    );
    f.failAudit();
    await payload(await post(base), 503);
    assert.equal(
      (await f.db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM proxy_credentials'))
        .rows[0]?.count,
      0,
    );
  } finally {
    await runtime?.close();
    await f.cleanup();
  }
});

test('invalid or mismatched artifact is rejected before opening owned database', async () => {
  const f = await fixture();
  try {
    for (const hash of ['', 'A'.repeat(64), '0'.repeat(64)]) {
      await assert.rejects(
        startPostgresSsoCanonicalOperationsBrowserGateway({
          ...f.ports,
          browserArtifactSha256: hash,
        }),
        ManagementBrowserArtifactUnavailable,
      );
    }
    assert.deepEqual(f.counts(), { opens: 0, closes: 0 });
  } finally {
    await f.cleanup();
  }
});

test('invalid SSO configuration after database acquisition closes owned connection', async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      startPostgresSsoCanonicalOperationsBrowserGateway({ ...f.ports, issuer: '' }),
      { name: 'GatewayStartupUnavailable' },
    );
    assert.deepEqual(f.counts(), { opens: 1, closes: 1 });
  } finally {
    await f.cleanup();
  }
});

test('bind failure releases database without taking over occupied listener', async () => {
  const f = await fixture();
  const occupied = createServer();
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  const address = occupied.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await assert.rejects(
      startPostgresSsoCanonicalOperationsBrowserGateway({ ...f.ports, port: address.port }),
      { name: 'GatewayStartupUnavailable' },
    );
    assert.equal(occupied.listening, true);
    assert.deepEqual(f.counts(), { opens: 1, closes: 1 });
  } finally {
    await new Promise<void>((resolve, reject) =>
      occupied.close((error) => (error ? reject(error) : resolve())),
    );
    await f.cleanup();
  }
});
