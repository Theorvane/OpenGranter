import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountTokenIssuancePanel } from '../src/management/token-issue-panel.ts';
import { mountTokenManagementPanel } from '../src/management/token-management-panel.ts';
import { mountTokenRevocationPanel } from '../src/management/token-revoke-panel.ts';

class Element implements CatalogElement {
  textContent: string | null = null;
  value = '';
  attributes: Record<string, string> = {};
  children: Element[] = [];
  listeners: Record<string, () => void> = {};
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
  readonly tag: string;
  constructor(tag = 'div') {
    this.tag = tag;
  }
  setAttribute(key: string, value: string) {
    this.attributes[key] = value;
  }
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
    this.textContent = null;
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners[type] = listener;
  }
  focus() {}
}
const nodes = (root: Element): Element[] => [root, ...root.children.flatMap(nodes)];
const text = (root: Element) =>
  nodes(root)
    .map((n) => n.textContent ?? '')
    .join(' ');
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function click(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
  return node;
}
function enter(root: Element, label: string, value: string) {
  const input = nodes(root).find((n) => n.tag === 'label' && n.textContent === label)?.children[0];
  assert.ok(input, label);
  input.value = value;
}
function reviewIssue(root: Element) {
  enter(root, 'Principal ID', 'person');
  enter(root, 'Expiry (Unix milliseconds, integer)', '2000');
  click(root, 'Review issuance');
}
function reviewRevoke(root: Element) {
  enter(root, 'Credential ID', 'credential');
  click(root, 'Review revocation');
}
function success(path: string) {
  return path.endsWith('/revoke')
    ? Response.json({ revoked: true })
    : Response.json(
        { credentialId: 'credential', token: 'synthetic-panel-value' },
        { status: 201 },
      );
}

test('issued credential opens explicit revocation review without copy or automatic POST', async () => {
  const root = new Element();
  const calls: string[] = [];
  const panel = mountTokenManagementPanel(root, async (path, init) => {
    calls.push(path);
    if (path.endsWith('/revoke'))
      assert.deepEqual(JSON.parse(String(init.body)), { credentialId: 'credential' });
    return success(path);
  });
  reviewIssue(root);
  click(root, 'Confirm issuance');
  await tick();
  const secret = nodes(root).find(
    (n) => n.tag === 'pre' && n.textContent === 'synthetic-panel-value',
  );
  assert.ok(secret);
  const handoff = click(root, 'Review issued token revocation');
  assert.equal(calls.length, 1);
  assert.equal(secret.textContent, '');
  assert.doesNotMatch(text(root), /synthetic-panel-value/);
  assert.match(text(root), /Confirm revocation for credential ID: credential/);
  handoff.listeners.click?.();
  assert.equal(calls.length, 1);
  const confirm = click(root, 'Confirm revocation');
  confirm.listeners.click?.();
  await tick();
  assert.equal(calls.length, 2);
  assert.match(text(root), /Token revocation confirmed/);
  panel.dispose();
  handoff.listeners.click?.();
  confirm.listeners.click?.();
  assert.equal(text(root), '');
  assert.equal(calls.length, 2);
});

test('handoff cancel submits nothing and retained confirmation cannot revoke', async () => {
  const root = new Element();
  let calls = 0;
  mountTokenManagementPanel(root, async (path) => {
    calls++;
    return success(path);
  });
  reviewIssue(root);
  click(root, 'Confirm issuance');
  await tick();
  click(root, 'Review issued token revocation');
  const confirm = nodes(root).find((n) => n.textContent === 'Confirm revocation');
  assert.ok(confirm);
  click(root, 'Cancel');
  confirm.listeners.click?.();
  await tick();
  assert.equal(calls, 1);
  assert.doesNotMatch(text(root), /synthetic-panel-value|Confirm revocation for/);
});

test('handoff never replaces a pending revoke; display clears without replay', async () => {
  const root = new Element();
  let release!: (response: Response) => void;
  const gate = new Promise<Response>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const panel = mountTokenManagementPanel(root, async (path) => {
    calls++;
    return path.endsWith('/revoke') ? gate : success(path);
  });
  reviewRevoke(root);
  click(root, 'Confirm revocation');
  reviewIssue(root);
  click(root, 'Confirm issuance');
  await tick();
  click(root, 'Review issued token revocation');
  assert.equal(calls, 2);
  assert.match(text(root), /Revocation review unavailable/);
  assert.match(text(root), /Revocation in progress/);
  assert.doesNotMatch(text(root), /synthetic-panel-value|Confirm revocation for/);
  release(Response.json({ revoked: true }));
  await tick();
  assert.match(text(root), /Token revocation confirmed/);
  assert.equal(calls, 2);
  panel.dispose();
});

for (const behavior of ['throws', 'refuses', 'disposes'] as const) {
  test(`handoff ${behavior} clears retained secret and sanitizes diagnostics`, async () => {
    const root = new Element();
    let calls = 0;
    let received: unknown[] = [];
    const panel = mountTokenIssuancePanel(
      root,
      async (path) => {
        calls++;
        return success(path);
      },
      (...args) => {
        received = args;
        if (behavior === 'throws') throw Error('private-host-diagnostic');
        if (behavior === 'disposes') panel.dispose();
        return false;
      },
    );
    reviewIssue(root);
    click(root, 'Confirm issuance');
    await tick();
    const secret = nodes(root).find(
      (n) => n.tag === 'pre' && n.textContent === 'synthetic-panel-value',
    );
    assert.ok(secret);
    const handoff = click(root, 'Review issued token revocation');
    assert.deepEqual(received, ['credential']);
    assert.equal(secret.textContent, '');
    assert.doesNotMatch(text(root), /synthetic-panel-value|private-host-diagnostic/);
    if (behavior === 'disposes') assert.equal(text(root), '');
    else assert.match(text(root), /Revocation review unavailable/);
    handoff.listeners.click?.();
    assert.equal(calls, 1);
  });
}

test('external review validates ID, invalidates old confirmation, refuses pending/locked/disposed', async () => {
  const root = new Element();
  let calls = 0;
  let release!: (response: Response) => void;
  const panel = mountTokenRevocationPanel(root, async () => {
    calls++;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  assert.equal(panel.review(''), false);
  assert.equal(panel.review('bad\0id'), false);
  assert.equal(panel.review('old'), true);
  const oldConfirm = nodes(root).find((n) => n.textContent === 'Confirm revocation');
  assert.ok(oldConfirm);
  assert.equal(panel.review('<new>'), true);
  oldConfirm.listeners.click?.();
  assert.equal(calls, 0);
  assert.match(text(root), /<new>/);
  click(root, 'Confirm revocation');
  assert.equal(panel.review('replacement'), false);
  assert.equal(calls, 1);
  release(new Response(null, { status: 403 }));
  await tick();
  assert.equal(panel.review('later'), false);
  panel.dispose();
  assert.equal(panel.review('later'), false);
  assert.equal(text(root), '');
});

for (const status of [401, 403, 503]) {
  test(`handoff confirmation HTTP ${status} cannot report revocation success or revive secret`, async () => {
    const root = new Element();
    let calls = 0;
    mountTokenManagementPanel(root, async (path) => {
      calls++;
      return path.endsWith('/revoke')
        ? new Response('private-audit-diagnostic', { status })
        : success(path);
    });
    reviewIssue(root);
    click(root, 'Confirm issuance');
    await tick();
    const handoff = click(root, 'Review issued token revocation');
    const confirm = click(root, 'Confirm revocation');
    await tick();
    assert.doesNotMatch(
      text(root),
      /synthetic-panel-value|private-audit-diagnostic|Token revocation confirmed/,
    );
    assert.match(
      text(root),
      status === 401 ? /Sign-in required/ : status === 403 ? /Access denied/ : /outcome is unknown/,
    );
    handoff.listeners.click?.();
    confirm.listeners.click?.();
    await tick();
    assert.equal(calls, 2);
  });
}
