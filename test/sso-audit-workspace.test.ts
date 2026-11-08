import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import type { CatalogRequest } from '../src/management/catalog-client.ts';
import { createManagementSsoAuditWorkspace } from '../src/management/sso-audit-workspace.ts';

const event = {
  eventId: '9',
  occurredAt: 10,
  kind: 'models-listed',
  requestId: 'request',
  principalId: 'human',
  credentialId: 'credential',
  policyVersions: [],
  details: { count: 0 },
};
function page(id = '9', next: string | null = null) {
  return Response.json(
    { object: 'list', data: [{ ...event, eventId: id }], next_cursor: next },
    {
      headers: {
        'x-audit-has-more': String(next !== null),
        ...(next ? { 'x-audit-next-cursor': next } : {}),
      },
    },
  );
}
function setup(request: CatalogRequest) {
  let time = 10;
  let timer = () => {};
  const changes: string[] = [];
  const workspace = createManagementSsoAuditWorkspace({
    now: () => time,
    schedule: (_delay, callback) => {
      timer = callback;
      return () => {};
    },
    onChange: (snapshot) => changes.push(snapshot.state),
  });
  const grant = { request, principalId: 'human', expiresAt: 100 };
  workspace.authorize(grant);
  return {
    workspace,
    grant,
    changes,
    expire: () => {
      time = 100;
      timer();
    },
  };
}

test('audit workspace replays captured filters/cursors and exports only the current page', async () => {
  const seen: URL[] = [];
  const { workspace } = setup(async (path) => {
    const url = new URL(path, 'https://test.invalid');
    seen.push(url);
    if (url.searchParams.get('format') === 'csv')
      return new Response('event_id\r\n8\r\n', {
        headers: { 'content-type': 'text/csv', 'x-audit-has-more': 'false' },
      });
    return url.searchParams.has('cursor') ? page('8') : page('9', '9');
  });
  const filters = { limit: 1, fromMs: 0 };
  const loading = workspace.load(filters);
  filters.limit = 2;
  await loading;
  assert.equal(workspace.snapshot().state, 'ready');
  assert.equal(workspace.snapshot().canNext, true);
  await workspace.next();
  assert.equal(workspace.snapshot().page?.events[0]?.eventId, '8');
  assert.equal(workspace.snapshot().canPrevious, true);
  await workspace.exportCsv();
  assert.equal(workspace.snapshot().csv?.csv, 'event_id\r\n8\r\n');
  assert.equal(seen.at(-1)?.searchParams.get('cursor'), '9');
  assert.equal(seen.at(-1)?.searchParams.get('limit'), '1');
  await workspace.previous();
  assert.equal(workspace.snapshot().csv, undefined);
  assert.equal(seen.at(-1)?.searchParams.has('cursor'), false);
  assert.equal(workspace.snapshot().canPrevious, false);
  const copy = workspace.snapshot();
  if (copy.page) (copy.page.events as unknown[]).length = 0;
  assert.equal(workspace.snapshot().page?.events.length, 1);
  workspace.dispose();
});

test('empty, invalid query and server unavailable clear previous page/export', async () => {
  let response = page();
  const { workspace } = setup(async () => response.clone());
  await workspace.load();
  await workspace.load({ limit: 0 });
  assert.equal(workspace.snapshot().state, 'invalid_query');
  assert.equal(workspace.snapshot().page, undefined);
  response = Response.json(
    { object: 'list', data: [], next_cursor: null },
    { headers: { 'x-audit-has-more': 'false' } },
  );
  await workspace.load();
  assert.equal(workspace.snapshot().state, 'empty');
  response = new Response(null, { status: 503 });
  await workspace.load();
  assert.equal(workspace.snapshot().state, 'unavailable');
  assert.equal(workspace.snapshot().page, undefined);
  workspace.dispose();
});

test('expiry, uncertain clock and authority errors revoke all private state', async () => {
  const { workspace, expire, grant } = setup(async () => page());
  await workspace.load();
  expire();
  assert.equal(workspace.snapshot().state, 'expired');
  assert.equal(workspace.snapshot().page, undefined);
  await workspace.load();
  assert.equal(workspace.snapshot().state, 'expired');
  workspace.authorize({
    ...grant,
    request: async () => new Response(null, { status: 403 }),
    expiresAt: 200,
  });
  await workspace.load();
  assert.equal(workspace.snapshot().state, 'denied');
  workspace.authorize({ ...grant, expiresAt: NaN });
  assert.equal(workspace.snapshot().state, 'expired');
  workspace.dispose();
  const broken = createManagementSsoAuditWorkspace({
    now: () => {
      throw Error('private');
    },
  });
  broken.authorize(grant);
  assert.equal(broken.snapshot().state, 'expired');
  broken.dispose();
});

test('logout, supersession, renewal and disposal suppress uncooperative late transport', async () => {
  let resolve!: (response: Response) => void;
  const { workspace, grant } = setup(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  const pending = workspace.load();
  workspace.clear();
  resolve(page());
  await pending;
  assert.equal(workspace.snapshot().state, 'unauthenticated');
  workspace.authorize(grant);
  const old = workspace.load();
  const oldResolve = resolve;
  workspace.authorize({ ...grant, request: async () => page('7') });
  await workspace.load();
  oldResolve(page());
  await old;
  assert.equal(workspace.snapshot().page?.events[0]?.eventId, '7');
  workspace.dispose();
  assert.equal(workspace.snapshot().state, 'disposed');
  await workspace.load();
  assert.equal(workspace.snapshot().page, undefined);
});

test('observer cannot revive old load through synchronous authority replacement', async () => {
  let calls = 0;
  let switched = false;
  const workspace = createManagementSsoAuditWorkspace({
    now: () => 1,
    schedule: () => () => {},
    onChange: (snapshot) => {
      if (snapshot.state === 'loading' && !switched) {
        switched = true;
        workspace.clear();
      }
      throw Error('observer diagnostics');
    },
  });
  workspace.authorize({
    principalId: 'human',
    expiresAt: 100,
    request: async () => {
      calls++;
      return page();
    },
  });
  await workspace.load();
  assert.equal(calls, 0);
  assert.equal(workspace.snapshot().state, 'unauthenticated');
  workspace.dispose();
});

test('paused expiry timers cannot expose cached snapshots or dispatch new reads', async () => {
  let time = 1;
  let calls = 0;
  const workspace = createManagementSsoAuditWorkspace({
    now: () => time,
    schedule: () => () => {},
  });
  workspace.authorize({
    principalId: 'human',
    expiresAt: 2,
    request: async () => {
      calls++;
      return page();
    },
  });
  await workspace.load();
  time = 2;
  assert.equal(workspace.snapshot().state, 'expired');
  assert.equal(workspace.snapshot().page, undefined);
  await workspace.exportCsv();
  await workspace.next();
  assert.equal(calls, 1);
  workspace.dispose();
});

test('grant snapshot, disposed observer and failed timer registration fail safely', async () => {
  let calls = 0;
  const first = setup(async () => {
    calls++;
    return page();
  });
  first.grant.request = async () => {
    throw Error('caller mutation');
  };
  first.grant.expiresAt = 1;
  await first.workspace.load();
  assert.equal(calls, 1);
  first.workspace.dispose();
  const failed = createManagementSsoAuditWorkspace({
    now: () => 1,
    schedule: () => {
      throw Error('timer');
    },
  });
  failed.authorize({ principalId: 'human', expiresAt: 100, request: async () => page() });
  assert.equal(failed.snapshot().state, 'unavailable');
  failed.dispose();
  const workspace = createManagementSsoAuditWorkspace({
    now: () => 1,
    schedule: () => () => {},
    onChange: (snapshot) => {
      if (snapshot.state === 'disposed')
        workspace.authorize({ principalId: 'human', expiresAt: 100, request: async () => page() });
    },
  });
  workspace.dispose();
  assert.equal(workspace.snapshot().state, 'disposed');
});

test('CSV denial clears page/history and in-flight export cannot survive filter submission', async () => {
  let complete!: (response: Response) => void;
  const { workspace } = setup(async (path) =>
    new URL(path, 'https://test.invalid').searchParams.get('format') === 'csv'
      ? new Promise<Response>((resolve) => {
          complete = resolve;
        })
      : page('9', '9'),
  );
  await workspace.load();
  const exporting = workspace.exportCsv();
  assert.equal(workspace.snapshot().state, 'exporting');
  await workspace.load();
  complete(new Response(null, { status: 401 }));
  await exporting;
  assert.equal(workspace.snapshot().state, 'ready');
  const denied = workspace.exportCsv();
  complete(new Response(null, { status: 403 }));
  await denied;
  assert.equal(workspace.snapshot().state, 'denied');
  assert.equal(workspace.snapshot().page, undefined);
  assert.equal(workspace.snapshot().canPrevious, false);
  workspace.dispose();
});

test('actual loopback HTTP adapter drives audit workspace list, next, CSV and denial', async () => {
  const { createSsoAuditHistoryServer } = await import('../src/gateway/sso-audit-history-http.ts');
  const server = createSsoAuditHistoryServer({
    newRequestId: () => 'request',
    audit: {
      async read(_token, _id, query) {
        const params = new URLSearchParams(query);
        if (params.get('principal_id') === 'other') return { state: 'forbidden' };
        if (params.get('format') === 'csv')
          return { state: 'ready', format: 'csv', csv: 'event_id\r\n8\r\n', nextCursor: null };
        return {
          state: 'ready',
          format: 'json',
          page: {
            events: [{ ...event, eventId: params.has('cursor') ? '8' : '9' }],
            nextCursor: params.has('cursor') ? null : '9',
          },
        };
      },
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const { workspace } = setup((path, init) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: 'Bearer trusted-test-port' },
    }),
  );
  try {
    await workspace.load({ limit: 1 });
    assert.equal(workspace.snapshot().state, 'ready');
    await workspace.next();
    assert.equal(workspace.snapshot().page?.events[0]?.eventId, '8');
    await workspace.exportCsv();
    assert.equal(workspace.snapshot().csv?.csv, 'event_id\r\n8\r\n');
    await workspace.load({ principalId: 'other' });
    assert.equal(workspace.snapshot().state, 'denied');
  } finally {
    workspace.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
