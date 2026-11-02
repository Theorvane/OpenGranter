import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderManagementBoundaryView } from '../src/management/boundary-view.ts';

const cases = [
  ['loading', 'Checking your session', 'status'],
  ['unauthenticated', 'Sign-in required', 'status'],
  ['expired', 'Session expired', 'alert'],
  ['denied', 'Access denied', 'alert'],
  ['unavailable', 'Management unavailable', 'alert'],
] as const;

for (const [state, heading, role] of cases) {
  test(`management boundary displays ${state} without protected content`, () => {
    const html = renderManagementBoundaryView(state);
    assert.ok(html.startsWith('<!doctype html>'));
    assert.ok(html.includes('<html lang="en">'));
    assert.ok(html.includes('<title>OpenGranter management</title>'));
    assert.ok(html.includes('name="viewport"'));
    assert.ok(html.includes('<main>'));
    assert.ok(html.includes(`<h1>${heading}</h1>`));
    assert.ok(html.includes(`role="${role}"`));
    if (state === 'loading') assert.ok(html.includes('aria-live="polite"'));
    assert.doesNotMatch(html, /<(?:a|form|input|script|nav|iframe)\b/i);
    assert.doesNotMatch(html, /localStorage|sessionStorage|fetch\(/);
  });
}

test('unknown or credential-bearing input fails closed without reflection', () => {
  for (const input of [
    undefined,
    null,
    1,
    {},
    ['loading'],
    'authenticated',
    '<script>private</script>',
    { state: 'loading', token: 'private' },
  ]) {
    assert.equal(renderManagementBoundaryView(input), renderManagementBoundaryView('unavailable'));
    assert.ok(!renderManagementBoundaryView(input).includes('private'));
  }
});

test('an expiry render cannot retain markup from an earlier state', () => {
  renderManagementBoundaryView('loading');
  assert.ok(!renderManagementBoundaryView('expired').includes('Checking your session'));
});
