import assert from 'node:assert/strict';
import test from 'node:test';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import { Element, nodes, text, tick } from './account-token-dom-fixture.ts';

function click(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
}
function edit(root: Element, label: string, value: string) {
  const node = nodes(root).find((n) => n.tag === 'input' && n.attributes['aria-label'] === label);
  assert.ok(node, label);
  node.value = value;
  node.listeners.input?.();
}
function scope(root: Element) {
  return nodes(root).find((n) => n.attributes['aria-label'] === 'Applied history query scope');
}
function scopeText(root: Element) {
  const summary = scope(root);
  assert.ok(summary);
  return text(summary);
}
for (const kind of ['Usage', 'Audit'] as const) {
  for (const target of [undefined, 'human-target']) {
    test(`${kind}: applied query scope separate from drafts (${target ?? 'self'})`, async () => {
      const root = new Element();
      const paths: string[] = [];
      let status = 200;
      let release: (() => void) | undefined;
      let pause = false;
      const app = mountHistoryWorkspace(
        root,
        async (path) => {
          paths.push(path);
          if (pause)
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          if (status !== 200) return new Response(null, { status });
          if (path.includes('format=csv'))
            return new Response('header\n', {
              headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
            });
          return Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
        },
        { save: () => 'started', dispose() {} },
        target,
      );
      await tick();
      if (kind === 'Audit') {
        click(root, 'Audit');
        await tick();
      }
      let summary = scope(root);
      assert.ok(summary);
      assert.ok(text(summary).includes(target ?? 'Signed-in principal (self)'));
      assert.match(text(summary), /Model No model filter/);
      assert.match(text(summary), /Page size Server default/);
      edit(root, 'Model', '팀/<script>');
      edit(root, 'Request ID', 'request-1');
      edit(root, 'From (UTC or Unix ms, inclusive)', '2026-11-20T00:00:00.123Z');
      edit(root, 'To (UTC or Unix ms, exclusive)', '2026-11-20T01:00:00.456Z');
      edit(root, 'Page size (1–100, blank for default)', '7');
      click(root, 'Apply filters');
      await tick();
      summary = scope(root);
      assert.ok(summary);
      const applied = text(summary);
      assert.ok(applied.includes('팀/<script>'));
      assert.match(applied, /Request ID request-1/);
      assert.ok(applied.includes('From (inclusive) 2026-11-20T00:00:00.123Z (UTC)'));
      assert.ok(applied.includes('To (exclusive) 2026-11-20T01:00:00.456Z (UTC)'));
      assert.match(applied, /Page size 7/);
      edit(root, 'Principal', 'unapplied-private-principal');
      edit(root, 'Model', 'unapplied-private-model');
      assert.equal(scopeText(root), applied);
      click(root, 'Download current page CSV');
      await tick();
      const query = new URL('https://test.invalid' + paths.at(-1)).searchParams;
      assert.equal(query.get('model'), '팀/<script>');
      assert.equal(query.get('principal_id'), target ?? null);
      assert.equal(query.get('limit'), '7');
      assert.equal(scopeText(root), applied);
      pause = true;
      click(root, 'Refresh current page');
      assert.equal(scope(root), undefined, 'no summary while loading');
      status = 503;
      pause = false;
      release?.();
      await tick();
      assert.equal(scope(root), undefined, 'no stale scope on failure');
      status = 200;
      click(root, 'Retry');
      await tick();
      assert.equal(scopeText(root), applied);
      click(root, kind === 'Usage' ? 'Audit' : 'Usage');
      await tick();
      assert.ok(!scopeText(root).includes('request-1'), 'sibling filters stay isolated');
      click(root, kind);
      await tick();
      assert.equal(scopeText(root), applied);
      click(root, 'Clear filters');
      await tick();
      assert.ok(scopeText(root).includes('Signed-in principal (self)'));
      assert.ok(!scopeText(root).includes('request-1'));
      edit(root, 'Page size (1–100, blank for default)', '0');
      click(root, 'Apply filters');
      await tick();
      assert.equal(scope(root), undefined, 'invalid filters are not an authorized page');
      click(root, 'Clear filters');
      await tick();
      status = 403;
      click(root, 'Refresh current page');
      await tick();
      assert.equal(scope(root), undefined);
      assert.ok(!text(root).includes(target ?? 'Signed-in principal (self)'));
      app.dispose();
      assert.equal(text(root), '');
    });
  }
}
