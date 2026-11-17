import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const script = fileURLToPath(new URL('../scripts/start-gateway.ts', import.meta.url));
const pglite = new URL('../node_modules/@electric-sql/pglite/dist/index.js', import.meta.url).href;
const historySql =
  'SELECT version, checksum, applied_at_ms FROM schema_migrations ORDER BY version';
const catalogSql = "SELECT alias, enabled FROM catalog_models WHERE alias = 'restart-probe'";

test('disk-backed process restart, cold fixture recovery and migration rejection', {
  timeout: 180000,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gateway-disk-recovery-'));
  const dbPath = join(dir, 'database');
  const marker = join(dir, 'ports-used');
  const bootstrap = join(dir, 'bootstrap.mjs');
  await writeFile(
    bootstrap,
    `import { PGlite } from ${JSON.stringify(pglite)};
import { appendFile } from 'node:fs/promises';
export function createGatewayPorts() {
  const db = new PGlite(${JSON.stringify(dbPath)});
  return { openConnection: () => ({
    query: (sql, params) => db.query(sql, [...params]),
    transaction: cb => db.transaction(tx => cb({exec: sql => tx.exec(sql),
      query: (sql, params) => tx.query(sql, [...(params ?? [])])})),
    close: () => db.close()
  }), checkLimit: async () => { await appendFile(${JSON.stringify(marker)}, 'limit'); return false; },
  resolveSecret: async () => { await appendFile(${JSON.stringify(marker)}, 'secret'); throw new Error('provider forbidden'); } };
}`,
  );

  async function run(signal: NodeJS.Signals | null) {
    const socket = createServer();
    socket.listen(0, '127.0.0.1');
    await once(socket, 'listening');
    const address = socket.address();
    assert.ok(address && typeof address !== 'string');
    const port = address.port;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    // Do not inherit operator bootstrap/database/provider environment into this fixture.
    const child = spawn(process.execPath, ['--experimental-strip-types', script], {
      env: {
        PATH: process.env.PATH,
        OPENGRANTER_BOOTSTRAP_MODULE: bootstrap,
        OPENGRANTER_HOST: '127.0.0.1',
        OPENGRANTER_PORT: String(port),
        OPENGRANTER_SHUTDOWN_MS: '5000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    const exited = once(child, 'exit');
    const deadline = setTimeout(() => child.kill('SIGKILL'), 20000);
    try {
      if (signal) {
        for (let i = 0; i < 1500 && !output.includes('Gateway listening'); i++) {
          assert.equal(child.exitCode, null, 'fixture startup failed');
          assert.equal(child.signalCode, null, 'fixture startup timed out');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.match(output, /Gateway listening/u);
        for (const base of ['/v1', '/api/v1']) {
          const response = await fetch(`http://127.0.0.1:${port}${base}/models`, {
            signal: AbortSignal.timeout(2000),
          });
          assert.equal(response.status, 401);
          await response.text();
        }
        child.kill(signal);
        assert.deepEqual(await exited, [0, null]);
        assert.doesNotMatch(output, /startup unavailable|shutdown unavailable|provider forbidden/u);
      } else {
        assert.deepEqual(await exited, [1, null]);
        assert.match(output, /Gateway startup unavailable/u);
        assert.doesNotMatch(output, /Gateway listening/u);
        for (const base of ['/v1', '/api/v1']) {
          await assert.rejects(
            fetch(`http://127.0.0.1:${port}${base}/models`, { signal: AbortSignal.timeout(2000) }),
          );
        }
      }
    } finally {
      clearTimeout(deadline);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
    }
  }

  async function stored() {
    const db = new PGlite(dbPath);
    try {
      return {
        catalog: (await db.query(catalogSql)).rows,
        history: (await db.query(historySql)).rows,
      };
    } finally {
      await db.close();
    }
  }
  try {
    await run('SIGTERM');
    let db = new PGlite(dbPath);
    try {
      await db.query(
        "INSERT INTO catalog_models(alias, created_at_seconds, enabled) VALUES ('restart-probe', 0, false)",
      );
    } finally {
      await db.close();
    }
    const expected = await stored();
    assert.deepEqual(expected.catalog, [{ alias: 'restart-probe', enabled: false }]);
    assert.ok(expected.history.length > 0);
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      await run(signal);
      assert.deepEqual(await stored(), expected);
    }
    db = new PGlite(dbPath);
    let archive: Blob;
    try {
      archive = await db.dumpDataDir();
    } finally {
      await db.close();
    }
    const backupPath = join(dir, 'backup.tar.gz');
    await writeFile(backupPath, Buffer.from(await archive.arrayBuffer()));
    async function restore() {
      // Only delete this test's freshly allocated disposable directory, never operator data.
      await rm(dbPath, { recursive: true, force: true });
      const restored = new PGlite({
        dataDir: dbPath,
        loadDataDir: new Blob([await readFile(backupPath)]),
      });
      try {
        await restored.waitReady;
      } finally {
        await restored.close();
      }
    }
    db = new PGlite(dbPath);
    try {
      await db.query("DELETE FROM catalog_models WHERE alias = 'restart-probe'");
    } finally {
      await db.close();
    }
    assert.deepEqual((await stored()).catalog, []);
    await restore();
    assert.deepEqual(await stored(), expected);
    await run('SIGTERM');
    assert.deepEqual(await stored(), expected);
    for (const sql of [
      "UPDATE schema_migrations SET checksum = repeat('0', 64) WHERE version = '001'",
      "DELETE FROM schema_migrations WHERE version = '002'",
      "INSERT INTO schema_migrations(version, checksum, applied_at_ms) VALUES ('999', repeat('0', 64), 0)",
    ]) {
      await restore();
      db = new PGlite(dbPath);
      try {
        await db.query(sql);
      } finally {
        await db.close();
      }
      const broken = await stored();
      assert.notDeepEqual(broken.history, expected.history);
      await run(null);
      assert.deepEqual(await stored(), broken);
      await assert.rejects(readFile(marker), { code: 'ENOENT' });
    }
    await restore();
    await run('SIGTERM');
    assert.deepEqual(await stored(), expected);
    await assert.rejects(readFile(marker), { code: 'ENOENT' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
