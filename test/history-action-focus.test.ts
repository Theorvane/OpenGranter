import assert from 'node:assert/strict';
import test from 'node:test';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import { Element, nodes, tick } from './account-token-dom-fixture.ts';

function find(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  return node;
}
for (const kind of ['Usage', 'Audit'] as const) {
  test(`${kind}: keeps same enabled action focus without crossing authority or tabs`, async () => {
    const root = new Element();
    const document = root.ownerDocument as typeof root.ownerDocument & { activeElement?: Element };
    const create = document.createElement;
    document.createElement = (tag) => {
      const node = create(tag);
      node.focus = () => {
        document.activeElement = node;
      };
      return node;
    };
    const pending: Array<(r: Response) => void> = [];
    const app = mountHistoryWorkspace(
      root,
      async () => new Promise<Response>((resolve) => pending.push(resolve)),
      { save: () => 'started', dispose() {} },
    );
    const empty = () =>
      Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
    pending.shift()?.(empty());
    await tick();
    if (kind === 'Audit') {
      find(root, 'Audit').listeners.click?.();
      pending.shift()?.(empty());
      await tick();
    }
    const discard = find(root, 'Discard filter edits');
    discard.focus();
    discard.listeners.click?.();
    assert.equal(document.activeElement, find(root, 'Discard filter edits'));
    const apply = find(root, 'Apply filters');
    apply.focus();
    apply.listeners.click?.();
    assert.equal(document.activeElement, find(root, 'Apply filters'));
    pending.shift()?.(empty());
    await tick();
    assert.equal(document.activeElement, find(root, 'Apply filters'));
    const refresh = find(root, 'Refresh current page');
    refresh.focus();
    refresh.listeners.click?.();
    assert.equal(document.activeElement, refresh, 'disabled action must not receive focus');
    const external = new Element('button');
    document.activeElement = external;
    pending.shift()?.(empty());
    await tick();
    assert.equal(document.activeElement, external);
    const tab = find(root, kind === 'Usage' ? 'Audit' : 'Usage');
    tab.focus();
    tab.listeners.click?.();
    assert.equal(document.activeElement, tab, 'do not cross tabs');
    pending.shift()?.(empty());
    await tick();
    const current = find(root, 'Apply filters');
    current.focus();
    current.listeners.click?.();
    const beforeDenial = document.activeElement;
    pending.shift()?.(new Response(null, { status: 403 }));
    await tick();
    assert.equal(document.activeElement, beforeDenial, 'denial must not restore a private control');
    assert.equal(nodes(root).filter((n) => n.tag === 'button').length, 0);
    app.dispose();
    assert.equal(root.children.length, 0);
  });
}
