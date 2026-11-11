import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { publishManagementWorkspace } from '../scripts/build-management-workspace.ts';
import { startPostgresSsoWorkspaceBrowserGateway } from '../src/gateway/postgres-sso-browser-bootstrap.ts';
import { loadSsoBrowserBootstrap } from '../src/gateway/sso-operator-bootstrap.ts';
import { isSsoWorkspacePorts } from '../src/gateway/sso-workspace-service.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const sso = await createSsoAccessTokenFixture();
const base = { ...sso.config, host: '127.0.0.1', port: 0, newRequestId: () => 'pinned-workspace' };

test('workspace rejects wrong or malformed pins before acquiring SQL for the real product artifact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'og-workspace-pin-'));
  let opens = 0;
  try {
    const path = join(directory, 'app.js');
    const receipt = await publishManagementWorkspace(resolve('.'), path);
    const wrong = receipt.sha256 === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
    for (const pin of [
      wrong,
      '',
      null,
      3,
      {},
      'A'.repeat(64),
      'a'.repeat(63),
      `${receipt.sha256}\n`,
    ]) {
      await assert.rejects(
        startPostgresSsoWorkspaceBrowserGateway({
          ...base,
          browserArtifactPath: path,
          ...{ browserArtifactSha256: pin as string },
          openConnection: () => {
            opens++;
            throw new Error('SQL must remain unopened');
          },
        }),
        {
          name: 'ManagementBrowserArtifactUnavailable',
          message: 'Management browser artifact unavailable',
        },
      );
    }
    // Same valid UTF-8/JS with an extra byte is not the pinned release.
    await writeFile(path, `${await readFile(path, 'utf8')}\n`);
    await assert.rejects(
      startPostgresSsoWorkspaceBrowserGateway({
        ...base,
        browserArtifactPath: path,
        browserArtifactSha256: receipt.sha256,
        openConnection: () => {
          opens++;
          throw new Error('SQL must remain unopened');
        },
      }),
      {
        name: 'ManagementBrowserArtifactUnavailable',
        message: 'Management browser artifact unavailable',
      },
    );
    assert.equal(opens, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('workspace serves exact pinned product bytes and retains the verified startup snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'og-workspace-pinned-http-'));
  const db = new PGlite();
  let closes = 0;
  let opens = 0;
  try {
    const path = join(directory, 'app.js');
    const receipt = await publishManagementWorkspace(resolve('.'), path);
    const bytes = await readFile(path);
    const runtime = await startPostgresSsoWorkspaceBrowserGateway({
      ...base,
      browserArtifactPath: path,
      browserArtifactSha256: receipt.sha256,
      openConnection: () => {
        opens++;
        return {
          query: (sql, params) => db.query(sql, [...params]),
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
      },
    });
    try {
      await writeFile(path, 'console.log("different release");');
      const origin = `http://127.0.0.1:${runtime.address.port}`;
      const page = await fetch(`${origin}/management`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /src="\/management\/app.js"/);
      const script = await fetch(`${origin}/management/app.js`);
      assert.equal(script.status, 200);
      assert.equal(script.headers.get('cache-control'), 'no-store');
      assert.deepEqual(Buffer.from(await script.arrayBuffer()), bytes);
    } finally {
      await runtime.close();
    }
    assert.equal(opens, 1);
    assert.equal(closes, 1);
  } finally {
    if (!closes) await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('workspace service validates optional pins without changing legacy omission', () => {
  const ports = {
    ...base,
    browserArtifactPath: '/trusted/app.js',
    openConnection: () => {
      throw new Error();
    },
  };
  assert.equal(isSsoWorkspacePorts(ports), true);
  assert.equal(isSsoWorkspacePorts({ ...ports, browserArtifactSha256: 'a'.repeat(64) }), true);
  for (const pin of ['', null, 3, {}, 'A'.repeat(64), 'a'.repeat(63), `${'a'.repeat(64)}\n`])
    assert.equal(isSsoWorkspacePorts({ ...ports, browserArtifactSha256: pin }), false);
});

test('operator config passes the fixed-profile receipt pin through workspace validation without opening SQL', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'og-workspace-pin-config-'));
  let opens = 0;
  try {
    const path = join(directory, 'app.js');
    const receipt = await publishManagementWorkspace(resolve('.'), path);
    const jwksPath = join(directory, 'jwks.json');
    await writeFile(jwksPath, JSON.stringify(sso.config.jwks));
    const env = {
      OPENGRANTER_SSO_ISSUER: sso.issuer,
      OPENGRANTER_SSO_AUDIENCE: sso.audience,
      OPENGRANTER_SSO_JWKS_PATH: jwksPath,
      OPENGRANTER_BROWSER_ARTIFACT_PATH: path,
      OPENGRANTER_BROWSER_ARTIFACT_SHA256: receipt.sha256,
    };
    const open = () => {
      opens++;
      throw new Error('must remain unopened');
    };
    const ports = await loadSsoBrowserBootstrap(env, open);
    assert.equal(ports.browserArtifactSha256, receipt.sha256);
    assert.equal(isSsoWorkspacePorts(ports), true);
    for (const pin of ['', 'A'.repeat(64), `${receipt.sha256}\n`]) {
      await assert.rejects(
        loadSsoBrowserBootstrap({ ...env, OPENGRANTER_BROWSER_ARTIFACT_SHA256: pin }, open),
        {
          name: 'SsoOperatorBootstrapUnavailable',
          message: 'SSO operator bootstrap unavailable',
        },
      );
    }
    assert.equal(opens, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
