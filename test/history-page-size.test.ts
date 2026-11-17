import assert from 'node:assert/strict';
import test from 'node:test';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { Element, nodes, text, tick } from './account-token-dom-fixture.ts';

function click(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
  return node;
}
function input(root: Element, value: string) {
  const node = nodes(root).find(
    (n) => n.attributes['aria-label'] === 'Page size (1–100, blank for default)',
  );
  assert.ok(node, 'Page size input');
  node.value = value;
  return node;
}
function fixture() {
  const root = new Element();
  const paths: string[] = [];
  const ui = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      if (path.includes('format=csv'))
        return new Response('header\n', { headers: { 'content-type': 'text/csv' } });
      const next = new URL(path, 'https://local.invalid').searchParams.has('cursor');
      const occurredAt = next ? 99 : 100;
      const id = next ? '1' : '2';
      const row = path.includes('/audit?')
        ? {
            eventId: id,
            occurredAt,
            kind: 'models-listed',
            requestId: 'req',
            principalId: 'human',
            credentialId: 'cred',
            policyVersions: [],
            details: { count: 1 },
          }
        : buildUsageRecord({
            principalId: 'human',
            credentialId: 'cred',
            policyVersions: [],
            requestId: 'req',
            attemptId: id,
            occurredAt,
            modelAlias: 'chat',
            routeKind: 'managed',
            upstreamModelId: 'up',
            selectedCandidateId: 'c',
            latencyMs: 1,
            outcome: 'succeeded',
            possiblyBilled: true,
            possibleDuplicate: false,
          });
      return Response.json({
        object: 'list',
        data: [row],
        has_more: !next,
        next_cursor: next
          ? null
          : path.includes('/audit?')
            ? '2'
            : Buffer.from(JSON.stringify([100, '2'])).toString('base64url'),
      });
    },
    { save: () => 'started', dispose() {} },
  );
  return { root, paths, ui };
}
for (const kind of ['usage', 'audit'] as const) {
  for (const size of ['1', '100', '']) {
    test(`${kind} applies page size ${size || 'default'} through next/previous/retry and CSV, not drafts`, async () => {
      const f = fixture();
      await tick();
      if (kind === 'audit') {
        click(f.root, 'Audit');
        await tick();
      }
      input(f.root, size);
      click(f.root, 'Apply filters');
      await tick();
      const applied = new URL(f.paths.at(-1) ?? '', 'https://local.invalid');
      assert.equal(applied.searchParams.get('limit'), size || null);
      assert.equal(applied.searchParams.has('cursor'), false);
      click(f.root, 'Next page');
      await tick();
      assert.ok(new URL(f.paths.at(-1) ?? '', 'https://local.invalid').searchParams.has('cursor'));
      input(f.root, '17'); // unsubmitted draft must not affect current-page export
      click(f.root, 'Download current page CSV');
      await tick();
      let q = new URL(f.paths.at(-1) ?? '', 'https://local.invalid').searchParams;
      assert.equal(q.get('format'), 'csv');
      assert.equal(q.get('limit'), size || null);
      assert.ok(q.has('cursor'));
      click(f.root, 'Previous page');
      await tick();
      click(f.root, 'Refresh current page');
      await tick();
      q = new URL(f.paths.at(-1) ?? '', 'https://local.invalid').searchParams;
      assert.equal(q.get('limit'), size || null);
      assert.equal(q.has('cursor'), false);
      input(f.root, '2');
      click(f.root, 'Apply filters');
      await tick();
      q = new URL(f.paths.at(-1) ?? '', 'https://local.invalid').searchParams;
      assert.equal(q.get('limit'), '2');
      assert.equal(q.has('cursor'), false);
      f.ui.dispose();
    });
  }
  for (const value of ['0', '101', '-1', '1.5', '1e2', ' 2', '02', '9007199254740992', 'oops']) {
    test(`${kind} rejects invalid page size ${JSON.stringify(value)} without broadening`, async () => {
      const f = fixture();
      await tick();
      if (kind === 'audit') {
        click(f.root, 'Audit');
        await tick();
      }
      const before = f.paths.length;
      input(f.root, value);
      click(f.root, 'Apply filters');
      await tick();
      assert.match(text(f.root), /Invalid filters/);
      assert.equal(f.paths.length, before);
      f.ui.dispose();
    });
  }
}
test('Usage and Audit keep independent page sizes and clear detached inputs on disposal', async () => {
  const f = fixture();
  await tick();
  input(f.root, '3');
  click(f.root, 'Apply filters');
  await tick();
  click(f.root, 'Audit');
  await tick();
  assert.equal(input(f.root, '7').value, '7');
  click(f.root, 'Apply filters');
  await tick();
  click(f.root, 'Usage');
  await tick();
  assert.equal(
    new URL(f.paths.at(-1) ?? '', 'https://local.invalid').searchParams.get('limit'),
    '3',
  );
  const old = input(f.root, '8');
  const stale = click(f.root, 'Apply filters');
  await tick();
  const before = f.paths.length;
  f.ui.dispose();
  assert.equal(old.value, '');
  stale.listeners.click?.();
  await tick();
  assert.equal(f.paths.length, before);
  assert.equal(text(f.root), '');
});

for (const direction of ['usage-to-audit', 'audit-to-usage'] as const) {
  test(`request investigation preserves destination page size: ${direction}`, async () => {
    const f = fixture();
    await tick();
    input(f.root, '3');
    click(f.root, 'Apply filters');
    await tick();
    click(f.root, 'Audit');
    await tick();
    input(f.root, '7');
    click(f.root, 'Apply filters');
    await tick();
    if (direction === 'usage-to-audit') {
      click(f.root, 'Usage');
      await tick();
    }
    click(
      f.root,
      direction === 'usage-to-audit'
        ? 'View audit for this request'
        : 'View usage for this request',
    );
    await tick();
    const q = new URL(f.paths.at(-1) ?? '', 'https://local.invalid').searchParams;
    assert.equal(q.get('limit'), direction === 'usage-to-audit' ? '7' : '3');
    assert.equal(q.get('request_id'), 'req');
    assert.equal(q.has('cursor'), false);
    f.ui.dispose();
  });
}
