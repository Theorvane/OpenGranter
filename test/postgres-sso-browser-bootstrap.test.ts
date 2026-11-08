import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoBrowserGateway } from '../src/gateway/postgres-sso-browser-bootstrap.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const sso = await createSsoAccessTokenFixture();

for (const entry of ['catalog-entry.ts', 'sso-catalog-entry.ts']) {
  test('published ' + entry + ' starts the owned migrated SSO browser listener', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'og-browser-bootstrap-'));
    const path = join(directory, 'app.js');
    const published = join(directory, 'published.js');
    const build = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        'scripts/build-management-browser.ts',
        'src/management/' + entry,
        '--output',
        published,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(build.status, 0, build.stderr);
    assert.equal(build.stdout, '');
    const javascript = await readFile(published, 'utf8');
    await symlink(published, path);
    const db = new PGlite();
    let opens = 0;
    let closes = 0;
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
        closes++;
        await db.close();
      },
    };
    try {
      const runtime = await startPostgresSsoBrowserGateway({
        ...sso.config,
        host: '127.0.0.1',
        port: 0,
        newRequestId: () => 'artifact-bootstrap',
        browserArtifactPath: path,
        openConnection: () => {
          opens++;
          return connection;
        },
      });
      try {
        const origin = `http://127.0.0.1:${runtime.address.port}`;
        const page = await fetch(`${origin}/management`);
        assert.equal(page.status, 200);
        assert.match(await page.text(), /src="\/management\/app.js"/);
        const script = await fetch(`${origin}/management/app.js`);
        assert.equal(script.status, 200);
        assert.equal(await script.text(), javascript);
        assert.equal(script.headers.get('cache-control'), 'no-store');
        const denied = await fetch(`${origin}/management/v1/proxy-tokens`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        assert.equal(denied.status, 401);
        assert.equal((await fetch(`${origin}/api/v1/models`)).status, 404);
      } finally {
        await runtime.close();
        await runtime.close();
      }
      assert.equal(opens, 1);
      assert.equal(closes, 1);
    } finally {
      if (!closes) await db.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('bad artifacts fail before acquiring a database, with sanitized diagnostics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'og-browser-invalid-'));
  let opens = 0;
  try {
    const paths = ['empty', 'whitespace', 'invalid', 'nul', 'oversized', 'directory', 'missing'];
    await writeFile(join(directory, 'empty'), '');
    await writeFile(join(directory, 'whitespace'), '   \n');
    await writeFile(join(directory, 'invalid'), Buffer.from([0xc3, 0x28]));
    await writeFile(join(directory, 'nul'), 'export default "\0";');
    await writeFile(join(directory, 'oversized'), Buffer.alloc(8 * 1024 * 1024 + 1, 65));
    await mkdir(join(directory, 'directory'));
    for (const path of [...paths.map((name) => join(directory, name)), 'relative.js', '', null]) {
      await assert.rejects(
        startPostgresSsoBrowserGateway({
          ...sso.config,
          host: '127.0.0.1',
          port: 0,
          newRequestId: () => 'artifact-invalid',
          browserArtifactPath: path as string,
          openConnection: () => {
            opens++;
            throw new Error('must not connect');
          },
        }),
        {
          name: 'ManagementBrowserArtifactUnavailable',
          message: 'Management browser artifact unavailable',
        },
      );
    }
    assert.equal(opens, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
