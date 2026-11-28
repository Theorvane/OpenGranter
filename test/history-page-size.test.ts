import assert from 'node:assert/strict';
import test from 'node:test';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { Element, nodes, text, tick } from './account-token-dom-fixture.ts';

const label = 'Page size (1–100, blank for default)';
const empty = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
function input(root: Element, value: string) {
  const node = nodes(root).find((n) => n.attributes['aria-label'] === label);
  assert.ok(node, 'canonical page size input');
  node.value = value;
}
function click(root: Element, name: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === name);
  assert.ok(node, name);
  node.listeners.click?.();
}
for (const kind of ['usage', 'audit'] as const) {
  test(`${kind}: page size validates locally, survives CSV/refresh and resets independently`, async () => {
    const root = new Element();
    const paths: string[] = [];
    const app = mountHistoryWorkspace(
      root,
      async (path) => {
        paths.push(path);
        return path.includes('format=csv')
          ? new Response('header\n', {
              headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
            })
          : empty();
      },
      { save: () => 'started', dispose() {} },
      'target',
    );
    await tick();
    if (kind === 'audit') {
      click(root, 'Audit');
      await tick();
    }
    const query = () => new URL(paths.at(-1) ?? '', 'http://localhost').searchParams;
    for (const invalid of ['0', '101', '-1', '1.5', '01', '1e1', 'NaN', ' 2', '9007199254740992']) {
      input(root, invalid);
      const before = paths.length;
      click(root, 'Apply filters');
      await tick();
      assert.equal(paths.length, before, invalid);
      assert.match(text(root), /Invalid filters/);
    }
    for (const valid of ['1', '100']) {
      input(root, valid);
      click(root, 'Apply filters');
      await tick();
      assert.equal(query().get('limit'), valid);
      assert.equal(query().get('principal_id'), 'target');
      click(root, 'Refresh current page');
      await tick();
      assert.equal(query().get('limit'), valid);
      click(root, 'Download current page CSV');
      await tick();
      assert.equal(query().get('format'), 'csv');
      assert.equal(query().get('limit'), valid);
    }
    click(root, kind === 'usage' ? 'Audit' : 'Usage');
    await tick();
    input(root, '7');
    click(root, 'Apply filters');
    await tick();
    click(root, kind === 'usage' ? 'Usage' : 'Audit');
    await tick();
    assert.equal(query().get('limit'), '100');
    click(root, 'Clear filters');
    await tick();
    assert.equal(query().has('limit'), false);
    click(root, kind === 'usage' ? 'Audit' : 'Usage');
    await tick();
    assert.equal(query().get('limit'), '7');
    input(root, '');
    click(root, 'Apply filters');
    await tick();
    assert.equal(query().has('limit'), false);
    app.dispose();
  });
}

test('page size remains intersected with exact model, principal and cursor on JSON and CSV', async () => {
  const root = new Element();
  const paths: string[] = [];
  const cursor = Buffer.from(JSON.stringify([100, 'a'])).toString('base64url');
  const row = buildUsageRecord({
    principalId: 'target',
    credentialId: 'cred',
    policyVersions: [],
    requestId: 'req',
    attemptId: 'a',
    occurredAt: 100,
    modelAlias: '模型/one',
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
      return path.includes('format=csv')
        ? new Response('header\n', {
            headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
          })
        : path.includes('cursor=')
          ? empty()
          : Response.json({ object: 'list', data: [row], has_more: true, next_cursor: cursor });
    },
    { save: () => 'started', dispose() {} },
    'target',
  );
  await tick();
  input(root, '2');
  click(root, 'Apply filters');
  await tick();
  click(root, 'View usage for this model');
  await tick();
  const query = () => new URL(paths.at(-1) ?? '', 'http://localhost').searchParams;
  assert.equal(query().get('limit'), '2');
  assert.equal(query().get('model'), '模型/one');
  assert.equal(query().has('cursor'), false);
  click(root, 'Next page');
  await tick();
  assert.equal(query().get('cursor'), cursor);
  assert.equal(query().get('limit'), '2');
  click(root, 'Download current page CSV');
  await tick();
  assert.equal(query().get('cursor'), cursor);
  assert.equal(query().get('limit'), '2');
  assert.equal(query().get('model'), '模型/one');
  assert.equal(query().get('principal_id'), 'target');
  assert.equal(query().get('format'), 'csv');
  click(root, 'Previous page');
  await tick();
  assert.equal(query().has('cursor'), false);
  assert.equal(query().get('limit'), '2');
  app.dispose();
});
