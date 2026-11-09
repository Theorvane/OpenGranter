import assert from 'node:assert/strict';
import test from 'node:test';
import { mountManagementUsage } from '../src/management/usage-app.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { TokenElement } from './token-management-dom-fixture.ts';

const cursor = Buffer.from(JSON.stringify([2, 'attempt'])).toString('base64url');
const row = buildUsageRecord({
  principalId: 'human',
  credentialId: 'credential',
  policyVersions: [],
  requestId: 'req+1',
  attemptId: 'attempt',
  modelAlias: '<img src=x onerror=alert(1)>',
  routeKind: 'managed',
  upstreamModelId: 'model',
  selectedCandidateId: 'candidate',
  occurredAt: 2,
  latencyMs: 10,
  outcome: 'succeeded',
  possiblyBilled: true,
  possibleDuplicate: false,
});
const response = (rows: unknown[] = [row]) =>
  new Response(
    JSON.stringify({
      object: 'list',
      data: rows,
      has_more: false,
      next_cursor: null,
    }),
    { headers: { 'content-type': 'application/json' } },
  );

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const input = (root: TokenElement, label: string) => {
  const n = root.all().find((n) => n.tag === 'label' && n.textContent === label)?.children[0];
  assert.ok(n);
  return n;
};

test('usage retry preserves exact failed second-page scope and backstack, not drafts', async () => {
  const root = new TokenElement();
  const paths: string[] = [];
  let fail = false;
  const app = mountManagementUsage(root, { now: () => 1, schedule: () => () => {} });
  await app.authorize({
    expiresAt: 100,
    request: async (path) => {
      paths.push(path);
      if (fail) return new Response(null, { status: 503 });
      return Response.json({
        object: 'list',
        data: [row],
        has_more: !path.includes('cursor='),
        next_cursor: path.includes('cursor=') ? null : cursor,
      });
    },
  });
  input(root, 'Request ID').value = 'req+1';
  input(root, 'Page size (1–100)').value = '1';
  root.button('Apply filters').click();
  await settle();
  fail = true;
  root.button('Next page').click();
  await settle();
  const failed = paths.at(-1);
  assert.match(root.text(), /Usage unavailable/);
  assert.doesNotMatch(root.text(), /Inspect attempt/);
  input(root, 'Request ID').value = 'unsubmitted';
  fail = false;
  root.button('Retry current page').click();
  await settle();
  assert.equal(paths.at(-1), failed);
  assert.equal(input(root, 'Request ID').value, 'req+1');
  root.button('Previous page').click();
  await settle();
  const q = new URL(paths.at(-1) ?? '', 'https://test.invalid').searchParams;
  assert.equal(q.get('request_id'), 'req+1');
  assert.equal(q.has('cursor'), false);
  app.dispose();
});

test('usage retry clears CSV/details, survives cancellation and ignores stale/busy controls', async () => {
  const root = new TokenElement();
  const paths: string[] = [];
  let held: ((r: Response) => void) | undefined;
  let hold = false;
  let denied = false;
  const app = mountManagementUsage(root, { now: () => 1, schedule: () => () => {} });
  await app.authorize({
    expiresAt: 100,
    request: async (path) => {
      paths.push(path);
      if (denied) return new Response(null, { status: 403 });
      if (hold)
        return new Promise<Response>((resolve) => {
          held = resolve;
        });
      if (path.includes('format=csv'))
        return new Response('private-csv', {
          headers: { 'content-type': 'text/csv', 'x-usage-has-more': 'false' },
        });
      return response();
    },
  });
  root.button('Export current page CSV').click();
  await settle();
  assert.match(root.text(), /Download usage.csv/);
  const old = root.button('Refresh current page');
  hold = true;
  old.click();
  assert.match(root.text(), /Loading usage/);
  assert.doesNotMatch(root.text(), /Download usage.csv|Inspect attempt/);
  const count = paths.length;
  old.click();
  assert.equal(paths.length, count);
  root.button('Cancel request').click();
  assert.match(root.text(), /Request cancelled/);
  const retry = root.button('Retry current page');
  retry.click();
  const current = held;
  assert.ok(current);
  const reads = paths.length;
  retry.click();
  assert.equal(paths.length, reads);
  current(response());
  await settle();
  hold = false;
  denied = true;
  root.button('Refresh current page').click();
  await settle();
  assert.match(root.text(), /Access denied/);
  retry.click();
  assert.equal(paths.length, reads + 1);
  app.dispose();
});

test('invalid filters and expired grants cannot use retry controls', async () => {
  const root = new TokenElement();
  let time = 1;
  let reads = 0;
  const app = mountManagementUsage(root, { now: () => time, schedule: () => () => {} });
  await app.authorize({
    expiresAt: 10,
    request: async () => {
      reads++;
      return response();
    },
  });
  const old = root.button('Refresh current page');
  input(root, 'Page size (1–100)').value = '0';
  root.button('Apply filters').click();
  await settle();
  assert.match(root.text(), /Invalid usage filters/);
  assert.equal(
    root.all().some((n) => n.textContent === 'Retry current page'),
    false,
  );
  old.click();
  assert.equal(reads, 1);
  root.button('Clear filters').click();
  await settle();
  const refresh = root.button('Refresh current page');
  time = 10;
  refresh.click();
  assert.match(root.text(), /Session expired/);
  assert.equal(reads, 2);
  app.dispose();
});

test('CSV failure and cancellation recover the same second page with its previous query', async () => {
  for (const mode of ['csv', 'cancel'] as const) {
    const root = new TokenElement();
    const paths: string[] = [];
    let hold = false;
    const app = mountManagementUsage(root);
    await app.connect(async (path) => {
      paths.push(path);
      if (path.includes('format=csv')) return new Response(null, { status: 503 });
      if (hold) return new Promise<Response>(() => {});
      const second = path.includes('cursor=');
      return Response.json({
        object: 'list',
        data: [row],
        has_more: !second,
        next_cursor: second ? null : cursor,
      });
    });
    root.button('Next page').click();
    await settle();
    const second = paths.at(-1);
    if (mode === 'csv') {
      root.button('Export current page CSV').click();
      await settle();
      assert.match(root.text(), /Usage unavailable/);
    } else {
      hold = true;
      root.button('Refresh current page').click();
      root.button('Cancel request').click();
      assert.match(root.text(), /Request cancelled/);
      hold = false;
    }
    root.button('Retry current page').click();
    await settle();
    assert.equal(paths.at(-1), second);
    root.button('Previous page').click();
    await settle();
    assert.equal(
      new URL(paths.at(-1) ?? '', 'https://test.invalid').searchParams.has('cursor'),
      false,
    );
    app.dispose();
  }
});
