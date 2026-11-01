import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, mkdir, realpath, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export type CodexAuthAction = 'login' | 'status' | 'logout';
export interface CodexAuthOptions {
  readonly action: CodexAuthAction;
  readonly binary: string;
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

function failure(): Error {
  // Neither OS errors nor child diagnostics belong in application logs.
  return new Error('Codex authentication command failed');
}

async function prepareHome(options: CodexAuthOptions): Promise<void> {
  const { home, env } = options;
  if (
    !process.getuid ||
    !isAbsolute(home) ||
    resolve(home) !== home ||
    home === join(env.HOME ?? homedir(), '.codex') ||
    (await realpath(dirname(home))) !== dirname(home)
  )
    throw failure();
  if (options.signal?.aborted) throw failure();
  try {
    if (options.action === 'login') await mkdir(home, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw failure();
  }
  const info = await lstat(home);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid() ||
    (info.mode & 0o777) !== 0o700
  )
    throw failure();
}

function childEnvironment(options: CodexAuthOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    HOME: options.home,
    CODEX_HOME: options.home,
    XDG_CONFIG_HOME: join(options.home, 'config'),
    XDG_DATA_HOME: join(options.home, 'data'),
    XDG_CACHE_HOME: join(options.home, 'cache'),
    XDG_STATE_HOME: join(options.home, 'state'),
  };
  for (const name of ['PATH', 'LANG', 'LC_ALL', 'TERM', 'COLORTERM', 'NO_COLOR']) {
    const value = options.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function runChild(options: CodexAuthOptions, timeoutMs: number): Promise<void> {
  return new Promise((accept, reject) => {
    if (options.signal?.aborted) {
      reject(failure());
      return;
    }
    const args = ['-c', 'cli_auth_credentials_store="file"', '-c', 'forced_login_method="chatgpt"'];
    args.push(
      ...(options.action === 'login'
        ? ['login', '--device-auth']
        : options.action === 'status'
          ? ['login', 'status']
          : ['logout']),
    );
    const child = spawn(options.binary, args, {
      shell: false,
      detached: true,
      cwd: options.home,
      env: childEnvironment(options),
      // The official login UI owns the protected operator terminal. Never capture its output.
      stdio: options.action === 'login' ? 'inherit' : 'ignore',
    });
    let stopped = false;
    let stoppedCleanup: Promise<void> | undefined;
    const killGroup = (signal: NodeJS.Signals) => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, signal);
        } catch {
          /* Already exited. */
        }
      }
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      killGroup('SIGTERM');
      // Keep the lock through the grace period even if the launcher exits first.
      stoppedCleanup = new Promise<void>((done) =>
        setTimeout(() => {
          killGroup('SIGKILL');
          done();
        }, 1000),
      );
    };
    const timer = setTimeout(stop, timeoutMs);
    options.signal?.addEventListener('abort', stop, { once: true });
    child.once('close', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', stop);
      const finish = () => {
        if (code === 0 && !stopped) accept();
        else reject(failure());
      };
      if (stoppedCleanup) void stoppedCleanup.then(finish);
      else finish();
    });
    // Spawn errors are followed by close. Keep their details private.
    child.once('error', () => {
      stopped = true;
    });
  });
}

/** Operator-only authentication management. This never performs inference or exports tokens. */
export async function runCodexAuth(options: CodexAuthOptions): Promise<void> {
  const timeoutMs = options.timeoutMs ?? (options.action === 'login' ? 960_000 : 15_000);
  let ownedLock: string | undefined;
  let failed = false;
  try {
    if (
      options.signal?.aborted ||
      !['login', 'status', 'logout'].includes(options.action) ||
      !isAbsolute(options.binary) ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 960_000
    )
      throw failure();
    await access(options.binary, constants.X_OK);
    if (!(await lstat(await realpath(options.binary))).isFile()) throw failure();
    await prepareHome(options);
    const lock = join(options.home, '.opengranter-auth.lock');
    await mkdir(lock, { mode: 0o700 });
    ownedLock = lock;
    await runChild(options, timeoutMs);
  } catch {
    failed = true;
  } finally {
    if (ownedLock) {
      try {
        await rmdir(ownedLock);
      } catch {
        failed = true;
      }
    }
  }
  if (failed) throw failure();
}
