import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoBrowserGateway } from '../src/gateway/postgres-sso-browser-bootstrap.ts';
import { loadSsoBrowserBootstrap } from '../src/gateway/sso-operator-bootstrap.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

test('operator-loaded public trust reaches migrated HTTP and fresh binding revocation', {
  timeout: 30000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'og-sso-operator-http-'));
  const db = new PGlite();
  let closed = false;
  const connection: PostgresConnection = {
    query: (sql, params) => db.query(sql, [...params]),
    transaction: (callback) =>
      db.transaction((tx) =>
        callback({
          exec: (sql) => tx.exec(sql),
          query: (sql, params) => tx.query(sql, [...params]),
        }),
      ),
    close: async () => {
      closed = true;
      await db.close();
    },
  };
  const jwt = await createSsoAccessTokenFixture();
  const jwks = join(directory, 'public.json');
  const artifact = join(directory, 'app.js');
  let runtime: Awaited<ReturnType<typeof startPostgresSsoBrowserGateway>> | undefined;
  try {
    await writeFile(jwks, JSON.stringify(jwt.config.jwks));
    await writeFile(artifact, 'export {};');
    const ports = await loadSsoBrowserBootstrap(
      {
        OPENGRANTER_SSO_ISSUER: jwt.issuer,
        OPENGRANTER_SSO_AUDIENCE: jwt.audience,
        OPENGRANTER_SSO_JWKS_PATH: jwks,
        OPENGRANTER_BROWSER_ARTIFACT_PATH: artifact,
      },
      () => connection,
    );
    runtime = await startPostgresSsoBrowserGateway({
      ...ports,
      host: '127.0.0.1',
      port: 0,
      now: jwt.config.now,
      newRequestId: () => 'operator-config-http',
    });
    const base = `http://127.0.0.1:${runtime.address.port}`;
    const script = await fetch(`${base}/management/app.js`);
    assert.equal(await script.text(), 'export {};');
    const anonymous = await fetch(`${base}/management/v1/models`);
    assert.equal(anonymous.status, 401);
    await anonymous.text();
    await db.exec("INSERT INTO iam_principals VALUES ('human','human',true)");
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    const headers = { authorization: `Bearer ${await jwt.token()}` };
    const allowed = await fetch(`${base}/management/v1/models`, { headers });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { object: 'list', data: [] });
    await db.exec('DELETE FROM iam_sso_identity_bindings');
    const revoked = await fetch(`${base}/management/v1/models`, { headers });
    assert.equal(revoked.status, 401);
    await revoked.text();
    const events = JSON.stringify((await db.query('SELECT * FROM sso_catalog_audit_events')).rows);
    assert.equal(events.includes(headers.authorization), false);
    assert.equal(events.includes(jwt.subject), false);
  } finally {
    if (runtime) await runtime.close();
    if (!closed) await db.close();
    await rm(directory, { recursive: true, force: true });
  }
  assert.equal(closed, true);
});

test('actual CLI selects shipped operator module and redacts invalid trust configuration', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--experimental-strip-types',
      'scripts/start-sso-browser.ts',
    ],
    {
      env: {
        PATH: process.env.PATH,
        OPENGRANTER_BOOTSTRAP_MODULE: resolve('scripts/sso-browser-bootstrap.ts'),
        OPENGRANTER_SSO_ISSUER: 'http://private-configuration.example',
        OPENGRANTER_SSO_AUDIENCE: 'private-audience',
        OPENGRANTER_SSO_JWKS_PATH: '/private/unavailable-jwks.json',
        OPENGRANTER_BROWSER_ARTIFACT_PATH: '/private/app.js',
      },
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Gateway startup unavailable\n');
});

test('shipped factory accepts public trust without opening a PostgreSQL socket', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'og-sso-operator-module-'));
  try {
    const jwt = await createSsoAccessTokenFixture();
    const path = join(directory, 'public.json');
    await writeFile(path, JSON.stringify(jwt.config.jwks));
    const result = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        '--experimental-strip-types',
        '--input-type=module',
        '--eval',
        "import { createSsoBrowserPorts } from './scripts/sso-browser-bootstrap.ts'; const ports = await createSsoBrowserPorts(); if (typeof ports.openConnection !== 'function') process.exit(2); process.stdout.write('configured\\n');",
      ],
      {
        env: {
          PATH: process.env.PATH,
          PGHOST: '/definitely-not-an-installed-postgres-socket',
          OPENGRANTER_SSO_ISSUER: jwt.issuer,
          OPENGRANTER_SSO_AUDIENCE: jwt.audience,
          OPENGRANTER_SSO_JWKS_PATH: path,
          OPENGRANTER_BROWSER_ARTIFACT_PATH: join(directory, 'app.js'),
        },
        encoding: 'utf8',
        timeout: 10000,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'configured\n');
    assert.equal(result.stderr, '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
