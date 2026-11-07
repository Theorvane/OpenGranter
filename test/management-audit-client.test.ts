import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createManagementAuditClient } from '../src/management/audit-client.ts';

const event = {
  eventId: '8',
  occurredAt: 1000,
  kind: 'models-listed',
  requestId: 'read-1',
  principalId: 'person-1',
  credentialId: 'credential-1',
  policyVersions: [{ id: 'policy-1', version: 'v1' }],
  details: { count: 1, prompt: 'private-content' },
};
const envelope = (data: unknown[] = [event], next: string | null = null) => ({
  object: 'list',
  data,
  has_more: next !== null,
  next_cursor: next,
});
const response = (value: unknown = envelope()) => Response.json(value);

test('reads exact existing audit API through explicit port and projects metadata', async () => {
  const client = createManagementAuditClient(async (path, init) => {
    assert.equal(
      path,
      '/v1/audit?principal_id=person-1&from_ms=0&to_ms=2000&limit=5&cursor=9&format=json',
    );
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    return response();
  });
  const result = await client.list({
    principalId: 'person-1',
    fromMs: 0,
    toMs: 2000,
    limit: 5,
    cursor: '9',
  });
  assert.equal(result.state, 'ready');
  if (result.state === 'ready') {
    assert.deepEqual(result.data.events[0]?.details, { count: 1 });
    assert.equal(result.data.nextCursor, null);
  }
  assert.equal(JSON.stringify(result).includes('private-content'), false);
});

test('empty pages are ready and continuations remain exact', async () => {
  const client = createManagementAuditClient(async () => response(envelope([], null)));
  assert.deepEqual(await client.list(), { state: 'ready', data: { events: [], nextCursor: null } });
  const next = createManagementAuditClient(async () => response(envelope([event], '8')));
  const result = await next.list();
  assert.equal(result.state === 'ready' && result.data.nextCursor, '8');
});

test('rejects invalid query before transport', async () => {
  const client = createManagementAuditClient(async () => {
    throw Error('must not call');
  });
  for (const filters of [
    { limit: 0 },
    { cursor: '08' },
    { cursor: '9223372036854775808' },
    { fromMs: 5, toMs: 5 },
    { principalId: '' },
    { model: '\u0000' },
  ])
    assert.deepEqual(await client.list(filters), { state: 'invalid_query' });
});

test('rejects malformed paging, ordering, principal and required event fields', async () => {
  for (const value of [
    {},
    envelope([event], '7'),
    { ...envelope(), has_more: true },
    envelope([event, event]),
    envelope([{ ...event, principalId: 'other' }]),
    envelope([{ ...event, eventId: '09' }]),
    envelope([{ ...event, credentialId: null }]),
    envelope([{ ...event, occurredAt: -1 }]),
    envelope([{ ...event, policyVersions: null }]),
    envelope([{ ...event, kind: 'unknown-event' }]),
  ]) {
    const client = createManagementAuditClient(async () => response(value));
    assert.deepEqual(await client.list({ principalId: 'person-1' }), { state: 'unavailable' });
  }
});

test('rejects mixed principals without explicit target', async () => {
  const client = createManagementAuditClient(async () =>
    response(envelope([event, { ...event, eventId: '7', principalId: 'other' }])),
  );
  assert.deepEqual(await client.list(), { state: 'unavailable' });
});

test('rejects filter leakage and oversized page', async () => {
  for (const filters of [
    { model: 'different' },
    { fromMs: 1001 },
    { toMs: 1000 },
    { cursor: '8' },
  ]) {
    const client = createManagementAuditClient(async () => response());
    assert.deepEqual(await client.list(filters), { state: 'unavailable' });
  }
  const client = createManagementAuditClient(async () =>
    response(envelope([event, { ...event, eventId: '7' }])),
  );
  assert.deepEqual(await client.list({ limit: 1 }), { state: 'unavailable' });
});

test('maps failures without consuming private bodies', async () => {
  for (const [status, state] of [
    [400, 'invalid_query'],
    [401, 'unauthenticated'],
    [403, 'denied'],
    [500, 'unavailable'],
  ] as const) {
    let consumed = false;
    const client = createManagementAuditClient(
      async () =>
        new Response(
          new ReadableStream(
            {
              pull() {
                consumed = true;
              },
            },
            { highWaterMark: 0 },
          ),
          { status },
        ),
    );
    assert.deepEqual(await client.list(), { state });
    assert.equal(consumed, false);
  }
});

test('rejects content type, malformed UTF-8, invalid JSON and oversized payloads', async () => {
  for (const make of [
    () => new Response('{}', { headers: { 'content-type': 'text/html' } }),
    () => new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }),
    () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    () => new Response('x'.repeat(1_048_577), { headers: { 'content-type': 'application/json' } }),
    () =>
      new Response('{}', {
        headers: { 'content-type': 'application/json', 'content-length': '1048577' },
      }),
  ]) {
    const client = createManagementAuditClient(async () => make());
    assert.deepEqual(await client.list(), { state: 'unavailable' });
  }
});

test('invalidation settles a port ignoring AbortSignal and drops late response', async () => {
  let complete: (value: Response) => void = () => {};
  const client = createManagementAuditClient(
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  );
  const pending = client.list();
  client.invalidate();
  assert.deepEqual(await pending, { state: 'cancelled' });
  complete(response());
});

test('new read supersedes pending work', async () => {
  let calls = 0;
  const client = createManagementAuditClient(async () =>
    ++calls === 1 ? new Promise<Response>(() => {}) : response(),
  );
  const first = client.list();
  assert.equal((await client.list()).state, 'ready');
  assert.deepEqual(await first, { state: 'cancelled' });
});

test('deadline settles an uncooperative port without retries', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const client = createManagementAuditClient(() => {
    calls++;
    return new Promise<Response>(() => {});
  });
  const pending = client.list();
  context.mock.timers.tick(30_000);
  assert.deepEqual(await pending, { state: 'unavailable' });
  assert.equal(calls, 1);
});

test('invalidation cancels a pending response stream', async () => {
  let cancelled = false;
  let opened: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    opened = resolve;
  });
  const client = createManagementAuditClient(
    async () =>
      new Response(
        new ReadableStream(
          {
            pull() {
              opened();
            },
            cancel() {
              cancelled = true;
            },
          },
          { highWaterMark: 0 },
        ),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  const pending = client.list();
  await ready;
  client.invalidate();
  assert.deepEqual(await pending, { state: 'cancelled' });
  assert.equal(cancelled, true);
});
