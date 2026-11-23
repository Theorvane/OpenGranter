import assert from 'node:assert/strict';
import test from 'node:test';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import { Element, nodes, text, tick } from './account-token-dom-fixture.ts';

function button(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  return node;
}
function click(root: Element, label: string) {
  button(root, label).listeners.click?.();
}
function edit(root: Element) {
  const input = nodes(root).find((n) => n.attributes['aria-label'] === 'Model');
  assert.ok(input);
  input.value = 'unapplied-model';
  input.listeners.input?.();
}
const empty = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
function fixture(throws: boolean) {
  const root = new Element();
  const paths: string[] = [];
  let resolve: ((r: Response) => void) | undefined;
  let pending = false;
  let saves = 0;
  let disposals = 0;
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      if (path.includes('format=csv'))
        return new Response('csv', {
          headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
        });
      if (pending)
        return new Promise<Response>((r) => {
          resolve = r;
        });
      return empty();
    },
    {
      save() {
        saves++;
        if (throws) throw new Error('PRIVATE');
        return 'unavailable';
      },
      dispose() {
        disposals++;
      },
    },
  );
  return {
    root,
    paths,
    app,
    defer: () => {
      pending = true;
    },
    finish: (status = 200) =>
      resolve?.(status === 200 ? empty() : new Response('PRIVATE', { status })),
    saves: () => saves,
    disposals: () => disposals,
  };
}
for (const kind of ['Usage', 'Audit'] as const) {
  for (const action of ['Refresh current page', 'Apply filters', 'tab return'] as const) {
    test(`${kind} fresh ${action} retires stale browser CSV failure`, async () => {
      const f = fixture(action === 'Apply filters');
      await tick();
      if (kind === 'Audit') {
        click(f.root, kind);
        await tick();
      }
      click(f.root, 'Download current page CSV');
      await tick();
      assert.equal(f.saves(), 1);
      assert.match(text(f.root), /CSV unavailable/);
      assert.doesNotMatch(text(f.root), /PRIVATE/);
      edit(f.root);
      assert.match(text(f.root), /CSV unavailable/);
      click(f.root, 'Discard filter edits');
      assert.match(text(f.root), /CSV unavailable/);
      if (action === 'tab return') {
        click(f.root, kind === 'Usage' ? 'Audit' : 'Usage');
        await tick();
      }
      f.defer();
      click(f.root, action === 'tab return' ? kind : action);
      assert.match(text(f.root), /Loading history/);
      assert.doesNotMatch(text(f.root), /CSV unavailable/);
      f.finish();
      await tick();
      assert.doesNotMatch(text(f.root), /CSV unavailable/);
      assert.equal(f.saves(), 1);
      f.app.dispose();
    });
  }
  for (const status of [401, 403]) {
    test(`${kind} fresh read ${status} clears failed delivery and locks retained controls`, async () => {
      const f = fixture(false);
      await tick();
      if (kind === 'Audit') {
        click(f.root, kind);
        await tick();
      }
      click(f.root, 'Download current page CSV');
      await tick();
      assert.match(text(f.root), /CSV unavailable/);
      const retired = button(f.root, 'Download current page CSV');
      f.defer();
      click(f.root, 'Refresh current page');
      f.finish(status);
      await tick();
      assert.doesNotMatch(text(f.root), /CSV unavailable|PRIVATE/);
      const count = f.paths.length;
      retired.listeners.click?.();
      assert.equal(f.paths.length, count);
      assert.equal(f.disposals(), 1);
      f.app.dispose();
      assert.equal(text(f.root), '');
    });
  }
}
