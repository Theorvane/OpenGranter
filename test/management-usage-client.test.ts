import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createSsoUsageHistoryServer } from '../src/gateway/sso-usage-history-http.ts';
import { createManagementUsageClient } from '../src/management/usage-client.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

const row = buildUsageRecord({
  principalId: 'human',
  credentialId: 'credential',
  policyVersions: [],
  requestId: 'request',
  attemptId: 'attempt',
  modelAlias: 'chat',
  routeKind: 'managed',
  upstreamModelId: 'model',
  selectedCandidateId: 'candidate',
  occurredAt: 2,
  latencyMs: 10,
  outcome: 'succeeded',
  possiblyBilled: true,
  possibleDuplicate: true,
  estimatedCost: { amountDecimal: '0.01', currency: 'USD', priceVersion: 'v1' },
});
const page = { object: 'list', data: [row], has_more: false, next_cursor: null };

test('real HTTP API client filters, preserves unknown usage/costs, pages and exports CSV', async () => {
  const seen: string[] = [];
  const cursor = Buffer.from(JSON.stringify([2, 'attempt'])).toString('base64url');
  const server = createSsoUsageHistoryServer({
    newRequestId: () => 'trusted',
    usage: {
      async read(token, _id, query) {
        assert.equal(token, 'authorized-port');
        seen.push(query);
        const params = new URLSearchParams(query);
        if (params.get('principal_id') === 'other') return { state: 'forbidden' };
        if (params.get('model') === 'empty')
          return { state: 'ready', format: 'json', data: [], hasMore: false, nextCursor: null };
        if (params.get('format') === 'csv')
          return {
            state: 'ready',
            format: 'csv',
            csv: 'request_id\r\nrequest\r\n',
            hasMore: true,
            nextCursor: cursor,
          };
        return { state: 'ready', format: 'json', data: [row], hasMore: true, nextCursor: cursor };
      },
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('no address');
  const client = createManagementUsageClient((path, init) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: 'Bearer authorized-port' },
    }),
  );
  try {
    const result = await client.list({ model: 'chat/a&b', fromMs: 0, toMs: 10, limit: 1, cursor });
    assert.equal(result.state, 'ready');
    if (result.state !== 'ready') throw Error('not ready');
    assert.deepEqual(result.data.records, [row]);
    assert.equal(result.data.records[0]?.usage.totalTokens, null);
    assert.equal(result.data.records[0]?.upstreamBilledCost, null);
    assert.equal(result.data.records[0]?.estimatedCost?.amountDecimal, '0.01');
    assert.equal(result.data.records[0]?.possibleDuplicate, true);
    assert.equal(result.data.nextCursor, cursor);
    const params = new URLSearchParams(seen[0]);
    assert.equal(params.has('principal_id'), false);
    assert.equal(params.get('model'), 'chat/a&b');
    assert.equal(params.get('from_ms'), '0');
    assert.equal(params.get('to_ms'), '10');
    assert.equal(params.get('limit'), '1');
    assert.equal(params.get('cursor'), cursor);
    assert.equal(params.get('format'), 'json');
    const empty = await client.list({ model: 'empty' });
    assert.deepEqual(empty, {
      state: 'ready',
      data: { records: [], hasMore: false, nextCursor: null },
    });
    assert.deepEqual(await client.list({ principalId: 'other' }), { state: 'denied' });
    const csv = await client.csv({ limit: 1 });
    assert.deepEqual(csv, {
      state: 'ready',
      data: { csv: 'request_id\r\nrequest\r\n', hasMore: true, nextCursor: cursor },
    });
    assert.equal(seen.length, 4); // No implicit cursor-following/export-all.
  } finally {
    client.invalidate();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('status mapping never reads private error bodies; requests carry no credentials', async () => {
  for (const [status, state] of [
    [400, 'invalid_query'],
    [401, 'unauthenticated'],
    [403, 'denied'],
    [404, 'unavailable'],
    [503, 'unavailable'],
  ] as const) {
    let read = false;
    const client = createManagementUsageClient(async (path, init) => {
      assert.equal(path, '/management/v1/usage?format=json');
      assert.equal(init.cache, 'no-store');
      assert.equal(init.redirect, 'error');
      assert.equal(init.method, 'GET');
      assert.equal(init.credentials, 'omit');
      assert.deepEqual(init.headers, { accept: 'application/json' });
      return new Response(
        new ReadableStream(
          {
            pull() {
              read = true;
            },
          },
          { highWaterMark: 0 },
        ),
        { status },
      );
    });
    assert.deepEqual(await client.list(), { state });
    assert.equal(read, false);
  }
});

test('allowlist projection, strict paging/record/media validation and response byte cap', async () => {
  const client = (
    body: unknown,
    headers: Record<string, string> = { 'content-type': 'application/json' },
  ) => createManagementUsageClient(async () => new Response(JSON.stringify(body), { headers }));
  const result = await client({
    ...page,
    secret: 'private',
    data: [{ ...row, secret: 'private' }],
  }).list();
  assert.deepEqual(result, {
    state: 'ready',
    data: { records: [row], hasMore: false, nextCursor: null },
  });
  for (const body of [
    null,
    {},
    { ...page, object: 'other' },
    { ...page, has_more: true },
    { ...page, next_cursor: 'unexpected' },
    { ...page, data: [{ ...row, usage: { status: 'reported', totalTokens: null } }] },
    { ...page, data: Array.from({ length: 101 }, () => row) },
    { ...page, has_more: true, next_cursor: 'invalid\r\n' },
  ])
    assert.deepEqual(await client(body).list(), { state: 'unavailable' });
  assert.deepEqual(await client(page, { 'content-type': 'text/html' }).list(), {
    state: 'unavailable',
  });
  assert.deepEqual(
    await client(page, { 'content-type': 'application/json', 'content-length': '1048577' }).list(),
    { state: 'unavailable' },
  );
  const big = createManagementUsageClient(
    async () =>
      new Response(' '.repeat(1048577), { headers: { 'content-type': 'application/json' } }),
  );
  assert.deepEqual(await big.list(), { state: 'unavailable' });
});

test('CSV requires valid paging headers/media; cursor is opaque encoded once', async () => {
  const client = createManagementUsageClient(async (path) => {
    assert.equal(new URL(path, 'https://local').searchParams.get('cursor'), 'abc_-');
    return new Response('csv', {
      headers: { 'content-type': 'text/csv', 'x-usage-has-more': 'false' },
    });
  });
  assert.deepEqual(await client.csv({ cursor: 'abc_-' }), {
    state: 'ready',
    data: { csv: 'csv', hasMore: false, nextCursor: null },
  });
  for (const headers of [
    {},
    { 'content-type': 'text/csv' },
    { 'content-type': 'text/csv', 'x-usage-has-more': 'true' },
    { 'content-type': 'text/csv', 'x-usage-has-more': 'false', 'x-usage-next-cursor': 'abc' },
  ]) {
    const invalid = createManagementUsageClient(async () => new Response('private', { headers }));
    assert.deepEqual(await invalid.csv(), { state: 'unavailable' });
  }
});

test('invalid filters fail locally without reading a port', async () => {
  let calls = 0;
  const client = createManagementUsageClient(async () => {
    calls++;
    return Response.json(page);
  });
  for (const filters of [
    { limit: 0 },
    { limit: 101 },
    { model: '' },
    { principalId: '' },
    { fromMs: -1 },
    { fromMs: 2, toMs: 2 },
    { cursor: 'x&model=other' },
  ])
    assert.deepEqual(await client.list(filters), { state: 'invalid_query' });
  assert.equal(calls, 0);
});

test('new read and invalidate cancel ignored aborts and prevent late publication', async () => {
  let resolve: ((response: Response) => void) | undefined;
  let count = 0;
  const client = createManagementUsageClient(async () => {
    if (++count === 1)
      return new Promise<Response>((done) => {
        resolve = done;
      });
    return Response.json(page);
  });
  const old = client.list();
  assert.equal((await client.list()).state, 'ready');
  assert.deepEqual(await old, { state: 'cancelled' });
  resolve?.(Response.json(page));
  const hung = createManagementUsageClient(() => new Promise<Response>(() => {}));
  const pending = hung.list();
  hung.invalidate();
  assert.deepEqual(await pending, { state: 'cancelled' });
});

test('deadline covers uncooperative request and stream', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const port of [
    () => new Promise<Response>(() => {}),
    async () =>
      new Response(
        new ReadableStream({
          pull() {
            return new Promise<void>(() => {});
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  ]) {
    const pending = createManagementUsageClient(port).list();
    await Promise.resolve();
    await Promise.resolve();
    t.mock.timers.tick(30_001);
    assert.deepEqual(await pending, { state: 'unavailable' });
  }
});

test('exact request transport on JSON/CSV and mismatched JSON rejection', async () => {
  const seen: string[] = [];
  const client = createManagementUsageClient(async (path) => {
    seen.push(path);
    if (path.includes('format=csv'))
      return new Response('safe,csv', {
        headers: { 'content-type': 'text/csv', 'x-usage-has-more': 'false' },
      });
    return Response.json(page);
  });
  assert.equal((await client.list({ requestId: 'request' })).state, 'ready');
  assert.equal((await client.list({ requestId: 'different' })).state, 'unavailable');
  assert.equal((await client.csv({ requestId: 'request' })).state, 'ready');
  assert.equal(new URL(seen[2] ?? '', 'http://local').searchParams.get('request_id'), 'request');
  const count = seen.length;
  for (const requestId of ['', 'x y', 'a'.repeat(257), 'x\n'])
    assert.equal((await client.list({ requestId })).state, 'invalid_query');
  assert.equal(seen.length, count);
  client.invalidate();
});
