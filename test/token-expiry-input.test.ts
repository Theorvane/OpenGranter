import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTokenExpiry, tokenExpiryDescription } from '../src/management/token-expiry-input.ts';
import { mountTokenIssuancePanel } from '../src/management/token-issue-panel.ts';
import { Element, nodes, text, tick } from './account-token-dom-fixture.ts';

function click(root: Element, label: string) {
  const button = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(button, label);
  button.listeners.click?.();
}
function enter(root: Element, expiry: string) {
  const inputs = nodes(root).filter((n) => n.tag === 'input');
  assert.equal(inputs.length, 2);
  const [principal, expires] = inputs;
  assert.ok(principal && expires);
  principal.value = 'principal';
  expires.value = expiry;
  click(root, 'Review issuance');
}
test('strict UTC calendar input and exact canonical Unix milliseconds', () => {
  for (const value of [
    '2028-02-29T12:34:56Z',
    '2028-02-29T12:34:56.123Z',
    '1970-01-01T00:00:00Z',
  ]) {
    assert.equal(parseTokenExpiry(value), Date.parse(value));
  }
  for (const value of ['0', '2000000000000', '9007199254740991']) {
    assert.equal(parseTokenExpiry(value), Number(value));
  }
});
test('reject ambiguous, normalized, noncanonical and unsafe expiry input', () => {
  for (const value of [
    '',
    ' 0',
    '0 ',
    '01',
    '-1',
    '1.0',
    '1e3',
    '9007199254740992',
    '2026-02-29T12:00:00Z',
    '2028-02-30T12:00:00Z',
    '2028-13-01T00:00:00Z',
    '2028-01-01T24:00:00Z',
    '2028-01-01T00:00:60Z',
    '2028-01-01T00:00:00',
    '2028-01-01T00:00:00+00:00',
    '2028-01-01T00:00:00z',
    '2028-01-01',
    '2028-01-01T00:00:00.1Z',
    '1969-12-31T23:59:59Z',
    ' 2028-01-01T00:00:00Z',
  ]) {
    assert.equal(parseTokenExpiry(value), undefined, value);
  }
});
test('review description has exact UTC and milliseconds without Date-range regression', () => {
  assert.equal(
    tokenExpiryDescription(0),
    'UTC: 1970-01-01T00:00:00.000Z; expiry (Unix milliseconds): 0',
  );
  assert.match(
    tokenExpiryDescription(Number.MAX_SAFE_INTEGER),
    /expiry \(Unix milliseconds\): 9007199254740991/u,
  );
});
test('UTC panel review never sends before confirm and sends unchanged server payload once', async () => {
  const root = new Element();
  const requests: unknown[] = [];
  const app = mountTokenIssuancePanel(root, async (path, init) => {
    assert.equal(path, '/management/v1/proxy-tokens');
    requests.push(JSON.parse(String(init.body)));
    return Response.json({ credentialId: 'credential', token: 'synthetic' }, { status: 201 });
  });
  assert.match(text(root), /UTC/u);
  enter(root, '2028-02-29T12:34:56.123Z');
  assert.equal(requests.length, 0);
  assert.match(text(root), /UTC: 2028-02-29T12:34:56.123Z/u);
  click(root, 'Confirm issuance');
  await tick();
  assert.deepEqual(requests, [
    { principalId: 'principal', expiresAt: Date.parse('2028-02-29T12:34:56.123Z') },
  ]);
  app.dispose();
});
test('invalid calendar blocks transport and cancellation clears all input nodes', () => {
  const root = new Element();
  let calls = 0;
  const app = mountTokenIssuancePanel(root, async () => {
    calls++;
    throw new Error();
  });
  enter(root, '2026-02-29T12:00:00Z');
  assert.match(text(root), /valid/u);
  assert.equal(
    nodes(root).some((n) => n.textContent === 'Confirm issuance'),
    false,
  );
  enter(root, '2028-01-01T00:00:00Z');
  click(root, 'Cancel');
  const retained = nodes(root).filter((n) => n.tag === 'input');
  assert.ok(retained.every((n) => n.value === ''));
  const expiry = retained[1];
  assert.ok(expiry);
  expiry.value = '2028-01-01T00:00:00Z';
  app.dispose();
  assert.ok(retained.every((n) => n.value === ''));
  assert.equal(calls, 0);
});
