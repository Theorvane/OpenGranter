import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
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
