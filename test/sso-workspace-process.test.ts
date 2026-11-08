import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

async function availablePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

test('workspace executable loads its explicit factory, serves actual bundle and closes SQL on SIGTERM', {
  timeout: 45_000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'og-workspace-process-'));
  const artifact = join(directory, 'app.js');
  const modulePath = join(directory, 'bootstrap.mjs');
  const closed = join(directory, 'closed.json');
  const port = await availablePort();
  try {
    const build = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        'scripts/build-management-browser.ts',
        'src/management/sso-catalog-entry.ts',
        '--output',
        artifact,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(build.status, 0, build.stderr);
    const sso = await createSsoAccessTokenFixture();
    // Public configuration only. Signing keys and access tokens never enter the module.
    await writeFile(
      modulePath,
      [
        `import { PGlite } from ${JSON.stringify(import.meta.resolve('@electric-sql/pglite'))};`,
        "import { writeFile } from 'node:fs/promises';",
        'export function createSsoWorkspacePorts() {',
        `const config = ${JSON.stringify({ issuer: sso.issuer, audience: sso.audience, jwks: sso.config.jwks, browserArtifactPath: artifact })};`,
        'return { ...config, writeAuditHistoryAccess: async () => {}, openConnection() {',
        'const db = new PGlite();',
        'return {',
        'query: (sql, params) => db.query(sql, [...params]),',
        'transaction: callback => db.transaction(tx => callback({exec: sql => tx.exec(sql), query: (sql, params) => tx.query(sql, [...params])})),',
        'close: async () => {',
        "const result = await db.query(\"SELECT to_regclass('sso_current_principal_audit_events') AS principal, to_regclass('sso_usage_audit_events') AS usage\");",
        'await db.close();',
        `await writeFile(${JSON.stringify(closed)}, JSON.stringify(result.rows));`,
        '}',
        '};',
        '} };',
        '}',
      ].join('\n'),
    );
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', 'scripts/start-sso-workspace.ts'],
      {
        env: {
          ...process.env,
          OPENGRANTER_BOOTSTRAP_MODULE: modulePath,
          OPENGRANTER_HOST: '127.0.0.1',
          OPENGRANTER_PORT: String(port),
          OPENGRANTER_SHUTDOWN_MS: '5000',
          NODE_NO_WARNINGS: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const exited = once(child, 'exit');
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    let ready: () => void = () => {};
    const listening = new Promise<void>((resolve) => {
      ready = resolve;
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
      if (stderr.includes('Gateway listening\n')) ready();
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        listening,
        exited.then(() => {
          throw new Error(`Startup exited: ${stderr}`);
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Startup timeout')), 30_000);
        }),
      ]);
      const origin = `http://127.0.0.1:${port}`;
      const page = await fetch(`${origin}/management`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /src="\/management\/app.js"/);
      const script = await fetch(`${origin}/management/app.js`);
      assert.equal(script.status, 200);
      assert.equal(await script.text(), await readFile(artifact, 'utf8'));
      assert.equal(script.headers.get('cache-control'), 'no-store');
      // Proves trusted factory -> process -> artifact -> runtime audit opt-in.
      // In-memory writer only; not durable installation or company identity.
      const audit = await fetch(`${origin}/management/v1/audit`);
      assert.equal(audit.status, 401);
      assert.equal(audit.headers.get('cache-control'), 'no-store');
      await audit.text();
      // Proves workspace composition, not management-only startup: usage is not 404.
      for (const path of ['/management/v1/me', '/management/v1/usage']) {
        const response = await fetch(origin + path);
        assert.equal(response.status, 503);
        assert.equal(
          ((await response.json()) as { error: { code: string } }).error.code,
          'audit_unavailable',
        );
      }
      child.kill('SIGTERM');
      const [code, signal] = await exited;
      assert.equal(code, 0);
      assert.equal(signal, null);
      assert.equal(stdout, '');
      assert.equal(stderr, 'Gateway listening\n');
      assert.deepEqual(JSON.parse(await readFile(closed, 'utf8')), [
        { principal: null, usage: null },
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('workspace executable rejects missing deployment configuration with fixed diagnostics', () => {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: '1' };
  delete env.OPENGRANTER_BOOTSTRAP_MODULE;
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', 'scripts/start-sso-workspace.ts'],
    { env, encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Gateway configuration invalid\n');
});
