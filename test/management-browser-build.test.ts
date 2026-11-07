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

test('builds the actual usage client and app through the restricted public builder', async () => {
  const javascript = await buildManagementBrowser({
    root: resolve('.'),
    entry: 'src/management/usage-client.ts',
  });
  assert.doesNotMatch(javascript, /Buffer|node:|process\.env|sourceMappingURL/);
  const api = await load(javascript);
  const client = api.createManagementUsageClient(async () =>
    Response.json({
      object: 'list',
      data: [],
      has_more: false,
      next_cursor: null,
    }),
  );
  assert.deepEqual(await client.list(), {
    state: 'ready',
    data: {
      records: [],
      hasMore: false,
      nextCursor: null,
    },
  });
  const app = await buildManagementBrowser({
    root: resolve('.'),
    entry: 'src/management/usage-app.ts',
  });
  assert.equal(typeof (await load(app)).mountManagementUsage, 'function');
  assert.doesNotMatch(app, /Buffer|node:|process\.env|sourceMappingURL/);
});

test('built usage client shares normalization, strips unexpected fields and preserves unknown costs', async () => {
  const { buildUsageRecord } = await import('../src/usage/record-usage.ts');
  const record = buildUsageRecord({
    principalId: 'human',
    credentialId: 'credential',
    policyVersions: [],
    requestId: 'request',
    attemptId: 'attempt',
    modelAlias: 'chat',
    routeKind: 'managed',
    upstreamModelId: 'model',
    selectedCandidateId: 'candidate',
    occurredAt: 1,
    latencyMs: 2,
    outcome: 'succeeded',
    possiblyBilled: true,
    possibleDuplicate: true,
  });
  const api = await load(
    await buildManagementBrowser({
      root: resolve('.'),
      entry: 'src/management/usage-client.ts',
    }),
  );
  let invalid = false;
  const client = api.createManagementUsageClient(async () =>
    Response.json({
      object: 'list',
      data: [
        {
          ...record,
          prompt: 'not-public',
          secret: 'not-public',
          ...(invalid ? { usage: { ...record.usage, totalTokens: -1 } } : {}),
        },
      ],
      has_more: false,
      next_cursor: null,
    }),
  );
  const result = await client.list();
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.data.records, [record]);
  assert.equal(result.data.records[0].usage.totalTokens, null);
  assert.equal(result.data.records[0].estimatedCost, null);
  assert.equal(result.data.records[0].upstreamBilledCost, null);
  invalid = true;
  assert.deepEqual(await client.list(), { state: 'unavailable' });
});

test('shared public dependencies cannot be entries or expand to server directories', async () => {
  for (const entry of [
    'src/usage/record-parser.ts',
    'src/usage/record-usage.ts',
    'src/audit/attribution.ts',
    'src/export/csv.ts',
  ]) {
    await assert.rejects(buildManagementBrowser({ root: resolve('.'), entry }));
  }
  await fixture(async (root, source) => {
    await mkdir(join(root, 'src/usage'));
    await writeFile(join(root, 'src/usage/history.ts'), 'export const value = 1;');
    await writeFile(join(source, 'entry.ts'), 'export * from "../usage/history.ts";');
    await assert.rejects(buildManagementBrowser({ root, entry: 'src/management/entry.ts' }));
    // A future import added to a reviewed shared module still fails closed.
    await writeFile(join(root, 'src/usage/record-parser.ts'), 'export * from "./history.ts";');
    await writeFile(join(source, 'entry.ts'), 'export * from "../usage/record-parser.ts";');
    await assert.rejects(buildManagementBrowser({ root, entry: 'src/management/entry.ts' }));
  });
});

test('shared allowlist checks canonical paths, not symlink names', async () =>
  fixture(async (root, source) => {
    await mkdir(join(root, 'src/usage'));
    await writeFile(join(root, 'outside.ts'), 'export const privateValue = 1;');
    await symlink(join(root, 'outside.ts'), join(root, 'src/usage/record-parser.ts'));
    await writeFile(join(source, 'entry.ts'), 'export * from "../usage/record-parser.ts";');
    await assert.rejects(buildManagementBrowser({ root, entry: 'src/management/entry.ts' }));
  }));

test('CSV encoder allowance does not include sibling modules or their transitive imports', async () =>
  fixture(async (root, source) => {
    await mkdir(join(root, 'src/export'));
    await writeFile(join(root, 'src/export/private.ts'), 'export const value = 1;');
    await writeFile(join(source, 'entry.ts'), 'export * from "../export/private.ts";');
    await assert.rejects(buildManagementBrowser({ root, entry: 'src/management/entry.ts' }));
    await writeFile(join(root, 'src/export/csv.ts'), 'export * from "./private.ts";');
    await writeFile(join(source, 'entry.ts'), 'export * from "../export/csv.ts";');
    await assert.rejects(buildManagementBrowser({ root, entry: 'src/management/entry.ts' }));
  }));
