import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';

const directory = new URL('../migrations/', import.meta.url);
const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
const unavailable = {
  name: 'MigrationSourceUnavailable',
  message: 'Migration sources unavailable',
};

async function fixture(run: (path: string, url: URL) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'opengranter-migrations-'));
  const path = join(root, 'bundle');
  try {
    await cp(directory, path, { recursive: true });
    await run(path, pathToFileURL(path));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('default bundle includes every shipped migration in order with unchanged SQL bytes', async () => {
  const loaded = await loadPostgresMigrationSources();
  assert.equal(loaded.length, names.length);
  for (const [index, name] of names.entries()) {
    assert.deepEqual(loaded[index], {
      version: name.slice(0, 3),
      sql: await readFile(new URL(name, directory), 'utf8'),
    });
  }
});

test('trusted deployment directory preserves whitespace and ignores non-SQL notes', async () => {
  await fixture(async (path, url) => {
    const first = names[0];
    assert.ok(first);
    const sql = `\n${await readFile(join(path, first), 'utf8')}\r\n-- preserved trailing comment\n`;
    await writeFile(join(path, first), sql);
    await writeFile(join(path, 'README.md'), 'deployment note');
    const loaded = await loadPostgresMigrationSources(url);
    assert.equal(loaded[0]?.sql, sql);
    assert.equal(loaded.length, names.length);
  });
});

test('missing final SQL file is rejected even without database history', async () => {
  await fixture(async (path, url) => {
    const last = names.at(-1);
    assert.ok(last);
    await rm(join(path, last));
    await assert.rejects(loadPostgresMigrationSources(url), unavailable);
  });
});

test('unregistered and duplicate-version SQL entries fail rather than silently joining the bundle', async () => {
  for (const name of ['009_unregistered.sql', '001_shadow.sql', 'extra.SQL']) {
    await fixture(async (path, url) => {
      await writeFile(join(path, name), 'SELECT 1;');
      await assert.rejects(loadPostgresMigrationSources(url), unavailable);
    });
  }
});

test('SQL symlinks and directories are rejected', async () => {
  for (const kind of ['symlink', 'directory']) {
    await fixture(async (path, url) => {
      const first = names[0];
      assert.ok(first);
      await rm(join(path, first));
      if (kind === 'symlink') await symlink(new URL(first, directory), join(path, first));
      else await mkdir(join(path, first));
      await assert.rejects(loadPostgresMigrationSources(url), unavailable);
    });
  }
});

test('empty SQL and unreadable locations expose fixed errors without paths or causes', async () => {
  await fixture(async (path, url) => {
    const first = names[0];
    assert.ok(first);
    await writeFile(join(path, first), ' \n\t');
    await assert.rejects(loadPostgresMigrationSources(url), unavailable);
    await assert.rejects(
      loadPostgresMigrationSources(pathToFileURL(join(path, 'private-missing-path'))),
      (error: unknown) => {
        assert.equal((error as Error).name, unavailable.name);
        assert.equal((error as Error).message, unavailable.message);
        assert.equal((error as Error).cause, undefined);
        return true;
      },
    );
    await assert.rejects(
      loadPostgresMigrationSources(new URL('https://invalid.example/private')),
      unavailable,
    );
  });
});
