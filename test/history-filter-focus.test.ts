import assert from 'node:assert/strict';
import test from 'node:test';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import { Element, nodes, text, tick } from './account-token-dom-fixture.ts';

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
  test(`${kind}: pending completion retains focused draft and selection without stealing external focus`, async () => {
    const root = new Element();
    const document = root.ownerDocument as typeof root.ownerDocument & { activeElement?: Element };
    let pending: ((response: Response) => void) | undefined;
    let block = false;
    const app = mountHistoryWorkspace(
      root,
      async () => {
        if (block)
          return new Promise<Response>((resolve) => {
            pending = resolve;
          });
        return Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
      },
      { save: () => 'started', dispose() {} },
    );
    await tick();
    if (kind === 'Audit') {
      button(root, 'Audit');
      await tick();
    }
    const originalCreate = document.createElement;
    document.createElement = (tag: string) => {
      const node = originalCreate(tag) as Element & {
        selectionStart?: number;
        selectionEnd?: number;
        selectionDirection?: string;
        setSelectionRange?: (start: number, end: number, direction?: string) => void;
      };
      node.focus = () => {
        document.activeElement = node;
      };
      node.setSelectionRange = (start, end, direction) => {
        node.selectionStart = start;
        node.selectionEnd = end;
        node.selectionDirection = direction ?? 'none';
      };
      return node;
    };
    block = true;
    button(root, 'Refresh current page');
    const input = edit(root, 'Model', 'private/한글') as Element & {
      selectionStart: number;
      selectionEnd: number;
      selectionDirection: string;
    };
    input.selectionStart = 2;
    input.selectionEnd = 7;
    input.selectionDirection = 'backward';
    input.focus();
    assert.ok(pending);
    pending(Response.json({ object: 'list', data: [], has_more: false, next_cursor: null }));
    await tick();
    const restored = field(root, 'Model') as typeof input;
    assert.equal(document.activeElement, restored, 'current filter focus survives replacement');
    assert.equal(restored.value, 'private/한글');
    assert.equal(restored.selectionStart, 2);
    assert.equal(restored.selectionEnd, 7);
    assert.equal(restored.selectionDirection, 'backward');
    assert.equal(input.value, '', 'detached input remains cleared');
    const external = new Element('button');
    button(root, 'Refresh current page');
    document.activeElement = external;
    assert.ok(pending);
    pending(Response.json({ object: 'list', data: [], has_more: false, next_cursor: null }));
    await tick();
    assert.equal(document.activeElement, external, 'do not steal external focus');
    block = false;
    const beforeTab = field(root, 'Model');
    beforeTab.focus();
    button(root, kind === 'Usage' ? 'Audit' : 'Usage');
    await tick();
    assert.equal(document.activeElement, beforeTab, 'do not restore a different tab filter');
    button(root, kind);
    await tick();
    block = true;
    button(root, 'Refresh current page');
    const denied = field(root, 'Model');
    denied.focus();
    assert.ok(pending);
    pending(new Response(null, { status: 403 }));
    await tick();
    assert.match(text(root), /Access denied/);
    assert.equal(denied.value, '');
    assert.equal(
      document.activeElement,
      denied,
      'terminal render must not refocus private filters',
    );
    app.dispose();
    assert.equal(text(root), '');
  });
}
