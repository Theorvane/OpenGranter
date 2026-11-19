import assert from 'node:assert/strict';
import test from 'node:test';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import { Element, nodes, text } from './account-token-dom-fixture.ts';
import { historyPageSizeRuntime } from './history-page-size-runtime-fixture.ts';

function click(root: Element, label: string) {
  const button = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(button, label);
  button.listeners.click?.();
}
function size(root: Element, value: string) {
  const input = nodes(root).find(
    (n) => n.attributes['aria-label'] === 'Page size (1–100, blank for default)',
  );
  assert.ok(input, 'Page size input');
  input.value = value;
}
async function until(check: () => boolean) {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(check(), 'owned HTTP settled');
}
for (const kind of ['usage', 'audit'] as const) {
  test(`${kind} applied page size traverses signed JWT HTTP/SQL, scoped pagination, CSV and fresh Deny`, async () => {
    const f = await historyPageSizeRuntime();
    const root = new Element();
    let csv: string | undefined;
    const ui = mountHistoryWorkspace(root, f.request, {
      save: (_, value) => {
        csv = value;
        return 'started';
      },
      dispose() {},
    });
    const ready = () => text(root).includes('records shown');
    try {
      await until(ready);
      if (kind === 'audit') {
        click(root, 'Audit');
        await until(ready);
      }
      size(root, '1');
      click(root, 'Apply filters');
      await until(ready);
      assert.match(text(root), /1 records shown/);
      assert.doesNotMatch(text(root), /other-request|other-credential/);
      assert.match(text(root), /human-request-3/);
      click(root, 'Next page');
      await until(ready);
      assert.match(text(root), /human-request-2/);
      assert.doesNotMatch(text(root), /human-request-3/);
      const current = new URL(f.statuses.at(-1)?.path ?? '', 'https://local.invalid');
      assert.equal(current.searchParams.get('limit'), '1');
      assert.ok(current.searchParams.has('cursor'));
      click(root, 'Download current page CSV');
      await until(() => csv !== undefined);
      assert.match(csv ?? '', /human-request-2/);
      assert.doesNotMatch(csv ?? '', /human-request-3|human-request-1|other-/);
      const exported = new URL(f.statuses.at(-1)?.path ?? '', 'https://local.invalid');
      assert.equal(exported.searchParams.get('limit'), '1');
      assert.equal(exported.searchParams.get('cursor'), current.searchParams.get('cursor'));
      assert.ok((await f.auditCount(kind)) >= 4);
      size(root, '2');
      click(root, 'Apply filters');
      await until(ready);
      assert.match(text(root), /2 records shown/);
      assert.equal(
        new URL(f.statuses.at(-1)?.path ?? '', 'https://local.invalid').searchParams.has('cursor'),
        false,
      );
      const before = f.statuses.length;
      size(root, '101');
      click(root, 'Apply filters');
      await until(() => text(root).includes('Invalid filters'));
      assert.equal(f.statuses.length, before);
      size(root, '1');
      click(root, 'Apply filters');
      await until(ready);
      await f.deny();
      click(root, 'Next page');
      await until(() => text(root).includes('Access denied'));
      assert.equal(f.statuses.at(-1)?.status, 403);
      assert.doesNotMatch(text(root), /human-request|Page size/);
    } finally {
      ui.dispose();
      await f.close();
    }
  });
}
