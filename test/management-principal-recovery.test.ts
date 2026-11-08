import assert from 'node:assert/strict';
import test from 'node:test';
import { mountSsoUsageWorkspace } from '../src/management/sso-usage-workspace.ts';
import { TokenElement } from './token-management-dom-fixture.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 15));

for (const [view, failure] of ['Account', 'Audit'].flatMap((view) =>
  ['503', 'transport', 'malformed'].map((failure) => [view, failure] as const),
)) {
  test(`${view} ${failure} explicitly retries unavailable identity before showing protected data`, async (t) => {
    const root = new TokenElement();
    let attempts = 0;
    let audit = 0;
    const app = mountSsoUsageWorkspace(root, new EventTarget(), { now: () => 100 });
    t.after(() => app.dispose());
    await app.authorize({
      expiresAt: 200,
      request: async (path) => {
        if (path.endsWith('/me')) {
          attempts++;
          if (attempts === 1) {
            if (failure === 'transport') throw Error('private-error');
            if (failure === 'malformed') return Response.json({ privateError: 'private-error' });
            return new Response('private-error', { status: 503 });
          }
          return Response.json({ principalId: 'human' });
        }
        if (path.includes('/audit?')) {
          audit++;
          return Response.json(
            { object: 'list', data: [], next_cursor: null },
            { headers: { 'x-audit-has-more': 'false' } },
          );
        }
        return Response.json({ object: 'list', data: [] });
      },
    });
    root.button(view).click();
    await settle();
    assert.equal(attempts, 1, 'no automatic retry');
    assert.equal(audit, 0);
    assert.match(root.text(), /Current principal unavailable/);
    assert.doesNotMatch(root.text(), /private-error/);
    const retry = root.button('Retry current principal');
    retry.click();
    retry.click();
    await settle();
    assert.equal(attempts, 2, 'one explicit retry only');
    if (view === 'Account') assert.match(root.text(), /Current principal: human/);
    else {
      assert.equal(audit, 1);
      assert.match(root.text(), /No audit events/);
    }
    retry.click();
    await settle();
    assert.equal(attempts, 2, 'detached retry inert');
  });
}

for (const action of [
  'navigation',
  'renewal',
  'expiry',
  'pagehide',
  'dispose',
  'denied',
] as const) {
  test(`principal retry cannot survive ${action}`, async (t) => {
    const root = new TokenElement();
    const lifecycle = new EventTarget();
    let time = 100;
    let calls = 0;
    const app = mountSsoUsageWorkspace(root, lifecycle, { now: () => time });
    t.after(() => app.dispose());
    const grant = {
      expiresAt: 200,
      request: async (path: string) => {
        calls++;
        return path.endsWith('/me')
          ? new Response(null, { status: 503 })
          : Response.json({ object: 'list', data: [] });
      },
    };
    await app.authorize(grant);
    root.button('Account').click();
    await settle();
    const retry = root.button('Retry current principal');
    if (action === 'navigation') root.button('Models').click();
    if (action === 'renewal') await app.authorize(grant);
    if (action === 'expiry') time = 200;
    if (action === 'pagehide') lifecycle.dispatchEvent(new Event('pagehide'));
    if (action === 'dispose') app.dispose();
    if (action === 'denied') app.clear('denied');
    const before = calls;
    retry.click();
    await settle();
    assert.equal(calls, before);
    if (action === 'expiry') assert.match(root.text(), /Session expired/);
  });
}

for (const status of [401, 403]) {
  test(`identity ${status} has no retry and clears host authority`, async (t) => {
    const root = new TokenElement();
    let calls = 0;
    const app = mountSsoUsageWorkspace(root, new EventTarget(), { now: () => 100 });
    t.after(() => app.dispose());
    await app.authorize({
      expiresAt: 200,
      request: async (path) => {
        calls++;
        return path.endsWith('/me')
          ? new Response('private-denial', { status })
          : Response.json({ object: 'list', data: [] });
      },
    });
    root.button('Account').click();
    await settle();
    assert.match(root.text(), status === 401 ? /Sign-in required/ : /Access denied/);
    assert.doesNotMatch(root.text(), /Retry current principal|private-denial/);
    const before = calls;
    root.button('Audit').click();
    await settle();
    assert.equal(calls, before);
  });
}

test('deadline exposes one explicit recovery action without retrying a hung transport', async (t) => {
  const { mountManagementPrincipal } = await import('../src/management/principal-app.ts');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const root = new TokenElement();
  let requests = 0;
  let recoveries = 0;
  const app = mountManagementPrincipal(root, {
    onRetry: () => {
      recoveries++;
    },
  });
  t.after(() => app.dispose());
  const operation = app.authorize({
    expiresAt: 999999,
    request: async () => {
      requests++;
      return new Promise<Response>(() => {});
    },
  });
  assert.match(root.text(), /Loading current principal/);
  t.mock.timers.tick(30000);
  await operation;
  assert.match(root.text(), /Current principal unavailable/);
  assert.equal(requests, 1);
  const retry = root.button('Retry current principal');
  retry.click();
  retry.click();
  assert.equal(recoveries, 1);
  assert.equal(requests, 1, 'view does not hold or acquire retry authority');
});
