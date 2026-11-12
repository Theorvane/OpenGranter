import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagementUsageClient } from '../src/management/workspace-usage-client.ts';

const empty = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
const csv = () =>
  new Response('request_id\n', { headers: { 'content-type': 'text/csv', 'x-has-more': 'false' } });

test('list and csv share a cancellation domain even if transport ignores abort', async () => {
  for (const first of ['list', 'csv'] as const) {
    let release!: (response: Response) => void;
    let signal: AbortSignal | undefined;
    let calls = 0;
    const client = createManagementUsageClient(async (_path, init) => {
      if (++calls === 1) {
        signal = init.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      return first === 'list' ? csv() : empty();
    });
    const pending = client[first]();
    assert.equal(signal?.aborted, false);
    const next = await client[first === 'list' ? 'csv' : 'list']();
    assert.equal(next.state, 'ready');
    assert.equal(signal?.aborted, true);
    assert.deepEqual(await pending, { state: 'cancelled' });
    release(first === 'list' ? empty() : csv());
    client.invalidate();
  }
});

test('explicit invalidation cancels either pending channel without transport cooperation', async () => {
  for (const kind of ['list', 'csv'] as const) {
    const client = createManagementUsageClient(async () => new Promise<Response>(() => {}));
    const pending = client[kind]();
    client.invalidate();
    assert.deepEqual(await pending, { state: 'cancelled' });
  }
});

test('empty result envelopes and canonical error states retain workspace shape', async () => {
  const client = createManagementUsageClient(async (path) =>
    path.includes('format=csv') ? csv() : empty(),
  );
  assert.deepEqual(await client.list(), {
    state: 'ready',
    data: { records: [], hasMore: false, nextCursor: null },
  });
  assert.deepEqual(await client.csv(), {
    state: 'ready',
    data: { csv: 'request_id\n', hasMore: false, nextCursor: null },
  });
  for (const [status, state] of [
    [400, 'invalid_query'],
    [401, 'unauthenticated'],
    [403, 'denied'],
    [503, 'unavailable'],
  ] as const) {
    const failing = createManagementUsageClient(async () => new Response(null, { status }));
    assert.deepEqual(await failing.list(), { state });
    assert.deepEqual(await failing.csv(), { state });
  }
});

test('invalid filters never acquire transport and malformed pages remain unavailable', async () => {
  let calls = 0;
  const client = createManagementUsageClient(async () => {
    calls++;
    return empty();
  });
  assert.deepEqual(await client.list({ requestId: 'bad query' }), { state: 'invalid_query' });
  assert.deepEqual(await client.csv({ requestId: 'bad query' }), { state: 'invalid_query' });
  assert.equal(calls, 0);
  const malformed = createManagementUsageClient(async () =>
    Response.json({ object: 'list', data: [], has_more: true, next_cursor: 'opaque' }),
  );
  assert.deepEqual(await malformed.list(), { state: 'unavailable' });
});
