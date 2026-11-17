import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountTokenManagementPanel } from '../src/management/token-management-panel.ts';
import { Element, nodes, text, tick } from './account-token-dom-fixture.ts';

class Page extends EventTarget {
  listeners = 0;
  override addEventListener(...args: Parameters<EventTarget['addEventListener']>) {
    if (args[0] === 'pagehide') this.listeners++;
    super.addEventListener(...args);
  }
  override removeEventListener(...args: Parameters<EventTarget['removeEventListener']>) {
    if (args[0] === 'pagehide') this.listeners--;
    super.removeEventListener(...args);
  }
  leave() {
    this.dispatchEvent(new Event('pagehide'));
  }
}
function setup(page = new Page()) {
  const root = new Element();
  Object.assign(root.ownerDocument, { defaultView: page });
  return { root, page };
}
function button(root: Element, label: string) {
  const found = nodes(root).find((node) => node.tag === 'button' && node.textContent === label);
  assert.ok(found, label);
  return found;
}
function review(root: Element) {
  const inputs = nodes(root).filter((node) => node.tag === 'input');
  assert.ok(inputs[0] && inputs[1]);
  inputs[0].value = 'synthetic-principal';
  inputs[1].value = '2000000000000';
  button(root, 'Review issuance').listeners.click?.();
  return button(root, 'Confirm issuance');
}
test('native page exit clears live and retained one-time credentials and removes observer', async () => {
  const { root, page } = setup();
  let calls = 0;
  const app = mountTokenManagementPanel(root, async () => {
    calls++;
    return Response.json(
      { credentialId: 'synthetic-id', token: 'synthetic-secret' },
      { status: 201 },
    );
  });
  const confirm = review(root);
  confirm.listeners.click?.();
  await tick();
  assert.match(text(root), /synthetic-secret/u);
  const retained = nodes(root).filter((node) => node.tag === 'pre');
  const handoff = button(root, 'Review issued token revocation');
  page.leave();
  assert.equal(root.children.length, 0);
  assert.ok(retained.every((node) => node.textContent === ''));
  assert.equal(page.listeners, 0);
  page.dispatchEvent(new Event('pageshow'));
  confirm.listeners.click?.();
  handoff.listeners.click?.();
  assert.equal(calls, 1);
  assert.equal(root.children.length, 0);
  page.leave();
  app.dispose();
  assert.equal(page.listeners, 0);
});
test('page exit aborts a pending issuance and ignores late success without retry', async () => {
  const { root, page } = setup();
  let signal: AbortSignal | undefined;
  let finish!: (response: Response) => void;
  let calls = 0;
  const app = mountTokenManagementPanel(root, async (_path, init) => {
    calls++;
    signal = init.signal ?? undefined;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  review(root).listeners.click?.();
  assert.equal(signal?.aborted, false);
  page.leave();
  assert.equal(signal?.aborted, true);
  finish(Response.json({ credentialId: 'late-id', token: 'late-secret' }, { status: 201 }));
  await tick();
  assert.equal(root.children.length, 0);
  assert.equal(calls, 1);
  app.dispose();
});
test('page exit clears both input panels and detached review actions', () => {
  const { root, page } = setup();
  let calls = 0;
  const app = mountTokenManagementPanel(root, async () => {
    calls++;
    return new Response();
  });
  const retained = nodes(root).filter((node) => node.tag === 'input');
  for (const input of retained) input.value = 'synthetic-private-input';
  const stale = button(root, 'Review revocation');
  page.leave();
  assert.ok(retained.every((input) => input.value === ''));
  stale.listeners.click?.();
  assert.equal(calls, 0);
  assert.equal(root.children.length, 0);
  app.dispose();
});
for (const status of [401, 403]) {
  test(`fresh ${status} removes lifecycle observer and preserves terminal boundary`, async () => {
    const { root, page } = setup();
    const app = mountTokenManagementPanel(root, async () => new Response(null, { status }));
    assert.equal(page.listeners, 1);
    review(root).listeners.click?.();
    await tick();
    const boundary = text(root);
    assert.equal(page.listeners, 0);
    page.leave();
    assert.equal(text(root), boundary);
    assert.equal(nodes(root).filter((node) => node.tag === 'input').length, 0);
    app.dispose();
  });
}
test('independent page lifetimes and explicit disposal release only their observer', () => {
  const a = setup();
  const b = setup();
  const request = async () => new Response();
  const first = mountTokenManagementPanel(a.root, request);
  const second = mountTokenManagementPanel(b.root, request);
  assert.equal(a.page.listeners, 1);
  assert.equal(b.page.listeners, 1);
  first.dispose();
  assert.equal(a.page.listeners, 0);
  assert.equal(b.page.listeners, 1);
  a.page.leave();
  assert.ok(b.root.children.length > 0);
  b.page.leave();
  assert.equal(b.root.children.length, 0);
  second.dispose();
  assert.equal(b.page.listeners, 0);
});
test('non-browser documents retain explicit cleanup without native lifecycle', () => {
  for (const defaultView of [undefined, null]) {
    const root = new Element();
    Object.assign(root.ownerDocument, { defaultView });
    const app = mountTokenManagementPanel(root, async () => new Response());
    assert.ok(root.children.length > 0);
    app.dispose();
    assert.equal(root.children.length, 0);
  }
});
