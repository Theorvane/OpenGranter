import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/start-gateway.ts', import.meta.url));
async function fixture(source: string, overrides: NodeJS.ProcessEnv = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gateway-service-'));
  const modulePath = join(dir, 'bootstrap #1.mjs');
  await writeFile(modulePath, source);
  const child = spawn(process.execPath, ['--experimental-strip-types', script], {
    env: {
      ...process.env,
      OPENGRANTER_HOST: '127.0.0.1',
      OPENGRANTER_PORT: '8080',
      OPENGRANTER_SHUTDOWN_MS: '30000',
      OPENGRANTER_BOOTSTRAP_MODULE: modulePath,
      ...overrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  let stdout = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  const exited = once(child, 'exit');
  return {
    child,
    exited,
    dir,
    output: () => `${stdout}${stderr}`,
    cleanup: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}
async function waitFor(output: () => string, text: string) {
  for (let i = 0; i < 1000; i++) {
    if (output().includes(text)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Child readiness unavailable: ' + output());
}

test('actual executable hides bootstrap exceptions and refuses relative paths', async () => {
  for (const overrides of [{}, { OPENGRANTER_BOOTSTRAP_MODULE: './private-secret.mjs' }]) {
    const f = await fixture("throw new Error('private-secret-prompt');", overrides);
    try {
      assert.equal((await f.exited)[0], 1);
      assert.doesNotMatch(f.output(), /private-secret|bootstrap #1|Error:|at file:/u);
      assert.match(f.output(), /Gateway (startup unavailable|configuration invalid)/u);
    } finally {
      await f.cleanup();
    }
  }
});

test('actual executable terminates hung bootstrap on signal within deadline', async () => {
  const f = await fixture(
    `export async function createGatewayPorts() {
    console.error('fixture ready'); await new Promise(() => {});
  }`,
    { OPENGRANTER_SHUTDOWN_MS: '50' },
  );
  try {
    await waitFor(f.output, 'fixture ready');
    f.child.kill('SIGTERM');
    assert.equal((await f.exited)[0], 1);
    assert.match(f.output(), /Gateway shutdown deadline exceeded/u);
  } finally {
    await f.cleanup();
  }
});

test('actual dual-route service listens, authenticates and closes database on signal', {
  timeout: 20000,
}, async () => {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const pglite = new URL('../node_modules/@electric-sql/pglite/dist/index.js', import.meta.url)
    .href;
  const f = await fixture(
    `import { PGlite } from ${JSON.stringify(pglite)};
    import { writeFile } from 'node:fs/promises';
    export function createGatewayPorts() {
      const db = new PGlite();
      return { openConnection: () => ({
        query: (sql, params) => db.query(sql, [...params]),
        transaction: (callback) => db.transaction(tx => callback({
          exec: sql => tx.exec(sql), query: (sql, params) => tx.query(sql, [...(params ?? [])]) })),
        close: async () => { await db.close(); await writeFile(new URL('./closed', import.meta.url), 'yes'); }
      }), checkLimit: async () => false,
      resolveSecret: async () => { throw new Error('must not resolve'); } };
    }`,
    { OPENGRANTER_PORT: String(port) },
  );
  try {
    await waitFor(f.output, 'Gateway listening');
    const response = await fetch(`http://127.0.0.1:${port}/v1/models`);
    assert.equal(response.status, 401);
    await response.text();
    f.child.kill('SIGINT');
    assert.equal((await f.exited)[0], 0);
    assert.equal(await readFile(join(f.dir, 'closed'), 'utf8'), 'yes');
    assert.doesNotMatch(f.output(), /must not resolve/u);
  } finally {
    await f.cleanup();
  }
});
