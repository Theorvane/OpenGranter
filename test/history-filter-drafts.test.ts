import assert from 'node:assert/strict';
import test from 'node:test';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { Element, nodes, text, tick } from './account-token-dom-fixture.ts';

const warning =
  'Unapplied filter edits. Records, pagination and CSV still use the applied filters.';
function button(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
}
function field(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'input' && n.attributes['aria-label'] === label);
  assert.ok(node, label);
  return node;
}
function edit(root: Element, label: string, value: string) {
  const node = field(root, label);
  node.value = value;
  node.listeners.input?.();
  return node;
}
for (const kind of ['Usage', 'Audit'] as const) {
  test(`${kind}: preserve private unapplied drafts across tabs and refresh without applying scope`, async () => {
    const root = new Element();
    const paths: string[] = [];
    const app = mountHistoryWorkspace(
      root,
      async (path) => {
        paths.push(path);
        if (path.includes('format=csv'))
          return new Response('header\n', {
            headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
          });
        return Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
      },
      { save: () => 'started', dispose() {} },
      'target',
    );
    await tick();
    if (kind === 'Audit') {
      button(root, 'Audit');
      await tick();
    }
    const before = paths.length;
    const stale = edit(root, 'Model', '팀/편집');
    edit(root, 'Principal', '');
    edit(root, 'Page size (1–100, blank for default)', '0');
    assert.equal(paths.length, before, 'typing sends no request');
    assert.ok(text(root).includes(warning));
    const status = nodes(root).find((n) => n.textContent === warning);
    assert.equal(status?.attributes.role, 'status');
    button(root, kind === 'Usage' ? 'Audit' : 'Usage');
    await tick();
    assert.equal(stale.value, '', 'detached private input cleared');
    stale.value = 'late-stale';
    stale.listeners.input?.();
    button(root, kind);
    await tick();
    assert.equal(field(root, 'Model').value, '팀/편집');
    assert.equal(field(root, 'Principal').value, '');
    assert.equal(field(root, 'Page size (1–100, blank for default)').value, '0');
    button(root, 'Refresh current page');
    await tick();
    assert.equal(field(root, 'Model').value, '팀/편집');
    const query = new URL(paths.at(-1) ?? '', 'http://localhost').searchParams;
    assert.equal(query.get('model'), null);
    assert.equal(query.get('principal_id'), 'target');
    assert.equal(query.get('limit'), null);
    button(root, 'Download current page CSV');
    await tick();
    const exported = new URL(paths.at(-1) ?? '', 'http://localhost').searchParams;
    assert.equal(exported.get('format'), 'csv');
    assert.equal(exported.get('model'), null);
    assert.equal(exported.get('principal_id'), 'target');
    assert.equal(field(root, 'Model').value, '팀/편집');
    assert.ok(text(root).includes(warning));
    const validCount = paths.length;
    button(root, 'Apply filters');
    await tick();
    assert.equal(paths.length, validCount, 'invalid draft never reaches transport');
    assert.match(text(root), /Invalid filters/);
    button(root, 'Reset filters');
    await tick();
    assert.equal(field(root, 'Principal').value, 'target');
    assert.equal(field(root, 'Model').value, '');
    assert.equal(field(root, 'Page size (1–100, blank for default)').value, '');
    assert.ok(!text(root).includes(warning));
    edit(root, 'Model', 'same');
    assert.ok(text(root).includes(warning));
    edit(root, 'Model', '');
    assert.ok(!text(root).includes(warning), 'restoring applied values clears warning');
    edit(root, 'Model', 'applied/모델');
    button(root, 'Apply filters');
    await tick();
    const applied = new URL(paths.at(-1) ?? '', 'http://localhost').searchParams;
    assert.equal(applied.get('model'), 'applied/모델');
    assert.equal(applied.get('principal_id'), 'target');
    assert.ok(!text(root).includes(warning));
    edit(root, 'Model', '');
    assert.ok(text(root).includes(warning), 'blank edit differs from applied model');
    button(root, 'Refresh current page');
    await tick();
    assert.equal(field(root, 'Model').value, '');
    assert.equal(
      new URL(paths.at(-1) ?? '', 'http://localhost').searchParams.get('model'),
      'applied/모델',
    );
    app.dispose();
  });
  test(`${kind}: pending responses retain drafts but denial and disposal retire their events`, async () => {
    const root = new Element();
    let pending: ((response: Response) => void) | undefined;
    let block = false;
    const paths: string[] = [];
    const app = mountHistoryWorkspace(
      root,
      async (path) => {
        paths.push(path);
        if (block)
          return new Promise<Response>((resolve) => {
            pending = resolve;
          });
        return Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
      },
      { save: () => 'started', dispose() {} },
      'target',
    );
    await tick();
    if (kind === 'Audit') {
      button(root, 'Audit');
      await tick();
    }
    block = true;
    button(root, 'Refresh current page');
    const loadingInput = edit(root, 'Model', 'pending-edit');
    assert.ok(pending);
    pending(Response.json({ object: 'list', data: [], has_more: false, next_cursor: null }));
    await tick();
    assert.equal(field(root, 'Model').value, 'pending-edit');
    assert.equal(loadingInput.value, '');
    button(root, 'Refresh current page');
    const retired = edit(root, 'Model', 'private');
    assert.ok(pending);
    pending(new Response(null, { status: 403 }));
    await tick();
    assert.equal(retired.value, '');
    assert.match(text(root), /Access denied/);
    const count = paths.length;
    retired.value = 'post-denial';
    retired.listeners.input?.();
    assert.equal(paths.length, count);
    assert.ok(!text(root).includes('private'));
    app.dispose();
    retired.listeners.input?.();
    assert.equal(text(root), '');
  });
}

test('request attempts discard unapplied edits and display the applied intersection', async () => {
  const root = new Element();
  const paths: string[] = [];
  const row = buildUsageRecord({
    principalId: 'target',
    credentialId: 'cred',
    policyVersions: [],
    requestId: 'request-1',
    attemptId: 'attempt-1',
    occurredAt: 100,
    modelAlias: 'applied-model',
    routeKind: 'managed',
    upstreamModelId: 'upstream',
    selectedCandidateId: 'candidate',
    latencyMs: 1,
    outcome: 'succeeded',
    possiblyBilled: false,
    possibleDuplicate: false,
  });
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      return Response.json({ object: 'list', data: [row], has_more: false, next_cursor: null });
    },
    { save: () => 'started', dispose() {} },
    'target',
  );
  await tick();
  edit(root, 'Model', 'applied-model');
  button(root, 'Apply filters');
  await tick();
  edit(root, 'Model', 'unapplied-model');
  edit(root, 'Principal', 'unapplied-principal');
  button(root, 'View attempts for this request');
  await tick();
  const query = new URL(paths.at(-1) ?? '', 'http://localhost').searchParams;
  assert.equal(query.get('model'), 'applied-model');
  assert.equal(query.get('principal_id'), 'target');
  assert.equal(query.get('request_id'), 'request-1');
  assert.equal(field(root, 'Model').value, 'applied-model');
  assert.equal(field(root, 'Principal').value, 'target');
  assert.equal(field(root, 'Request ID').value, 'request-1');
  assert.ok(!text(root).includes(warning));
  app.dispose();
});
