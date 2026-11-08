import assert from 'node:assert/strict';
import test from 'node:test';
import { mountSsoUsageWorkspace } from '../src/management/sso-usage-workspace.ts';
import { TokenElement } from './token-management-dom-fixture.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));
const event = {
  eventId: '9',
  occurredAt: 10,
  kind: 'route-unavailable',
  requestId: 'request',
  principalId: 'human',
  credentialId: 'credential',
  policyVersions: [],
  details: { modelAlias: 'approved-model' },
};
function page(empty = false, next: string | null = null) {
  return Response.json(
    {
      object: 'list',
      data: empty ? [] : [{ ...event, eventId: next ? '9' : '8' }],
      next_cursor: next,
    },
    {
      headers: {
        'x-audit-has-more': String(next !== null),
        ...(next ? { 'x-audit-next-cursor': next } : {}),
      },
    },
  );
}

test('mounted Audit uses current identity, filters and page-scoped CSV; navigation clears private DOM', async (t) => {
  const root = new TokenElement();
  const paths: string[] = [];
  const app = mountSsoUsageWorkspace(root, new EventTarget(), { now: () => 100 });
  t.after(() => app.dispose());
  await app.authorize({
    expiresAt: 200,
    request: async (path) => {
      paths.push(path);
      if (path.endsWith('/me')) return Response.json({ principalId: 'human' });
      if (path.includes('/audit?')) {
        const url = new URL(path, 'https://test.invalid');
        if (url.searchParams.get('format') === 'csv')
          return new Response('event_id\r\n9\r\n', {
            headers: { 'content-type': 'text/csv', 'x-audit-has-more': 'false' },
          });
        return page(false, url.searchParams.has('cursor') ? null : '9');
      }
      return Response.json({ object: 'list', data: [] });
    },
  });
  root.button('Audit').click();
  await settle();
  assert.match(root.text(), /route-unavailable/);
  assert.equal(paths[1], '/management/v1/me');
  root.named('model').value = 'approved-model';
  root.named('principalId').value = 'human';
  root.named('from').value = '1970-01-01T00:00:00';
  root.named('audit-filters').submit();
  await settle();
  assert.match(paths.at(-1) ?? '', /model=approved-model/);
  assert.match(paths.at(-1) ?? '', /from_ms=0/);
  root.button('Next page').click();
  await settle();
  assert.match(paths.at(-1) ?? '', /cursor=9/);
  root.button('Export current page CSV').click();
  await settle();
  assert.match(root.text(), /event_id\r\n9/);
  assert.match(paths.at(-1) ?? '', /cursor=9/);
  const stale = root.button('Export current page CSV');
  root.button('Account').click();
  await settle();
  assert.doesNotMatch(root.text(), /event_id|route-unavailable/);
  const count = paths.length;
  stale.click();
  await settle();
  assert.equal(paths.length, count);
});

test('Audit suppresses late identity and never calls audit after pagehide', async (t) => {
  const root = new TokenElement();
  const lifecycle = new EventTarget();
  let resolve!: (response: Response) => void;
  const paths: string[] = [];
  const app = mountSsoUsageWorkspace(root, lifecycle, { now: () => 100 });
  t.after(() => app.dispose());
  await app.authorize({
    expiresAt: 200,
    request: async (path) => {
      paths.push(path);
      return path.endsWith('/me')
        ? new Promise<Response>((done) => {
            resolve = done;
          })
        : Response.json({ object: 'list', data: [] });
    },
  });
  root.button('Audit').click();
  lifecycle.dispatchEvent(new Event('pagehide'));
  resolve(Response.json({ principalId: 'private-stale' }));
  await settle();
  assert.equal(
    paths.some((path) => path.includes('/audit?')),
    false,
  );
  assert.doesNotMatch(root.text(), /private-stale/);
});

test('Audit empty, loading, denial and unavailable never leak response errors', async (t) => {
  const root = new TokenElement();
  const app = mountSsoUsageWorkspace(root, new EventTarget(), { now: () => 100 });
  t.after(() => app.dispose());
  for (const status of [200, 403, 503]) {
    let complete!: (response: Response) => void;
    await app.authorize({
      expiresAt: 200,
      request: async (path) => {
        if (path.endsWith('/me')) return Response.json({ principalId: 'human' });
        if (path.includes('/audit?'))
          return new Promise<Response>((done) => {
            complete = done;
          });
        return Response.json({ object: 'list', data: [] });
      },
    });
    root.button('Audit').click();
    await settle();
    assert.match(root.text(), /Loading audit/);
    complete(status === 200 ? page(true) : new Response('private-error', { status }));
    await settle();
    assert.match(
      root.text(),
      status === 200 ? /No audit events/ : status === 403 ? /Access denied/ : /Audit unavailable/,
    );
    assert.doesNotMatch(root.text(), /private-error/);
  }
});

test('Audit invalid UTC is rejected locally; expiry erases CSV and detached filters cannot dispatch', async (t) => {
  const root = new TokenElement();
  let time = 100;
  let paths = 0;
  const app = mountSsoUsageWorkspace(root, new EventTarget(), { now: () => time });
  t.after(() => app.dispose());
  await app.authorize({
    expiresAt: 200,
    request: async (path) => {
      paths++;
      if (path.endsWith('/me')) return Response.json({ principalId: 'human' });
      if (path.includes('format=csv'))
        return new Response('<script>private-csv</script>', {
          headers: { 'content-type': 'text/csv', 'x-audit-has-more': 'false' },
        });
      return path.includes('/audit?') ? page() : Response.json({ object: 'list', data: [] });
    },
  });
  root.button('Audit').click();
  await settle();
  root.named('from').value = '2026-02-30T00:00:00';
  const before = paths;
  root.named('audit-filters').submit();
  await settle();
  assert.equal(paths, before);
  assert.match(root.text(), /Invalid audit filters/);
  root.named('from').value = '';
  root.named('audit-filters').submit();
  await settle();
  root.button('Export current page CSV').click();
  await settle();
  assert.match(root.text(), /private-csv/);
  assert.equal(
    root.all().some((node) => node.tag === 'script'),
    false,
  );
  const stale = root.named('audit-filters');
  time = 200;
  root.button('Models').click();
  assert.doesNotMatch(root.text(), /private-csv|route-unavailable/);
  const count = paths;
  stale.submit();
  assert.equal(paths, count);
});

test('Audit never requests history for malformed identity or mismatched principal events', async (t) => {
  const root = new TokenElement();
  const app = mountSsoUsageWorkspace(root, new EventTarget(), { now: () => 100 });
  t.after(() => app.dispose());
  for (const malformed of [true, false]) {
    let calls = 0;
    await app.authorize({
      expiresAt: 200,
      request: async (path) => {
        if (path.endsWith('/me'))
          return Response.json(
            malformed
              ? { principalId: 'human', claims: 'private-claims' }
              : { principalId: 'other-human' },
          );
        if (path.includes('/audit?')) {
          calls++;
          return page();
        }
        return Response.json({ object: 'list', data: [] });
      },
    });
    root.button('Audit').click();
    await settle();
    assert.equal(calls, malformed ? 0 : 1);
    assert.doesNotMatch(root.text(), /private-claims|route-unavailable|credential/);
    assert.match(root.text(), malformed ? /Current principal unavailable/ : /Audit unavailable/);
  }
});

test('actual compiled workspace mounts Audit and compiled public entry has no ambient authority', async (t) => {
  const { buildManagementBrowser } = await import('../scripts/build-management-browser.ts');
  const source = await buildManagementBrowser({
    root: process.cwd(),
    entry: 'src/management/sso-usage-workspace.ts',
  });
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  );
  const root = new TokenElement();
  const app = module.mountSsoUsageWorkspace(root, new EventTarget(), { now: () => 100 });
  t.after(() => app.dispose());
  await app.authorize({
    expiresAt: 200,
    request: async (path: string) =>
      path.endsWith('/me')
        ? Response.json({ principalId: 'human' })
        : path.includes('/audit?')
          ? page()
          : Response.json({ object: 'list', data: [] }),
  });
  root.button('Audit').click();
  await settle();
  assert.match(root.text(), /route-unavailable/);
  app.clear();
  assert.doesNotMatch(root.text(), /route-unavailable/);
  const entry = await buildManagementBrowser({
    root: process.cwd(),
    entry: 'src/management/sso-catalog-entry.ts',
  });
  assert.ok(entry.includes('Audit history'));
  assert.equal(/node:|process\.env|gateway_audit_events|SELECT event_id/.test(entry), false);
});
