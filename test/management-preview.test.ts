import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import test from 'node:test';
import { startManagementPreview } from '../scripts/preview-management.ts';

const root = resolve('.');
const script = 'scripts/preview-management.ts';

test('preview serves the actual public SSO artifact only on loopback', async (t) => {
  const server = await startManagementPreview(root, 0);
  t.after(
    () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  );
  const address = server.address() as AddressInfo;
  assert.equal(address.address, '127.0.0.1');
  const origin = `http://127.0.0.1:${address.port}`;
  const shell = await fetch(`${origin}/management`);
  assert.equal(shell.status, 200);
  assert.equal(shell.headers.get('cache-control'), 'no-store');
  assert.match(shell.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  assert.match(await shell.text(), /type="module" src="\/management\/app.js"/);
  const module = await fetch(`${origin}/management/app.js`);
  assert.equal(module.status, 200);
  const source = await module.text();
  assert.match(source, /mountSsoManagementCatalogPage/);
  assert.doesNotMatch(source, /sourceMappingURL|process\.env|localStorage|sessionStorage/);
  const head = await fetch(`${origin}/management`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  for (const path of [
    '/api/v1/models',
    '/management/v1/models',
    '/management/v1/me',
    '/management/app.js.map',
    '/.env',
    '/',
  ]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), 'Not found');
  }
  assert.equal((await fetch(`${origin}/management?secret=not-real`)).status, 400);
  assert.equal((await fetch(`${origin}/management`, { method: 'POST' })).status, 405);
  for (const port of [-1, 65536, 0.5, NaN, Infinity]) {
    await assert.rejects(startManagementPreview(root, port), /Invalid preview port/);
  }
  await assert.rejects(startManagementPreview(root, address.port), { code: 'EADDRINUSE' });
  const conflict = spawnSync(
    process.execPath,
    ['--experimental-strip-types', script, '--port', String(address.port)],
    { encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(conflict.status, 1);
  assert.equal(conflict.stdout, '');
  assert.equal(
    conflict.stderr,
    'Management preview failed. Use --port <0-65535>; loopback public shell only.\n',
  );
});

test('CLI requires exact arguments and reports only fixed errors', () => {
  for (const args of [
    [],
    ['--port', '-1'],
    ['--port', '65536'],
    ['--port', '01'],
    ['--port', '1e3'],
    ['--port', ''],
    ['--port', '0', '--host', '0.0.0.0'],
    ['--token', 'private-not-real'],
  ]) {
    const child = spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(child.status, 1);
    assert.equal(child.stdout, '');
    assert.equal(
      child.stderr,
      'Management preview failed. Use --port <0-65535>; loopback public shell only.\n',
    );
  }
});

test('CLI reports actual URL and exits cleanly on SIGTERM', { timeout: 20000 }, async (t) => {
  const child = spawn(process.execPath, ['--experimental-strip-types', script, '--port', '0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });
  let output = '';
  let errors = '';
  child.stderr.setEncoding('utf8').on('data', (value: string) => {
    errors += value;
  });
  const origin = await new Promise<string>((done, reject) => {
    child.stdout.setEncoding('utf8').on('data', (value: string) => {
      output += value;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/management/);
      if (match) done(match[0]);
    });
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Preview exited before readiness')));
  });
  assert.equal((await fetch(origin)).status, 200);
  const exit = once(child, 'exit');
  child.kill('SIGTERM');
  assert.deepEqual(await exit, [0, null]);
  assert.equal(errors, '');
  assert.match(output, /Public signed-out shell only; no login, API or provider activation/);
});
