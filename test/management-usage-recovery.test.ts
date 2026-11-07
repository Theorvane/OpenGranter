import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { mountManagementUsage as source } from '../src/management/usage-app.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { TokenElement } from './token-management-dom-fixture.ts';

const javascript = await buildManagementBrowser({
  root: process.cwd(),
  entry: 'src/management/usage-app.ts',
});
const built = (await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
)) as { mountManagementUsage: typeof source };
const cursor = 'opaque_returned_cursor';
const row = buildUsageRecord({
  principalId: 'human',
  credentialId: 'credential',
  policyVersions: [],
  requestId: 'request',
  attemptId: 'attempt',
  modelAlias: 'team/model',
  routeKind: 'managed',
  upstreamModelId: 'model',
  selectedCandidateId: 'candidate',
  occurredAt: 2,
  latencyMs: 1,
  outcome: 'succeeded',
  possiblyBilled: false,
  possibleDuplicate: false,
});
const response = (more = false) =>
  Response.json({
    object: 'list',
    data: more ? [row] : [],
    has_more: more,
    next_cursor: more ? cursor : null,
  });
async function waitFor(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(check(), 'UI settled');
}
for (const [name, mount] of [
  ['source', source],
  ['built', built.mountManagementUsage],
] as const) {
  for (const failure of ['transport', 'malformed', '503'] as const) {
    test(`${name}: explicit current usage page retry after ${failure} preserves scope/history`, async (t) => {
      const root = new TokenElement();
      const app = mount(root, { now: () => 100, schedule: () => () => {} });
      t.after(() => app.dispose());
      const paths: string[] = [];
      let failed = false;
      const request = async (path: string) => {
        paths.push(path);
        if (failed) {
          if (failure === 'transport') throw Error('PRIVATE');
          if (failure === 'malformed') return Response.json({ private: 'PRIVATE' });
          return new Response('PRIVATE', { status: 503 });
        }
        return response(!new URL(path, 'http://localhost').searchParams.has('cursor'));
      };
      await app.authorize({ request, expiresAt: 200 }, 'team/model');
      failed = true;
      root.button('Next page').click();
      await waitFor(() => root.text().includes('unavailable'));
      const target = paths.at(-1);
      assert.match(target ?? '', /cursor=opaque_returned_cursor/);
      assert.match(target ?? '', /model=team%2Fmodel/);
      assert.doesNotMatch(root.text(), /PRIVATE|Download usage/);
      const before = paths.length;
      await new Promise((resolve) => setTimeout(resolve, 15));
      assert.equal(paths.length, before, 'no automatic retry');
      const retry = root.button('Retry current usage page');
      failed = false;
      retry.click();
      retry.click();
      await waitFor(() => root.text().includes('No usage records.'));
      assert.equal(paths.length, before + 1, 'double click sends one GET');
      assert.equal(paths.at(-1), target, 'same submitted target, no first-page hop');
      retry.click();
      assert.equal(paths.length, before + 1, 'detached retry is inert');
      root.button('Previous page').click();
      await waitFor(() => root.text().includes('Next page'));
      assert.equal(
        new URL(paths.at(-1) ?? '', 'http://localhost').searchParams.has('cursor'),
        false,
      );
      assert.match(paths.at(-1) ?? '', /model=team%2Fmodel/);
    });
  }
  for (const transition of ['renew', 'clear', 'expire', 'navigate', 'dispose'] as const) {
    test(`${name}: detached usage retry cannot dispatch after ${transition}`, async (t) => {
      const root = new TokenElement();
      let time = 100;
      let reads = 0;
      const app = mount(root, { now: () => time, schedule: () => () => {} });
      t.after(() => app.dispose());
      const grant = {
        expiresAt: 200,
        request: async () => {
          reads++;
          return new Response(null, { status: 503 });
        },
      };
      await app.authorize(grant);
      const retry = root.button('Retry current usage page');
      if (transition === 'renew') await app.authorize(grant);
      if (transition === 'clear') app.clear();
      if (transition === 'expire') time = 200;
      if (transition === 'navigate') {
        root.button('Clear filters').click();
        await waitFor(() => root.text().includes('unavailable'));
      }
      if (transition === 'dispose') app.dispose();
      const before = reads;
      retry.click();
      assert.equal(reads, before);
    });
  }
  test(`${name}: failed CSV does not offer or replay a JSON-page recovery`, async (t) => {
    const root = new TokenElement();
    const app = mount(root);
    t.after(() => app.dispose());
    const paths: string[] = [];
    await app.connect(async (path) => {
      paths.push(path);
      return path.includes('format=csv') ? new Response(null, { status: 503 }) : response();
    });
    root.button('Export current page CSV').click();
    await waitFor(() => root.text().includes('unavailable'));
    assert.doesNotMatch(root.text(), /Retry current usage page|Download usage/);
    assert.equal(paths.length, 2);
  });
  test(`${name}: retry uses submitted scope, not unsubmitted form edits`, async (t) => {
    const root = new TokenElement();
    const app = mount(root, { now: () => 100, schedule: () => () => {} });
    t.after(() => app.dispose());
    const paths: string[] = [];
    await app.authorize(
      {
        expiresAt: 200,
        request: async (path) => {
          paths.push(path);
          return new Response(null, { status: 503 });
        },
      },
      'team/model',
    );
    for (const input of root.all().filter((node) => node.tag === 'input'))
      input.value = 'UNSUBMITTED';
    const target = paths[0];
    root.button('Retry current usage page').click();
    await waitFor(() => root.text().includes('unavailable'));
    assert.deepEqual(paths, [target, target]);
  });
  for (const status of [400, 401, 403]) {
    test(`${name}: ${status} has no current-page recovery`, async (t) => {
      const root = new TokenElement();
      const app = mount(root);
      t.after(() => app.dispose());
      await app.connect(async () => new Response(null, { status }));
      assert.doesNotMatch(root.text(), /Retry current usage page/);
    });
  }
}
