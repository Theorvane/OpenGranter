import assert from 'node:assert/strict';
import test from 'node:test';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { Element, nodes, text, tick } from './account-token-dom-fixture.ts';

function control(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  return node;
}
function click(root: Element, label: string) {
  control(root, label).listeners.click?.();
}
function edit(root: Element, label: string, value: string) {
  const node = nodes(root).find((n) => n.attributes['aria-label'] === label);
  assert.ok(node, label);
  node.value = value;
  node.listeners.input?.();
}
const requestId = 'req:A+1/@x';
const empty = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
function usage() {
  return Response.json({
    object: 'list',
    data: [
      buildUsageRecord({
        principalId: 'usage-target',
        credentialId: 'cred',
        policyVersions: [],
        requestId,
        attemptId: 'attempt',
        occurredAt: 100,
        modelAlias: 'chat',
        routeKind: 'managed',
        upstreamModelId: 'upstream',
        selectedCandidateId: 'candidate',
        latencyMs: 1,
        outcome: 'succeeded',
        possiblyBilled: false,
        possibleDuplicate: false,
      }),
    ],
    has_more: false,
    next_cursor: null,
  });
}
function fixture(status = 200) {
  const root = new Element();
  const paths: string[] = [];
  let resolve: ((response: Response) => void) | undefined;
  let signal: AbortSignal | undefined;
  let csvSignal: AbortSignal | undefined;
  let releaseCsv: ((response: Response) => void) | undefined;
  let saves = 0;
  const app = mountHistoryWorkspace(
    root,
    async (path, init) => {
      paths.push(path);
      if (new Headers(init.headers).get('accept') === 'text/csv') {
        csvSignal = init.signal ?? undefined;
        return new Promise<Response>((r) => {
          releaseCsv = r;
        });
      }
      const query = new URL(path, 'https://local.invalid');
      if (query.pathname.endsWith('/usage')) return usage();
      if (!query.searchParams.has('request_id')) return empty();
      signal = init.signal ?? undefined;
      if (status === 0)
        return new Promise<Response>((r) => {
          resolve = r;
        });
      return status === 200 ? empty() : new Response('PRIVATE', { status });
    },
    {
      save() {
        saves++;
        return 'started';
      },
      dispose() {},
    },
  );
  return {
    root,
    paths,
    app,
    signal: () => signal,
    csvSignal: () => csvSignal,
    release: () => resolve?.(empty()),
    releaseCsv: () => releaseCsv?.(new Response('PRIVATE', { status: 403 })),
    saves: () => saves,
  };
}
test('Usage request opens fresh self-scoped Audit without copying row identity', async () => {
  const f = fixture(0);
  await tick();
  click(f.root, 'View audit for this request');
  assert.match(text(f.root), /Loading history/);
  const url = new URL(f.paths.at(-1) ?? '', 'https://local.invalid');
  assert.equal(url.pathname.endsWith('/audit'), true);
  assert.equal(url.searchParams.get('request_id'), requestId);
  for (const field of ['principal_id', 'model', 'cursor'])
    assert.equal(url.searchParams.has(field), false);
  f.release();
  await tick();
  assert.match(text(f.root), /No history matches/);
  assert.match(text(f.root), /not proof of no decision/);
  f.app.dispose();
});
test('Usage investigation intersects applied Audit scope, resets drafts and cursor', async () => {
  const f = fixture();
  await tick();
  click(f.root, 'Audit');
  await tick();
  for (const [label, value] of [
    ['Principal', 'audit-target'],
    ['Model', 'applied-model'],
    ['From (UTC or Unix ms, inclusive)', '10'],
    ['To (UTC or Unix ms, exclusive)', '200'],
    ['Page size (1–100, blank for default)', '7'],
  ] as const)
    edit(f.root, label, value);
  click(f.root, 'Apply filters');
  await tick();
  edit(f.root, 'Model', 'unsubmitted-private');
  click(f.root, 'Usage');
  await tick();
  click(f.root, 'View audit for this request');
  await tick();
  const q = new URL(f.paths.at(-1) ?? '', 'https://local.invalid').searchParams;
  for (const [key, value] of [
    ['principal_id', 'audit-target'],
    ['model', 'applied-model'],
    ['from_ms', '10'],
    ['to_ms', '200'],
    ['limit', '7'],
    ['request_id', requestId],
  ] as const)
    assert.equal(q.get(key), value);
  assert.equal(q.has('cursor'), false);
  assert.equal(
    nodes(f.root).find((n) => n.attributes['aria-label'] === 'Model')?.value,
    'applied-model',
  );
  assert.doesNotMatch(text(f.root), /unsubmitted-private/);
  f.app.dispose();
});
for (const status of [401, 403, 503])
  test(`Usage to Audit fresh ${status} is sanitized and retires source control`, async () => {
    const f = fixture(status);
    await tick();
    const stale = control(f.root, 'View audit for this request');
    stale.listeners.click?.();
    await tick();
    assert.match(
      text(f.root),
      status === 401
        ? /Sign.in required/
        : status === 403
          ? /Access denied/
          : /History unavailable/,
    );
    assert.doesNotMatch(text(f.root), /PRIVATE|usage-target/);
    const count = f.paths.length;
    stale.listeners.click?.();
    await tick();
    assert.equal(f.paths.length, count);
    if (status === 503) {
      click(f.root, 'Retry');
      await tick();
      assert.equal(f.paths.length, count + 1);
    }
    f.app.dispose();
  });
test('Usage investigation disposal aborts pending Audit and discards late completion', async () => {
  const f = fixture(0);
  await tick();
  click(f.root, 'View audit for this request');
  f.app.dispose();
  assert.equal(f.signal()?.aborted, true);
  f.release();
  await tick();
  assert.equal(text(f.root), '');
});
test('Usage investigation cancels departing CSV; late denial cannot save or clear Audit', async () => {
  const f = fixture();
  await tick();
  click(f.root, 'Download current page CSV');
  await tick();
  click(f.root, 'View audit for this request');
  assert.equal(f.csvSignal()?.aborted, true);
  f.releaseCsv();
  await tick();
  assert.equal(f.saves(), 0);
  assert.match(text(f.root), /No history matches/);
  assert.doesNotMatch(text(f.root), /Access denied|PRIVATE/);
  f.app.dispose();
});
test('invalid applied Audit scope cannot broaden Usage investigation', async () => {
  const f = fixture();
  await tick();
  click(f.root, 'Audit');
  await tick();
  edit(f.root, 'From (UTC or Unix ms, inclusive)', 'invalid');
  click(f.root, 'Apply filters');
  await tick();
  click(f.root, 'Usage');
  await tick();
  const count = f.paths.length;
  click(f.root, 'View audit for this request');
  await tick();
  assert.match(text(f.root), /Invalid filters/);
  assert.equal(f.paths.length, count);
  f.app.dispose();
});

test('Usage to Audit renders authorized decision details and resets previous Audit pagination', async () => {
  const root = new Element();
  const paths: string[] = [];
  const cursor = '2';
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      if (path.includes('/usage')) return usage();
      const q = new URL(path, 'https://local.invalid').searchParams;
      return Response.json({
        object: 'list',
        data: [
          {
            eventId: q.has('cursor') ? '1' : '2',
            occurredAt: 100,
            kind: 'models-listed',
            requestId,
            principalId: 'audit-visible',
            credentialId: 'old',
            policyVersions: [],
            details: { count: 1, prompt: 'PRIVATE' },
          },
        ],
        has_more: !q.has('cursor'),
        next_cursor: q.has('cursor') ? null : cursor,
      });
    },
    { save: () => 'started', dispose() {} },
  );
  await tick();
  click(root, 'Audit');
  await tick();
  click(root, 'Next page');
  await tick();
  assert.equal(
    new URL(paths.at(-1) ?? '', 'https://local.invalid').searchParams.get('cursor'),
    cursor,
  );
  click(root, 'Usage');
  await tick();
  click(root, 'View audit for this request');
  await tick();
  const q = new URL(paths.at(-1) ?? '', 'https://local.invalid').searchParams;
  assert.equal(q.has('cursor'), false);
  assert.equal(q.get('request_id'), requestId);
  assert.match(text(root), /Event ID 2/);
  assert.match(text(root), /models-listed/);
  assert.doesNotMatch(text(root), /PRIVATE/);
  app.dispose();
});
test('retired Usage investigation controls remain inert after refresh, tab change and disposal', async () => {
  const f = fixture();
  await tick();
  const stale = control(f.root, 'View audit for this request');
  click(f.root, 'Refresh current page');
  await tick();
  let count = f.paths.length;
  stale.listeners.click?.();
  await tick();
  assert.equal(f.paths.length, count);
  const refreshed = control(f.root, 'View audit for this request');
  click(f.root, 'Audit');
  await tick();
  count = f.paths.length;
  refreshed.listeners.click?.();
  await tick();
  assert.equal(f.paths.length, count);
  f.app.dispose();
  refreshed.listeners.click?.();
  await tick();
  assert.equal(f.paths.length, count);
});
