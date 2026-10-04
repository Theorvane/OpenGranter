import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  openCodeConfig,
  openCodeEnvironment,
  runBoundedProcess,
} from '../scripts/opencode-process.ts';

test('OpenCode configuration registers one chat model and references only the proxy token', () => {
  const config = openCodeConfig('http://127.0.0.1:1234/api/v1');
  assert.equal(config.model, 'opengranter/chat');
  assert.equal(config.small_model, config.model);
  assert.deepEqual(config.enabled_providers, ['opengranter']);
  assert.equal(config.provider.opengranter.npm, '@ai-sdk/openai-compatible');
  assert.deepEqual(config.provider.opengranter.options, {
    baseURL: 'http://127.0.0.1:1234/api/v1',
    apiKey: '{env:OPENGRANTER_PROXY_TOKEN}',
  });
  assert.deepEqual(config.permission, { '*': 'deny' });
  assert.deepEqual(Object.keys(config.provider.opengranter.models), ['chat']);
});
test('isolated environment does not inherit provider credentials or custom configuration', () => {
  const env = openCodeEnvironment('/tmp/fixture', 'fixture-proxy-token');
  assert.equal(env.OPENGRANTER_PROXY_TOKEN, 'fixture-proxy-token');
  for (const key of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME'])
    assert.ok(env[key]?.startsWith('/tmp/fixture/'));
  assert.equal(env.OPENCODE_CONFIG, '/tmp/fixture/opencode.json');
  assert.equal(env.OPENCODE_DISABLE_EXTERNAL_SKILLS, 'true');
  assert.equal(env.OPENCODE_DISABLE_PROJECT_CONFIG, 'true');
  assert.equal(env.OPENCODE_DISABLE_MODELS_FETCH, 'true');
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.OPENCODE_CONFIG_CONTENT, undefined);
  assert.ok(
    !JSON.stringify(openCodeConfig('http://127.0.0.1:1/v1')).includes('fixture-proxy-token'),
  );
});
async function temporary(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'og-process-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test('bounded process captures a successful child without a shell', () =>
  temporary(async (root) => {
    assert.equal(
      await runBoundedProcess(
        process.execPath,
        ['-e', 'process.stdout.write("fixture-ok")'],
        root,
        {},
        1000,
      ),
      'fixture-ok',
    );
  }));
for (const [name, args] of [
  ['nonzero', ['-e', 'process.stderr.write("private-key"); process.exit(2)']],
  ['timeout', ['-e', 'setInterval(()=>{},1000)']],
  ['oversized', ['-e', 'process.stdout.write("x".repeat(1048577))']],
] as const)
  test(`bounded process sanitizes ${name} failures`, () =>
    temporary(async (root) => {
      await assert.rejects(
        runBoundedProcess(process.execPath, [...args], root, {}, name === 'timeout' ? 100 : 2000),
        { message: 'External client process failed' },
      );
    }));
test('missing client rejects explicitly without leaking command paths', () =>
  temporary(async (root) => {
    await assert.rejects(
      runBoundedProcess(join(root, 'private-missing-client'), [], root, {}, 1000),
      { message: 'External client process failed' },
    );
  }));
test('process preserves Unicode split across child output chunks', () =>
  temporary(async (root) => {
    const code =
      'const bytes=Buffer.from("fixture 終😀"); process.stdout.write(bytes.subarray(0,10)); setTimeout(()=>process.stdout.write(bytes.subarray(10)),50)';
    assert.equal(
      await runBoundedProcess(process.execPath, ['-e', code], root, {}, 1000),
      'fixture 終😀',
    );
  }));
test('observed process retains explicit nonzero exit and events for conformance assertions', () =>
  temporary(async (root) => {
    const { runBoundedProcessResult } = await import('../scripts/opencode-process.ts');
    assert.deepEqual(
      await runBoundedProcessResult(
        process.execPath,
        ['-e', 'process.stdout.write("fixture-error-event"); process.exit(1)'],
        root,
        {},
        1000,
      ),
      { code: 1, output: 'fixture-error-event' },
    );
  }));
test('read fixture configuration allows one project-relative file and denies every other tool/path', () => {
  assert.deepEqual(openCodeConfig('http://127.0.0.1:1234/v1', true).permission, {
    '*': 'deny',
    read: { '*': 'deny', 'fixture.txt': 'allow' },
  });
});
