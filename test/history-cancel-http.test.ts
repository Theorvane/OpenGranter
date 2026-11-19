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
function input(root: Element, label: string, value: string) {
  const node = nodes(root).find((n) => n.attributes['aria-label'] === label);
  assert.ok(node, label);
  node.value = value;
}
async function until(check: () => boolean) {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(check(), 'owned HTTP settled');
}
for (const kind of ['usage', 'audit'] as const) {
  test(`${kind}: cancel late real HTTP responses without widening applied retry or CSV scope`, async () => {
    const f = await historyPageSizeRuntime();
    const root = new Element();
    let hold = false;
    let release: (() => void) | undefined;
    let held = false;
    let csv: string | undefined;
    let saves = 0;
    const ui = mountHistoryWorkspace(
      root,
      async (path, init) => {
        const response = await f.request(path, init);
        if (hold) {
          hold = false;
          await new Promise<void>((resolve) => {
            release = resolve;
            held = true;
          });
        }
        return response;
      },
      {
        save: (_, value) => {
          saves++;
          csv = value;
          return 'started';
        },
        dispose() {},
      },
    );
    const ready = () => text(root).includes('records shown');
    try {
      await until(ready);
      if (kind === 'audit') {
        click(root, 'Audit');
        await until(ready);
      }
      input(root, 'Page size (1–100, blank for default)', '1');
      input(root, 'Request ID', 'human-request-2');
      click(root, 'Apply filters');
      await until(ready);
      input(root, 'Page size (1–100, blank for default)', '100');
      hold = true;
      click(root, 'Refresh current page');
      await until(() => held);
      click(root, 'Cancel history request');
      assert.match(text(root), /History request cancelled/);
      release?.();
      await new Promise((r) => setTimeout(r, 20));
      assert.doesNotMatch(text(root), /records shown/);
      click(root, 'Retry');
      await until(ready);
      assert.match(text(root), /1 records shown/);
      assert.match(text(root), /human-request-2/);
      assert.doesNotMatch(text(root), /human-request-3|other-request/);
      const query = new URL(f.statuses.at(-1)?.path ?? '', 'https://local.invalid').searchParams;
      assert.equal(query.get('limit'), '1');
      assert.equal(query.get('request_id'), 'human-request-2');
      held = false;
      hold = true;
      click(root, 'Download current page CSV');
      await until(() => held);
      click(root, 'Cancel CSV preparation');
      release?.();
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(saves, 0);
      assert.match(text(root), /1 records shown/);
      click(root, 'Download current page CSV');
      await until(() => saves === 1);
      assert.match(csv ?? '', /human-request-2/);
      assert.doesNotMatch(csv ?? '', /human-request-3|human-request-1|other-/);
      const exported = new URL(f.statuses.at(-1)?.path ?? '', 'https://local.invalid').searchParams;
      assert.equal(exported.get('limit'), '1');
      assert.equal(exported.get('request_id'), 'human-request-2');
      assert.ok((await f.auditCount(kind)) >= 5);
    } finally {
      release?.();
      ui.dispose();
      await f.close();
    }
  });
}
