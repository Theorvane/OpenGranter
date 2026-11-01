import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { runCodexAuth } from '../src/identity/codex-auth.ts';

const execute = promisify(execFile);
const entrypoint = resolve('scripts/codex-auth.ts');
async function fixture(run: (root: string, binary: string, home: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'og-codex-auth-'));
  const binary = join(root, 'codex');
  const home = join(root, 'credentials');
  await writeFile(
    binary,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$CODEX_HOME/args"\nprintf "%s" "$OPENAI_API_KEY$CODEX_CONFIG$OPENGRANTER_PROXY_TOKEN" > "$CODEX_HOME/leaked-env"\nprintf "%s" "$HOME" > "$CODEX_HOME/child-home"\necho fixture-private-diagnostic\necho fixture-private-diagnostic >&2\nexit 0\n',
    { mode: 0o700 },
  );
  try {
    await run(root, binary, home);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const parentEnv = {
  ...process.env,
  OPENAI_API_KEY: 'fixture-secret',
  CODEX_CONFIG: 'untrusted',
  OPENGRANTER_PROXY_TOKEN: 'fixture-proxy',
};
function cli(binary: string, home: string, args: string[]) {
  return execute(process.execPath, ['--experimental-strip-types', entrypoint, ...args], {
    env: { ...parentEnv, OPENGRANTER_CODEX_BIN: binary, OPENGRANTER_CODEX_HOME: home },
  });
}

test('login delegates device OAuth to official CLI with isolated private storage', () =>
  fixture(async (_, binary, home) => {
    const result = await cli(binary, home, ['login']);
    assert.match(result.stdout, /fixture-private-diagnostic/); // Only login owns the interactive terminal.
    assert.deepEqual((await readFile(join(home, 'args'), 'utf8')).trim().split('\n'), [
      '-c',
      'cli_auth_credentials_store="file"',
      '-c',
      'forced_login_method="chatgpt"',
      'login',
      '--device-auth',
    ]);
    assert.equal((await stat(home)).mode & 0o777, 0o700);
    assert.equal(await readFile(join(home, 'leaked-env'), 'utf8'), '');
    assert.equal(await readFile(join(home, 'child-home'), 'utf8'), home);
  }));
for (const action of ['status', 'logout'] as const)
  test(`${action} discards all child diagnostics`, () =>
    fixture(async (_, binary, home) => {
      await mkdir(home, { mode: 0o700 });
      const result = await cli(binary, home, [action]);
      assert.doesNotMatch(result.stdout + result.stderr, /fixture-private-diagnostic/);
      const args = (await readFile(join(home, 'args'), 'utf8')).trim().split('\n');
      assert.deepEqual(args.slice(4), action === 'status' ? ['login', 'status'] : ['logout']);
    }));

test('nonzero status and logout never relay private diagnostics', () =>
  fixture(async (_, binary, home) => {
    await mkdir(home, { mode: 0o700 });
    await writeFile(binary, '#!/bin/sh\necho fixture-secret >&2\nexit 1\n');
    for (const action of ['status', 'logout']) {
      await assert.rejects(cli(binary, home, [action]), (error: unknown) => {
        const value = error as Error & { stderr: string; stdout: string };
        assert.match(value.stderr, /Codex authentication command failed/);
        assert.doesNotMatch(value.stderr + value.stdout, /fixture-secret/);
        return true;
      });
    }
  }));

test('invalid actions, relative paths and missing executable fail before any child', () =>
  fixture(async (_, binary, home) => {
    for (const [exe, location, args] of [
      [binary, home, ['exec']],
      [binary, home, ['login', 'extra']],
      ['codex', home, ['login']],
      [binary, 'relative', ['login']],
      [join(home, 'missing'), home, ['login']],
    ] as const) {
      await assert.rejects(cli(exe, location, [...args]));
    }
    await assert.rejects(stat(join(home, 'args')));
  }));

test('insecure, symlink and default personal credential homes are rejected', () =>
  fixture(async (root, binary, home) => {
    await mkdir(home, { mode: 0o700 });
    await chmod(home, 0o755);
    await assert.rejects(cli(binary, home, ['login']));
    await chmod(home, 0o700);
    const link = join(root, 'alias');
    await symlink(home, link);
    await assert.rejects(cli(binary, link, ['login']));
    await assert.rejects(
      runCodexAuth({ action: 'login', binary, home: join(root, '.codex'), env: { HOME: root } }),
    );
    await assert.rejects(stat(join(home, 'args')));
  }));

test('concurrent operations are rejected without removing another lock', () =>
  fixture(async (_, binary, home) => {
    await mkdir(home, { mode: 0o700 });
    await mkdir(join(home, '.opengranter-auth.lock'));
    await assert.rejects(cli(binary, home, ['login']));
    assert.ok((await stat(join(home, '.opengranter-auth.lock'))).isDirectory());
    await assert.rejects(stat(join(home, 'args')));
  }));

test('timeouts are bounded and release only the owned lock', () =>
  fixture(async (_, binary, home) => {
    await writeFile(binary, '#!/bin/sh\nwhile :; do :; done\n');
    await assert.rejects(runCodexAuth({ action: 'status', binary, home, env: {}, timeoutMs: 50 })); // no home: no side effect
    await mkdir(home, { mode: 0o700 });
    await assert.rejects(runCodexAuth({ action: 'status', binary, home, env: {}, timeoutMs: 50 }), {
      message: 'Codex authentication command failed',
    });
    await assert.rejects(stat(join(home, '.opengranter-auth.lock')));
  }));

for (const reason of ['timeout', 'abort'] as const)
  test(
    `termination stops descendant processes: ${reason}`,
    { skip: process.platform !== 'linux' },
    () =>
      fixture(async (_, binary, home) => {
        await mkdir(home, { mode: 0o700 });
        await writeFile(
          binary,
          '#!/bin/sh\ntrap "" TERM\n/bin/sleep 30 &\necho $! > "$CODEX_HOME/descendant"\nwait\n',
        );
        const controller = new AbortController();
        const result = runCodexAuth({
          action: 'status',
          binary,
          home,
          env: {},
          timeoutMs: reason === 'timeout' ? 300 : 3000,
          signal: controller.signal,
        });
        const rejection = assert.rejects(result, {
          message: 'Codex authentication command failed',
        });
        let pid = 0;
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            pid = Number((await readFile(join(home, 'descendant'), 'utf8')).trim());
            break;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
        assert.ok(pid > 0);
        if (reason === 'abort') controller.abort();
        await new Promise((resolve) => setTimeout(resolve, reason === 'timeout' ? 450 : 100));
        assert.ok((await stat(join(home, '.opengranter-auth.lock'))).isDirectory());
        await rejection;
        let running = true;
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            running = !(await readFile(`/proc/${pid}/stat`, 'utf8')).includes(') Z ');
          } catch {
            running = false;
          }
          if (!running) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (running) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {}
        }
        assert.equal(running, false);
        await assert.rejects(stat(join(home, '.opengranter-auth.lock')));
      }),
  );

test('pre-cancelled login does not create credential storage', () =>
  fixture(async (_, binary, home) => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      runCodexAuth({ action: 'login', binary, home, env: {}, signal: controller.signal }),
      { message: 'Codex authentication command failed' },
    );
    await assert.rejects(stat(home), { code: 'ENOENT' });
  }));

test('login cancelled during executable validation does not create storage', () =>
  fixture(async (_, binary, home) => {
    const controller = new AbortController();
    const operation = runCodexAuth({
      action: 'login',
      binary,
      home,
      env: {},
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(operation, { message: 'Codex authentication command failed' });
    await assert.rejects(stat(home), { code: 'ENOENT' });
  }));
