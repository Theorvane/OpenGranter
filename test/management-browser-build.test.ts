import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';

async function fixture(run: (root: string, source: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'og-browser-build-'));
  const source = join(root, 'src/management');
  await mkdir(source, { recursive: true });
  try {
    await run(root, source);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function load(javascript: string) {
  return import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'));
}

test('bundles actual boundary renderer for a browser without runtime imports', async () => {
  const options = { root: resolve('.'), entry: 'src/management/boundary-view.ts' };
  const javascript = await buildManagementBrowser(options);
  assert.equal(await buildManagementBrowser(options), javascript);
  assert.match((await load(javascript)).renderManagementBoundaryView('denied'), /Access denied/);
  assert.doesNotMatch(javascript, /sourceMappingURL|node:|process\.env/);
});

test('bundles actual catalog lifecycle and starts without authority', async () => {
  const javascript = await buildManagementBrowser({
    root: resolve('.'),
    entry: 'src/management/catalog-session.ts',
  });
  const session = (await load(javascript)).createManagementCatalogSession();
  assert.deepEqual(session.snapshot(), { state: 'unauthenticated' });
  await session.list();
  assert.deepEqual(session.snapshot(), { state: 'unauthenticated' });
  session.authorize(async () => Response.json({ data: [] }));
  await session.list();
  assert.deepEqual(session.snapshot(), { state: 'empty' });
  session.dispose();
});

test('resolves transitive TypeScript imports in memory', async () =>
  fixture(async (root, source) => {
    await writeFile(join(source, 'value.ts'), 'export const value: number = 42;');
    await writeFile(join(source, 'entry.ts'), 'export { value } from "./value.ts";');
    const javascript = await buildManagementBrowser({ root, entry: 'src/management/entry.ts' });
    assert.equal((await load(javascript)).value, 42);
    assert.doesNotMatch(javascript, /from ["']\.\//);
  }));

test('rejects missing entry, outside entry and server modules', async () =>
  fixture(async (root, source) => {
    await writeFile(join(root, 'outside.ts'), 'export const privateValue = 1;');
    await assert.rejects(buildManagementBrowser({ root, entry: 'missing.ts' }));
    await assert.rejects(buildManagementBrowser({ root, entry: 'outside.ts' }));
    for (const specifier of ['node:fs', 'esbuild', '../../outside.ts']) {
      await writeFile(join(source, 'entry.ts'), 'import "' + specifier + '";');
      await assert.rejects(buildManagementBrowser({ root, entry: 'src/management/entry.ts' }));
    }
  }));

test('rejects symlink escape', async () =>
  fixture(async (root, source) => {
    await writeFile(join(root, 'outside.ts'), 'export const privateValue = 1;');
    await symlink(join(root, 'outside.ts'), join(source, 'linked.ts'));
    await writeFile(join(source, 'entry.ts'), 'export * from "./linked.ts";');
    await assert.rejects(buildManagementBrowser({ root, entry: 'src/management/entry.ts' }));
  }));

test('CLI emits only a browser module or a fixed error', () => {
  const script = 'scripts/build-management-browser.ts';
  const good = spawnSync(
    process.execPath,
    ['--experimental-strip-types', script, 'src/management/catalog-authority.ts'],
    { encoding: 'utf8' },
  );
  assert.equal(good.status, 0);
  assert.match(good.stdout, /createManagementCatalogAuthority/);
  assert.equal(good.stderr, '');
  for (const args of [
    [],
    ['private-invalid-source.ts'],
    ['src/management/boundary-view.ts', 'extra'],
    ['src/management/boundary-view.ts', '--output'],
    ['src/management/boundary-view.ts', '--output', ''],
  ]) {
    const bad = spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], {
      encoding: 'utf8',
    });
    assert.equal(bad.status, 1);
    assert.equal(bad.stdout, '');
    assert.equal(
      bad.stderr,
      'Management browser build failed; supply a reviewed local TypeScript entry.\n',
    );
  }
});

test('CLI publishes an importable artifact despite npm log banners', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'og-browser-publish-'));
  try {
    const output = join(directory, 'app.mjs');
    const result = spawnSync(
      'npm',
      ['run', 'management:build', '--', 'src/management/boundary-view.ts', '--output', output],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /management:build/);
    const javascript = await readFile(output, 'utf8');
    assert.match((await load(javascript)).renderManagementBoundaryView('denied'), /Access denied/);
    assert.equal((await lstat(output)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(directory), ['app.mjs']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI publication never replaces files or symlinks and removes staging', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'og-browser-publish-'));
  const script = resolve('scripts/build-management-browser.ts');
  const run = (entry: string, output: string) =>
    spawnSync(process.execPath, ['--experimental-strip-types', script, entry, '--output', output], {
      encoding: 'utf8',
    });
  try {
    const artifact = join(directory, 'app.js');
    const alias = join(directory, 'alias.js');
    await writeFile(artifact, 'previous-reviewed-module');
    await symlink(artifact, alias);
    for (const output of [artifact, alias, join(directory, 'missing', 'app.js')]) {
      const result = run('src/management/boundary-view.ts', output);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(
        result.stderr,
        'Management browser build failed; supply a reviewed local TypeScript entry.\n',
      );
    }
    assert.equal(await readFile(artifact, 'utf8'), 'previous-reviewed-module');
    assert.equal((await lstat(alias)).isSymbolicLink(), true);
    assert.equal(run('missing-entry.ts', join(directory, 'new.js')).status, 1);
    assert.deepEqual((await readdir(directory)).sort(), ['alias.js', 'app.js']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('explicit reviewed shared sources build without granting transitive access', async () =>
  fixture(async (root, source) => {
    const shared = join(root, 'src/usage');
    await mkdir(shared);
    await writeFile(join(shared, 'value.ts'), 'export { value } from "./dependency.ts";');
    await writeFile(join(shared, 'dependency.ts'), 'export const value: number = 42;');
    await writeFile(join(source, 'entry.ts'), 'export { value } from "../usage/value.ts";');
    const options = {
      root,
      entry: 'src/management/entry.ts',
      publicSources: ['src/usage/value.ts', 'src/usage/dependency.ts'],
    };
    assert.equal((await load(await buildManagementBrowser(options))).value, 42);
    await assert.rejects(
      buildManagementBrowser({ ...options, publicSources: ['src/usage/value.ts'] }),
    );
    await assert.rejects(buildManagementBrowser({ root, entry: options.entry }));
    await assert.rejects(buildManagementBrowser({ ...options, entry: 'src/usage/value.ts' }));
  }));

test('shared source grants reject escapes, non-TypeScript and server imports', async () =>
  fixture(async (root, source) => {
    await mkdir(join(root, 'src/shared'));
    await writeFile(join(root, 'outside.ts'), 'export const value = 1;');
    await writeFile(join(root, 'src/shared/value.json'), '{}');
    await symlink(join(root, 'outside.ts'), join(root, 'src/shared/link.ts'));
    await writeFile(join(source, 'entry.ts'), 'export const value = 1;');
    for (const grant of [
      'outside.ts',
      'src/shared/link.ts',
      'src/shared/value.json',
      join(source, 'entry.ts'),
      'missing.ts',
    ]) {
      await assert.rejects(
        buildManagementBrowser({ root, entry: 'src/management/entry.ts', publicSources: [grant] }),
      );
    }
    for (const specifier of ['node:fs', 'esbuild']) {
      await writeFile(
        join(root, 'src/shared/private.ts'),
        'import "' + specifier + '"; export const value = 1;',
      );
      await writeFile(join(source, 'entry.ts'), 'export { value } from "../shared/private.ts";');
      await assert.rejects(
        buildManagementBrowser({
          root,
          entry: 'src/management/entry.ts',
          publicSources: ['src/shared/private.ts'],
        }),
      );
    }
  }));

test('CLI requires each shared source explicitly and preserves fixed failure', async () =>
  fixture(async (root, source) => {
    await mkdir(join(root, 'src/shared'));
    await writeFile(join(root, 'src/shared/value.ts'), 'export const value = 42;');
    await writeFile(join(source, 'entry.ts'), 'export { value } from "../shared/value.ts";');
    const script = resolve('scripts/build-management-browser.ts');
    const run = (...args: string[]) =>
      spawnSync(
        process.execPath,
        ['--experimental-strip-types', script, 'src/management/entry.ts', ...args],
        { cwd: root, encoding: 'utf8' },
      );
    const good = run('--public-source', 'src/shared/value.ts');
    assert.equal(good.status, 0, good.stderr);
    assert.equal((await load(good.stdout)).value, 42);
    const output = join(root, 'app.js');
    assert.equal(run('--output', output, '--public-source', 'src/shared/value.ts').status, 0);
    assert.equal((await load(await readFile(output, 'utf8'))).value, 42);
    for (const args of [
      [],
      ['--public-source'],
      ['--public-source', '--output'],
      ['--unknown', 'value'],
      ['--output', output, '--output', output],
    ]) {
      const bad = run(...args);
      assert.equal(bad.status, 1);
      assert.equal(bad.stdout, '');
      assert.equal(
        bad.stderr,
        'Management browser build failed; supply a reviewed local TypeScript entry.\n',
      );
    }
  }));
