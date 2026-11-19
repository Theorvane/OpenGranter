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

test('bundles real usage/audit DOM adapters with pure shared runtime only', async () => {
  const javascript = await buildManagementBrowser({
    root: resolve('.'),
    entry: 'src/management/review-app.ts',
  });
  const app = await load(javascript);
  assert.equal(typeof app.mountSsoUsageReview, 'function');
  assert.equal(typeof app.mountSsoAuditReview, 'function');
  assert.doesNotMatch(javascript, /Buffer|process\.env|INSERT INTO|node:|sourceMappingURL/);
});

test('shared allowlist rejects persistence, unreviewed files and transitive externals', async () =>
  fixture(async (root, source) => {
    await mkdir(join(root, 'src/usage'), { recursive: true });
    for (const file of ['history.ts', 'postgres-ledger.ts', 'unreviewed.ts']) {
      await writeFile(join(root, 'src/usage', file), 'export const secret = 1;');
      await writeFile(join(source, 'entry.ts'), 'export * from "../usage/' + file + '";');
      await assert.rejects(buildManagementBrowser({ root, entry: 'src/management/entry.ts' }));
    }
    await writeFile(join(root, 'src/usage/json.ts'), 'import "node:fs"; export const value = 1;');
    await writeFile(join(source, 'entry.ts'), 'export * from "../usage/json.ts";');
    await assert.rejects(buildManagementBrowser({ root, entry: 'src/management/entry.ts' }));
    await rm(join(root, 'src/usage/json.ts'));
    await writeFile(join(root, 'outside.ts'), 'export const secret = 1;');
    await symlink(join(root, 'outside.ts'), join(root, 'src/usage/json.ts'));
    await assert.rejects(buildManagementBrowser({ root, entry: 'src/management/entry.ts' }));
  }));
