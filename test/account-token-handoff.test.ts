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
function input(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'label' && n.textContent === label)?.children[0];
  assert.ok(node, label);
  return node;
}
const empty = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
function app(
  response: () => Response = () => Response.json({ id: 'human/exact+id', kind: 'human' }),
) {
  const root = new Element();
  const calls: { path: string; body: unknown }[] = [];
  const ui = mountManagementOperations(
    root,
    async (path, init) => {
      calls.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (path === '/management/v1/principal') return response();
      if (init.method === 'POST')
        return Response.json({ credentialId: 'issued', token: 'one-time-secret' }, { status: 201 });
      return empty();
    },
    () => ({ save: () => 'started', dispose() {} }),
  );
  return { root, calls, ui };
}
test('Account prepares exact principal with blank expiry; separate review and confirm alone issue', async () => {
  const f = app();
  await tick();
  click(f.root, 'Account');
  await tick();
  const before = f.calls.length;
  const detached = click(f.root, 'Prepare token for this account');
  assert.equal(f.calls.length, before);
  assert.equal(input(f.root, 'Principal ID').value, 'human/exact+id');
  assert.equal(input(f.root, 'Expiry (Unix milliseconds, integer)').value, '');
  input(f.root, 'Expiry (Unix milliseconds, integer)').value = '2000';
  click(f.root, 'Review issuance');
  assert.equal(f.calls.length, before);
  assert.match(text(f.root), /human\/exact\+id/);
  click(f.root, 'Confirm issuance');
  await tick();
  assert.deepEqual(f.calls.at(-1), {
    path: '/management/v1/proxy-tokens',
    body: { principalId: 'human/exact+id', expiresAt: 2000 },
  });
  assert.match(text(f.root), /one-time-secret/);
  detached.listeners.click?.();
  assert.match(text(f.root), /one-time-secret/);
  f.ui.dispose();
  detached.listeners.click?.();
  assert.equal(text(f.root), '');
});
test('refresh invalidates detached Account handoff and new identity replaces old target', async () => {
  let id = 'first';
  const f = app(() => Response.json({ id, kind: 'human' }));
  await tick();
  click(f.root, 'Account');
  await tick();
  const old = nodes(f.root).find((n) => n.textContent === 'Prepare token for this account');
  assert.ok(old);
  click(f.root, 'Refresh account');
  old.listeners.click?.();
  assert.match(text(f.root), /Loading account/);
  await tick();
  id = 'second';
  click(f.root, 'Refresh account');
  await tick();
  old.listeners.click?.();
  assert.match(text(f.root), /second/);
  click(f.root, 'Prepare token for this account');
  assert.equal(input(f.root, 'Principal ID').value, 'second');
  click(f.root, 'Account');
  await tick();
  f.ui.dispose();
  old.listeners.click?.();
  assert.equal(text(f.root), '');
});
test('denied and malformed Account responses cannot prepare a token', async () => {
  for (const response of [
    () => new Response(null, { status: 403 }),
    () => Response.json({ id: 'raw-private', kind: 'service' }),
  ]) {
    const f = app(response);
    await tick();
    click(f.root, 'Account');
    await tick();
    assert.equal(
      nodes(f.root).some((n) => n.textContent === 'Prepare token for this account'),
      false,
    );
    assert.equal(
      f.calls.some((c) => c.body),
      false,
    );
    assert.doesNotMatch(text(f.root), /raw-private/);
    f.ui.dispose();
  }
});
test('prefill is single use and manual token navigation never resurrects prior Account ID', async () => {
  const f = app();
  await tick();
  click(f.root, 'Account');
  await tick();
  click(f.root, 'Prepare token for this account');
  input(f.root, 'Expiry (Unix milliseconds, integer)').value = '2000';
  click(f.root, 'Review issuance');
  click(f.root, 'Cancel');
  assert.equal(input(f.root, 'Principal ID').value, '');
  click(f.root, 'History');
  await tick();
  click(f.root, 'Proxy tokens');
  assert.equal(input(f.root, 'Principal ID').value, '');
  f.ui.dispose();
});
