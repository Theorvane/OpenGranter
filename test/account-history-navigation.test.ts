import assert from 'node:assert/strict';
import test from 'node:test';
import { mountManagementOperations } from '../src/management/operations-app.ts';
import { Element, nodes, text, tick } from './account-token-dom-fixture.ts';

function click(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
  return node;
}
function principal(root: Element) {
  const node = nodes(root).find((n) => n.attributes['aria-label'] === 'Principal');
  assert.ok(node);
  return node;
}
const empty = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
function fixture(id = 'human/exact+id', status = 200) {
  const root = new Element();
  const calls: string[] = [];
  const ui = mountManagementOperations(
    root,
    async (path) => {
      calls.push(path);
      if (path === '/management/v1/principal') return Response.json({ id, kind: 'human' });
      if (new URL(path, 'https://local.invalid').searchParams.has('principal_id') && status !== 200)
        return new Response('PRIVATE failure', { status });
      return empty();
    },
    () => ({ save: () => 'started', dispose() {} }),
  );
  return { root, calls, ui };
}

test('Account history uses exact ID for usage and audit; manual navigation clears default and detached controls', async () => {
  const f = fixture();
  await tick();
  click(f.root, 'Account');
  await tick();
  const stale = click(f.root, 'View history for this account');
  await tick();
  assert.equal(principal(f.root).value, 'human/exact+id');
  const retained = principal(f.root);
  assert.equal(
    new URL(f.calls.at(-1) ?? '', 'https://local.invalid').searchParams.get('principal_id'),
    'human/exact+id',
  );
  assert.match(f.calls.at(-1) ?? '', /\/usage\?/);
  click(f.root, 'Audit');
  await tick();
  assert.equal(principal(f.root).value, 'human/exact+id');
  assert.match(f.calls.at(-1) ?? '', /\/audit\?/);
  assert.equal(
    new URL(f.calls.at(-1) ?? '', 'https://local.invalid').searchParams.get('principal_id'),
    'human/exact+id',
  );
  assert.equal(retained.value, '');
  const auditInput = principal(f.root);
  click(f.root, 'History');
  await tick();
  assert.equal(principal(f.root).value, '');
  assert.equal(auditInput.value, '');
  assert.equal(f.calls.at(-1), '/management/v1/usage?format=json');
  const count = f.calls.length;
  stale.listeners.click?.();
  await tick();
  assert.equal(f.calls.length, count);
  f.ui.dispose();
});

test('Account refresh invalidates old history action; invalid history ID never falls back to unfiltered GET', async () => {
  const f = fixture('human\ncontrol');
  await tick();
  click(f.root, 'Account');
  await tick();
  const old = nodes(f.root).find((n) => n.textContent === 'View history for this account');
  assert.ok(old);
  click(f.root, 'Refresh account');
  const count = f.calls.length;
  old.listeners.click?.();
  assert.equal(f.calls.length, count);
  await tick();
  const before = f.calls.length;
  click(f.root, 'View history for this account');
  await tick();
  assert.equal(f.calls.length, before);
  assert.match(text(f.root), /Invalid filters/);
  assert.equal(principal(f.root).value, 'human\ncontrol');
  f.ui.dispose();
});

for (const status of [401, 403, 503])
  test(`Account identity is not a history grant: ${status}`, async () => {
    const f = fixture('human', status);
    await tick();
    click(f.root, 'Account');
    await tick();
    const old = click(f.root, 'View history for this account');
    await tick();
    assert.match(
      text(f.root),
      status === 401
        ? /Sign-in required/
        : status === 403
          ? /Access denied/
          : /History unavailable/,
    );
    assert.doesNotMatch(text(f.root), /PRIVATE/);
    const count = f.calls.length;
    old.listeners.click?.();
    await tick();
    assert.equal(f.calls.length, count);
    f.ui.dispose();
  });
