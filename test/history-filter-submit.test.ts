import assert from 'node:assert/strict';
import test from 'node:test';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import { Element, nodes, text, tick } from './account-token-dom-fixture.ts';

const empty = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
function click(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
}
function form(root: Element) {
  const node = nodes(root).find(
    (n) => n.tag === 'form' && n.attributes['aria-label'] === 'History filters',
  );
  assert.ok(node, 'native named filter form');
  return node;
}
function input(root: Element, label: string, value: string) {
  const node = nodes(root).find((n) => n.attributes['aria-label'] === label);
  assert.ok(node, label);
  node.value = value;
}
for (const kind of ['usage', 'audit'] as const) {
  test(`${kind}: native submission applies exact scope once, rejects invalid input, and expires stale forms`, async () => {
    const root = new Element();
    const paths: string[] = [];
    let deny = false;
    const app = mountHistoryWorkspace(
      root,
      async (path) => {
        paths.push(path);
        return deny ? new Response(null, { status: 403 }) : empty();
      },
      { save: () => 'started', dispose() {} },
      'target',
    );
    await tick();
    if (kind === 'audit') {
      click(root, 'Audit');
      await tick();
    }
    const stale = form(root);
    assert.equal(
      nodes(stale).find((n) => n.textContent === 'Apply filters')?.attributes.type,
      'submit',
    );
    input(root, 'Model', '팀/채팅');
    input(root, 'Request ID', 'request-1');
    const before = paths.length;
    stale.listeners.submit?.();
    await tick();
    assert.equal(paths.length, before + 1);
    const lastPath = paths.at(-1);
    assert.ok(lastPath);
    const query = new URL(lastPath, 'http://localhost').searchParams;
    assert.equal(query.get('model'), '팀/채팅');
    assert.equal(query.get('request_id'), 'request-1');
    assert.equal(query.get('principal_id'), 'target');
    stale.listeners.submit?.();
    await tick();
    assert.equal(paths.length, before + 1);
    input(root, 'Page size (1–100, blank for default)', '0');
    form(root).listeners.submit?.();
    await tick();
    assert.equal(paths.length, before + 1);
    assert.match(text(root), /Invalid filters/);
    input(root, 'Page size (1–100, blank for default)', '5');
    deny = true;
    const deniedForm = form(root);
    deniedForm.listeners.submit?.();
    await tick();
    assert.match(text(root), /Access denied/);
    const deniedCount = paths.length;
    deniedForm.listeners.submit?.();
    await tick();
    assert.equal(paths.length, deniedCount);
    app.dispose();
    deniedForm.listeners.submit?.();
    await tick();
    assert.equal(paths.length, deniedCount);
  });
}
