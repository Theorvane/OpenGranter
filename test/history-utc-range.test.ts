import assert from 'node:assert/strict';
import test from 'node:test';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import { Element, nodes, text, tick } from './account-token-dom-fixture.ts';

function field(root: Element, prefix: string) {
  const node = nodes(root).find(
    (n) => n.tag === 'input' && n.attributes['aria-label']?.startsWith(prefix),
  );
  assert.ok(node, prefix);
  return node;
}
function edit(root: Element, prefix: string, value: string) {
  const node = field(root, prefix);
  node.value = value;
  node.listeners.input?.();
}
function click(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
}
for (const kind of ['Usage', 'Audit'] as const) {
  test(`${kind}: UTC ranges keep exact applied query, drafts and existing boundaries`, async () => {
    const root = new Element();
    const paths: string[] = [];
    let deny = false;
    const app = mountHistoryWorkspace(
      root,
      async (path) => {
        paths.push(path);
        if (path.includes('format=csv'))
          return new Response('header\n', {
            headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
          });
        return deny
          ? new Response(null, { status: 403 })
          : Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
      },
      { save: () => 'started', dispose() {} },
      'target',
    );
    await tick();
    if (kind === 'Audit') {
      click(root, kind);
      await tick();
    }
    edit(root, 'To (', 'invalid');
    assert.ok(
      text(root).includes('Unapplied filter edits'),
      'invalid time is not equivalent to an omitted bound',
    );
    edit(root, 'From (', '2026-11-20T00:00:00.123Z');
    edit(root, 'To (', '2026-11-20T01:00:00Z');
    edit(root, 'Model', '팀/모델');
    edit(root, 'Request ID', 'request-1');
    const before = paths.length;
    click(root, 'Apply filters');
    await tick();
    assert.equal(paths.length, before + 1, 'UTC range makes one bounded request');
    const query = new URL(paths.at(-1) ?? '', 'http://localhost').searchParams;
    assert.equal(query.get('from_ms'), String(Date.parse('2026-11-20T00:00:00.123Z')));
    assert.equal(query.get('to_ms'), String(Date.parse('2026-11-20T01:00:00Z')));
    assert.equal(query.get('principal_id'), 'target');
    assert.equal(query.get('model'), '팀/모델');
    assert.equal(query.get('request_id'), 'request-1');
    assert.equal(field(root, 'From (').value, '2026-11-20T00:00:00.123Z');
    assert.ok(!text(root).includes('Unapplied filter edits'));
    edit(root, 'From (', query.get('from_ms') ?? '');
    assert.ok(
      !text(root).includes('Unapplied filter edits'),
      'equal exact milliseconds do not misreport a draft',
    );
    edit(root, 'From (', '2026-11-20T00:10:00Z');
    click(root, 'Download current page CSV');
    await tick();
    const csvQuery = new URL(paths.at(-1) ?? '', 'http://localhost').searchParams;
    assert.equal(
      csvQuery.get('from_ms'),
      query.get('from_ms'),
      'unapplied UTC edits do not alter CSV',
    );
    assert.equal(csvQuery.get('to_ms'), query.get('to_ms'));
    assert.equal(csvQuery.get('principal_id'), 'target');
    assert.equal(csvQuery.get('model'), '팀/모델');
    assert.equal(csvQuery.get('request_id'), 'request-1');
    click(root, kind === 'Usage' ? 'Audit' : 'Usage');
    await tick();
    const otherQuery = new URL(paths.at(-1) ?? '', 'http://localhost').searchParams;
    assert.equal(otherQuery.has('from_ms'), false, 'other tab retains independent bounds');
    click(root, kind);
    await tick();
    assert.equal(field(root, 'From (').value, '2026-11-20T00:10:00Z');
    assert.equal(
      new URL(paths.at(-1) ?? '', 'http://localhost').searchParams.get('from_ms'),
      query.get('from_ms'),
    );
    const acceptedCount = paths.length;
    for (const bad of [
      '2026-02-30T00:00:00Z',
      '2026-11-20T00:00:00',
      '2026-11-20T00:00:00+00:00',
      '2026-11-20T24:00:00Z',
      ' 0',
      '1e2',
      '9007199254740992',
    ]) {
      edit(root, 'From (', bad);
      click(root, 'Apply filters');
      await tick();
      assert.equal(paths.length, acceptedCount, bad);
      assert.match(text(root), /Invalid filters/);
    }
    edit(root, 'From (', '2026-11-21T00:00:00Z');
    click(root, 'Apply filters');
    await tick();
    assert.equal(paths.length, acceptedCount, 'reversed interval stays local');
    edit(root, 'From (', '0');
    edit(root, 'To (', '2026-11-20T01:00:00');
    click(root, 'Apply filters');
    await tick();
    assert.equal(paths.length, acceptedCount, 'invalid upper bound stays local');
    edit(root, 'To (', '100');
    click(root, 'Apply filters');
    await tick();
    assert.equal(paths.length, acceptedCount + 1, 'numeric compatibility');
    deny = true;
    click(root, 'Refresh current page');
    await tick();
    assert.match(text(root), /Access denied/);
    app.dispose();
    assert.equal(text(root), '');
  });
}
