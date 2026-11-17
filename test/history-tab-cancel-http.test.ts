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
async function until(check: () => boolean) {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(check(), 'owned HTTP settled');
}
for (const kind of ['usage', 'audit'] as const) {
  test(`${kind}: tab cancellation suppresses delivery after signed JWT/HTTP/SQL already exported`, async () => {
    const f = await historyPageSizeRuntime();
    const root = new Element();
    let release: (() => void) | undefined;
    let signal: AbortSignal | null | undefined;
    let saved = 0;
    const ui = mountHistoryWorkspace(
      root,
      async (path, init) => {
        const response = await f.request(path, init);
        if (path.includes('format=csv')) {
          signal = init.signal;
          // Delay client delivery, NOT server auth/query/audit execution. Tab
          // cancellation must not pretend that this completed work was undone.
          await new Promise<void>((r) => {
            release = r;
          });
        }
        return response;
      },
      {
        save: () => {
          saved++;
          return 'started';
        },
        dispose() {},
      },
    );
    try {
      await until(() => text(root).includes('records shown'));
      if (kind === 'audit') {
        click(root, 'Audit');
        await until(() => text(root).includes('records shown'));
      }
      click(root, 'Download current page CSV');
      await until(() => release !== undefined);
      assert.equal(f.statuses.at(-1)?.status, 200);
      assert.ok((await f.auditCount(kind)) >= 2, 'server export audit survives local cancellation');
      click(root, kind === 'usage' ? 'Audit' : 'Usage');
      assert.equal(signal?.aborted, true);
      release?.();
      await until(() => text(root).includes('records shown'));
      assert.equal(saved, 0);
      assert.doesNotMatch(text(root), /other-request|other-credential/);
      click(root, kind === 'usage' ? 'Usage' : 'Audit');
      await until(() => text(root).includes('records shown'));
      assert.equal(saved, 0, 'return must not automatically restart download');
    } finally {
      release?.();
      ui.dispose();
      await f.close();
    }
  });
}
