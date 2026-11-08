import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createSsoAuditHistoryServer } from '../src/gateway/sso-audit-history-http.ts';
import { createManagementSsoAuditClient } from '../src/management/sso-audit-client.ts';

const event = {
  eventId: '9',
  occurredAt: 10,
  kind: 'models-listed',
  requestId: 'request',
  principalId: 'human',
  credentialId: 'credential',
  policyVersions: [{ id: 'policy', version: 'v1' }],
  details: { count: 0 },
};
function response(data: unknown = [event], next: string | null = null) {
  return Response.json(
    { object: 'list', data, next_cursor: next },
    {
      headers: {
        'x-audit-has-more': String(next !== null),
        ...(next ? { 'x-audit-next-cursor': next } : {}),
      },
    },
  );
}

test('real loopback SSO HTTP transport: JSON, exact decimal pages, empty, CSV, denial and failures', async () => {
  const seen: string[] = [];
  const server = createSsoAuditHistoryServer({
    newRequestId: () => 'request',
    audit: {
      async read(token, _id, query) {
        seen.push(query);
        if (!token) return { state: 'unauthenticated' };
        const params = new URLSearchParams(query);
        if (params.get('principal_id') === 'other') return { state: 'forbidden' };
        if (params.get('model') === 'unavailable') return { state: 'audit_unavailable' };
        if (params.get('format') === 'csv')
          return {
            state: 'ready',
            format: 'csv',
            csv: 'event_id\r\n9\r\n',
            nextCursor: '9',
          };
        return {
          state: 'ready',
          format: 'json',
          page: {
            events: params.get('model') === 'empty' ? [] : [event],
            nextCursor: params.has('cursor') || params.get('model') === 'empty' ? null : '9',
          },
        };
      },
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const client = createManagementSsoAuditClient(
    (path, init) =>
      fetch(`http://127.0.0.1:${address.port}${path}`, {
        ...init,
        headers: { ...init.headers, authorization: 'Bearer trusted-port' },
      }),
    'human',
  );
  try {
    assert.deepEqual(await client.list({ limit: 1 }), {
      state: 'ready',
      data: { events: [event], nextCursor: '9', hasMore: true },
    });
    assert.equal((await client.list({ cursor: '10', fromMs: 10, toMs: 11 })).state, 'ready');
    assert.match(seen[1] ?? '', /cursor=10/u);
    assert.deepEqual(await client.list({ model: 'empty' }), {
      state: 'ready',
      data: { events: [], nextCursor: null, hasMore: false },
    });
    assert.deepEqual(await client.csv(), {
      state: 'ready',
      data: { csv: 'event_id\r\n9\r\n', nextCursor: '9', hasMore: true },
    });
    assert.equal((await client.list({ principalId: 'other' })).state, 'denied');
    assert.equal((await client.list({ model: 'unavailable' })).state, 'unavailable');
    const anonymous = createManagementSsoAuditClient(
      (path, init) => fetch(`http://127.0.0.1:${address.port}${path}`, init),
      'human',
    );
    assert.equal((await anonymous.list()).state, 'unauthenticated');
  } finally {
    client.invalidate();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('canonical filters fail locally and never invent a cursor or target', async () => {
  let calls = 0;
  const client = createManagementSsoAuditClient(async () => {
    calls++;
    return response();
  }, 'human');
  for (const filters of [
    { cursor: '0' },
    { cursor: '092' },
    { cursor: '9223372036854775808' },
    { limit: 101 },
    { fromMs: 10, toMs: 10 },
    { principalId: '' },
    { model: '\n' },
    { fromMs: NaN },
  ]) {
    assert.equal((await client.list(filters)).state, 'invalid_query');
  }
  assert.equal(calls, 0);
  assert.throws(() => createManagementSsoAuditClient(async () => response(), ''));
});

test('JSON reprojects metadata and rejects scope/time/model/order/limit/cursor disagreement', async () => {
  const client = createManagementSsoAuditClient(
    async () =>
      response([{ ...event, secret: 'hidden', details: { count: 0, prompt: 'private' } }]),
    'human',
  );
  assert.deepEqual(await client.list(), {
    state: 'ready',
    data: { events: [event], nextCursor: null, hasMore: false },
  });
  for (const data of [
    [{ ...event, principalId: 'other' }],
    [{ ...event, occurredAt: 9 }],
    [event, event],
  ]) {
    const bad = createManagementSsoAuditClient(async () => response(data), 'human');
    assert.equal((await bad.list({ fromMs: 10, limit: 1 })).state, 'unavailable');
  }
  assert.equal((await client.list({ model: 'absent' })).state, 'unavailable');
  assert.equal((await client.list({ cursor: '9' })).state, 'unavailable');
  const mismatch = createManagementSsoAuditClient(async () => {
    const value = response([event], '9');
    value.headers.set('x-audit-next-cursor', '8');
    return value;
  }, 'human');
  assert.equal((await mismatch.list()).state, 'unavailable');
});

test('filter snapshots and transport options preserve the original target during await', async () => {
  const filters = { principalId: 'human', fromMs: 10 };
  const client = createManagementSsoAuditClient(async (path, init) => {
    assert.equal(init.cache, 'no-store');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.method, 'GET');
    assert.match(path, /^\/management\/v1\/audit\?/u);
    filters.principalId = 'other';
    filters.fromMs = 11;
    return response();
  }, 'human');
  assert.equal((await client.list(filters)).state, 'ready');
});

test('invalidation/supersession settles uncooperative transport and withholds late data', async () => {
  let resolve!: (value: Response) => void;
  let calls = 0;
  const client = createManagementSsoAuditClient(async () => {
    if (++calls === 1)
      return new Promise<Response>((done) => {
        resolve = done;
      });
    return response([]);
  }, 'human');
  const first = client.list();
  assert.equal((await client.list()).state, 'ready');
  assert.equal((await first).state, 'cancelled');
  resolve(response());
  const pending = createManagementSsoAuditClient(() => new Promise<Response>(() => {}), 'human');
  const result = pending.csv();
  pending.invalidate();
  assert.equal((await result).state, 'cancelled');
});

test('bounded strict UTF8, headers, media and errors fail privately', async () => {
  const responses = [
    new Response('private error', { status: 503 }),
    new Response('{}', { headers: { 'content-type': 'text/html' } }),
    new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }),
    new Response('x'.repeat(1_048_577), { headers: { 'content-type': 'application/json' } }),
    Response.json({ object: 'list', data: [], next_cursor: null }),
  ];
  for (const value of responses) {
    const client = createManagementSsoAuditClient(async () => value, 'human');
    assert.deepEqual(await client.list(), { state: 'unavailable' });
  }
  const csv = createManagementSsoAuditClient(
    async () =>
      new Response('id\n9', {
        headers: {
          'content-type': 'text/csv',
          'x-audit-has-more': 'true',
          'x-audit-next-cursor': '0',
        },
      }),
    'human',
  );
  assert.equal((await csv.csv()).state, 'unavailable');
});

test('request deadline settles even when injected transport ignores AbortSignal', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const client = createManagementSsoAuditClient(() => new Promise<Response>(() => {}), 'human');
  const pending = client.list();
  context.mock.timers.tick(30_000);
  assert.deepEqual(await pending, { state: 'unavailable' });
});

test('maximum decimal cursor is preserved and an explicit authorized target is isolated', async () => {
  const client = createManagementSsoAuditClient(async (path) => {
    assert.equal(
      new URL(path, 'https://test.invalid').searchParams.get('cursor'),
      '9223372036854775807',
    );
    return response([{ ...event, principalId: 'other' }], '9');
  }, 'human');
  const result = await client.list({ principalId: 'other', cursor: '9223372036854775807' });
  assert.equal(result.state, 'ready');
  if (result.state === 'ready') assert.equal(result.data.events[0]?.principalId, 'other');
});

test('logout cancels an uncooperative body read and oversized declared bodies are discarded', async () => {
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const client = createManagementSsoAuditClient(
    async () =>
      new Response(
        new ReadableStream({
          pull() {
            started();
            return new Promise<void>(() => {});
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    'human',
  );
  const result = client.list();
  await reading;
  client.invalidate();
  assert.equal((await result).state, 'cancelled');
  const oversized = createManagementSsoAuditClient(
    async () =>
      new Response('{}', {
        headers: { 'content-type': 'application/json', 'content-length': '1048577' },
      }),
    'human',
  );
  assert.equal((await oversized.list()).state, 'unavailable');
});
