import assert from 'node:assert/strict';
import test from 'node:test';
import { mountSsoUsageWorkspace } from '../src/management/sso-usage-workspace.ts';
import { TokenElement } from './token-management-dom-fixture.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
test('Account reads approved current principal and clears it on navigation/logout', async (t) => {
  const root = new TokenElement();
  const paths: string[] = [];
  const app = mountSsoUsageWorkspace(root, new EventTarget(), { now: () => 100 });
  t.after(() => app.dispose());
  await app.authorize({
    expiresAt: 200,
    request: async (path) => {
      paths.push(path);
      return path.endsWith('/me')
        ? Response.json({ principalId: 'human-admin' })
        : Response.json({ object: 'list', data: [] });
    },
  });
  root.button('Account').click();
  await settle();
  assert.match(root.text(), /Current principal: human-admin/);
  assert.deepEqual(paths, ['/management/v1/models', '/management/v1/me']);
  root.button('Models').click();
  await settle();
  assert.doesNotMatch(root.text(), /human-admin/);
  app.clear();
  app.dispose();
});

test('Account loading is cancelled on navigation, renewal, expiry and pagehide; late identity is suppressed', async (t) => {
  const root = new TokenElement();
  const lifecycle = new EventTarget();
  let time = 100;
  const app = mountSsoUsageWorkspace(root, lifecycle, { now: () => time });
  t.after(() => app.dispose());
  let complete!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  const grant = {
    expiresAt: 200,
    request: async (path: string, init: RequestInit) => {
      if (path.endsWith('/me')) {
        signal = init.signal;
        return new Promise<Response>((resolve) => {
          complete = resolve;
        });
      }
      return Response.json({ object: 'list', data: [] });
    },
  };
  for (const action of ['navigate', 'renew', 'expire', 'hide']) {
    time = 100;
    await app.authorize(grant);
    root.button('Account').click();
    assert.match(root.text(), /Loading current principal/);
    if (action === 'navigate') root.button('Models').click();
    if (action === 'renew') await app.authorize(grant);
    if (action === 'expire') {
      time = 200;
      root.button('Models').click();
    }
    if (action === 'hide') lifecycle.dispatchEvent(new Event('pagehide'));
    assert.equal(signal?.aborted, true);
    complete(Response.json({ principalId: 'stale-private-human' }));
    await settle();
    assert.doesNotMatch(root.text(), /stale-private-human/);
    lifecycle.dispatchEvent(new Event('pageshow'));
  }
});

test('Account errors and malformed/oversize bodies never disclose private text or partial identity', async (t) => {
  const root = new TokenElement();
  const app = mountSsoUsageWorkspace(root, new EventTarget(), { now: () => 100 });
  t.after(() => app.dispose());
  const cases = [
    new Response('private-error-secret', { status: 503 }),
    Response.json({ principalId: 'private-error-secret', claims: 'private-claims' }),
    Response.json({ principalId: '' }),
    Response.json({ principalId: 'x'.repeat(257) }),
    Response.json(
      { principalId: 'private-error-secret' },
      { headers: { 'content-length': '4097' } },
    ),
    new Response(' '.repeat(4097), { headers: { 'content-type': 'application/json' } }),
    new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
    new Response('{"principalId":"private-error-secret"}', {
      headers: { 'content-type': 'text/html' },
    }),
  ];
  for (const response of cases) {
    await app.authorize({
      expiresAt: 200,
      request: async (path) =>
        path.endsWith('/me') ? response : Response.json({ object: 'list', data: [] }),
    });
    root.button('Account').click();
    await settle();
    assert.match(root.text(), /Current principal unavailable/);
    assert.doesNotMatch(root.text(), /private-error-secret|private-claims/);
  }
});

test('Account auth failures clear shared authority and cannot reuse identity or mutate credentials', async (t) => {
  for (const status of [401, 403]) {
    const root = new TokenElement();
    const paths: string[] = [];
    const app = mountSsoUsageWorkspace(root, new EventTarget(), { now: () => 100 });
    t.after(() => app.dispose());
    await app.authorize({
      expiresAt: 200,
      request: async (path) => {
        paths.push(path);
        return path.endsWith('/me')
          ? new Response('private-denial', { status })
          : Response.json({ object: 'list', data: [] });
      },
    });
    root.button('Account').click();
    await settle();
    assert.match(root.text(), status === 401 ? /Sign-in required/ : /Access denied/);
    root.button('Credentials').click();
    assert.doesNotMatch(root.text(), /Confirm issuance|private-denial/);
    assert.equal(paths.length, 2);
  }
});

test('Account deadline settles even when the trusted request ignores abort', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { mountManagementPrincipal } = await import('../src/management/principal-app.ts');
  const root = new TokenElement();
  const app = mountManagementPrincipal(root);
  t.after(() => app.dispose());
  const reading = app.authorize({
    expiresAt: Date.now() + 60000,
    request: async () => new Promise<Response>(() => {}),
  });
  assert.match(root.text(), /Loading current principal/);
  t.mock.timers.tick(30000);
  await reading;
  assert.match(root.text(), /Current principal unavailable/);
});

test('Account deadline aborts a stalled body and ignores its late private payload', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { mountManagementPrincipal } = await import('../src/management/principal-app.ts');
  const root = new TokenElement();
  const app = mountManagementPrincipal(root);
  t.after(() => app.dispose());
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const reading = app.authorize({
    expiresAt: Date.now() + 60000,
    request: async () => new Response(body, { headers: { 'content-type': 'application/json' } }),
  });
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(30000);
  await reading;
  assert.equal(cancelled, true);
  assert.match(root.text(), /Current principal unavailable/);
});
