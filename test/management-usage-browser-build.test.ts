import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { validAuditAttribution } from '../src/audit/attribution.ts';
import * as sharedAttribution from '../src/shared/usage/attribution.ts';
import * as sharedCost from '../src/shared/usage/cost-comparison.ts';
import * as sharedJson from '../src/shared/usage/json.ts';
import * as sharedRecord from '../src/shared/usage/record-usage.ts';
import * as sharedRow from '../src/shared/usage/stored-row.ts';
import { compareUsageCosts } from '../src/usage/cost-comparison.ts';
import { parseStoredUsageRecord } from '../src/usage/history.ts';
import { projectUsageJson } from '../src/usage/json.ts';
import { buildUsageRecord, InvalidUsageRecordInput } from '../src/usage/record-usage.ts';

async function bundle(entry: string) {
  const javascript = await buildManagementBrowser({ root: resolve('.'), entry });
  assert.doesNotMatch(javascript, /node:|process\.env|Buffer\.|sourceMappingURL/);
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
}
function row() {
  return buildUsageRecord({
    principalId: 'human',
    credentialId: 'historical',
    policyVersions: [],
    requestId: 'req',
    attemptId: 'attempt',
    occurredAt: 100,
    modelAlias: 'chat',
    routeKind: 'managed',
    upstreamModelId: 'upstream',
    selectedCandidateId: 'candidate',
    latencyMs: 2,
    outcome: 'succeeded',
    possiblyBilled: true,
    possibleDuplicate: true,
    estimatedCost: {
      amountDecimal: '9007199254740993.000000000000000001',
      currency: 'USD',
      priceVersion: 'v1',
    },
    upstreamBilledCost: {
      amountDecimal: '9007199254740993.000000000000000002',
      currency: 'USD',
      source: 'openrouter',
    },
  });
}
function page(value: unknown = row()) {
  return Response.json({ object: 'list', data: [value], has_more: false, next_cursor: null });
}

test('canonical browser build executes the actual usage JSON client without server runtime', async () => {
  const module = await bundle('src/management/usage-client.ts');
  const client = module.createSsoUsageClient(async () =>
    page({ ...row(), private: 'PRIVATE', costComparison: { status: 'reconciled' } }),
  );
  const result = await client.read();
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.data[0].costComparison, {
    status: 'reported_above_estimate',
    reportedMinusEstimated: '0.000000000000000001',
    currency: 'USD',
  });
  assert.equal(result.data[0].usage.status, 'missing');
  assert.equal(result.data[0].possibleDuplicate, true);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.equal(
    (
      await module
        .createSsoUsageClient(async () =>
          page({ ...row(), usage: { status: 'reported', promptTokens: -1 } }),
        )
        .read()
    ).state,
    'unavailable',
  );
});

test('canonical usage review artifact loads and explicitly exports, then clears on fresh denial', async () => {
  const module = await bundle('src/management/usage-review.ts');
  const paths: string[] = [];
  const states: string[] = [];
  let denied = false;
  const review = module.createUsageReview(
    async (path: string) => {
      paths.push(path);
      if (denied) return new Response(null, { status: 403 });
      if (path.includes('format=csv'))
        return new Response('attempt_id\nattempt\n', {
          headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
        });
      return page();
    },
    (snapshot: { state: string }) => states.push(snapshot.state),
  );
  await review.load({ model: 'chat' });
  assert.equal(review.snapshot().state, 'ready');
  assert.equal(paths.length, 1);
  assert.ok(states.includes('loading'));
  assert.equal((await review.exportCsv()).state, 'ready');
  assert.equal(paths.length, 2);
  denied = true;
  await review.load();
  assert.equal(review.snapshot().state, 'denied');
  assert.deepEqual(review.snapshot().data, []);
  await review.load();
  assert.equal(paths.length, 3);
  review.dispose();
});

test('shared build permission does not permit shared entry, server imports or symlink escapes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'og-usage-public-build-'));
  const source = join(root, 'src/management');
  const shared = join(root, 'src/shared/usage');
  try {
    await mkdir(source, { recursive: true });
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, 'json.ts'), 'export const value = 42;');
    await writeFile(join(source, 'entry.ts'), 'export {value} from "../shared/usage/json.ts";');
    const javascript = await buildManagementBrowser({ root, entry: 'src/management/entry.ts' });
    assert.equal(
      (await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`))
        .value,
      42,
    );
    await assert.rejects(buildManagementBrowser({ root, entry: 'src/shared/usage/json.ts' }));
    for (const specifier of ['../../../private.ts', './unreviewed.ts', 'node:fs']) {
      await writeFile(join(shared, 'json.ts'), `import "${specifier}"; export const value = 42;`);
      await writeFile(join(root, 'private.ts'), 'export const privateValue = 1;');
      await writeFile(join(shared, 'unreviewed.ts'), 'export const value = 1;');
      await assert.rejects(buildManagementBrowser({ root, entry: 'src/management/entry.ts' }));
    }
    await rm(join(shared, 'json.ts'));
    await symlink(join(root, 'private.ts'), join(shared, 'json.ts'));
    await assert.rejects(buildManagementBrowser({ root, entry: 'src/management/entry.ts' }));
    const linkedRoot = join(root, 'checkout-link');
    await symlink(root, linkedRoot, 'dir');
    await assert.rejects(
      buildManagementBrowser({ root: linkedRoot, entry: 'src/management/entry.ts' }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('server compatibility exports preserve canonical function and error identity', () => {
  assert.equal(buildUsageRecord, sharedRecord.buildUsageRecord);
  assert.equal(InvalidUsageRecordInput, sharedRecord.InvalidUsageRecordInput);
  assert.equal(parseStoredUsageRecord, sharedRow.parseStoredUsageRecord);
  assert.equal(projectUsageJson, sharedJson.projectUsageJson);
  assert.equal(compareUsageCosts, sharedCost.compareUsageCosts);
  assert.equal(validAuditAttribution, sharedAttribution.validAuditAttribution);
  assert.throws(() => sharedJson.projectUsageJson({}), InvalidUsageRecordInput);
});

test('canonical usage review builds identically through a symlink checkout root', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'og-usage-root-link-'));
  const root = join(scratch, 'checkout');
  try {
    await symlink(resolve('.'), root, 'dir');
    const entry = 'src/management/usage-review.ts';
    const direct = await buildManagementBrowser({ root: resolve('.'), entry });
    const linked = await buildManagementBrowser({ root, entry });
    assert.equal(linked, direct);
    const module = await import(
      `data:text/javascript;base64,${Buffer.from(linked).toString('base64')}`
    );
    const review = module.createUsageReview(async () => page());
    await review.load();
    assert.equal(review.snapshot().state, 'ready');
    review.dispose();
    await assert.rejects(buildManagementBrowser({ root, entry: 'src/shared/usage/json.ts' }));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
