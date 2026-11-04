import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagementCatalogClient } from '../src/management/catalog-client.ts';

const row = { id: 'team/model', object: 'model', created: 0, owned_by: 'team' };

test('list reads actual API envelope with no-store and safe projection', async () => {
  const client = createManagementCatalogClient(async (path, init) => {
    assert.equal(path, '/api/v1/models');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    return Response.json({ data: [{ ...row, token: 'must-not-project' }] });
  });
  assert.deepEqual(await client.list(), { state: 'ready', data: [row] });
});
test('empty list is ready rather than a transport error', async () => {
  const client = createManagementCatalogClient(async () => Response.json({ data: [] }));
  assert.deepEqual(await client.list(), { state: 'ready', data: [] });
});
test('detail uses one encoded path and bare exact-alias response', async () => {
  const client = createManagementCatalogClient(async (path) => {
    assert.equal(path, '/api/v1/models/team%2Fmodel');
    return Response.json(row);
  });
  assert.deepEqual(await client.detail(row.id), { state: 'ready', data: row });
});
test('reserved and malformed detail inputs never request a collection or route', async () => {
  let calls = 0;
  const client = createManagementCatalogClient(async () => {
    calls++;
    return Response.json(row);
  });
  for (const id of ['', 'count', 'user', '../model', 'a//b', 'a%2fb', 'a?b', 'a\\b', '\ud800']) {
    assert.deepEqual(await client.detail(id), { state: 'unavailable' });
  }
  assert.equal(calls, 0);
});
test('authentication, denial, absence and unavailable never parse private errors', async () => {
  for (const [status, state] of [
    [401, 'unauthenticated'],
    [403, 'denied'],
    [404, 'missing'],
    [500, 'unavailable'],
    [302, 'unavailable'],
  ] as const) {
    const client = createManagementCatalogClient(async () => new Response('private', { status }));
    assert.deepEqual(await client.list(), { state });
  }
});
test('invalid envelopes, foreign details and rejected transport fail closed', async () => {
  for (const body of [null, {}, { data: [row, null] }, { data: [{ ...row, created: '0' }] }]) {
    assert.deepEqual(await createManagementCatalogClient(async () => Response.json(body)).list(), {
      state: 'unavailable',
    });
  }
  assert.deepEqual(
    await createManagementCatalogClient(async () => Response.json({ ...row, id: 'other' })).detail(
      row.id,
    ),
    { state: 'unavailable' },
  );
  assert.deepEqual(
    await createManagementCatalogClient(async () => {
      throw new Error('private');
    }).list(),
    { state: 'unavailable' },
  );
});
test('identity invalidation suppresses a late response even if transport ignores abort', async () => {
  let resolve!: (response: Response) => void;
  const client = createManagementCatalogClient(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  const result = client.list();
  client.invalidate();
  resolve(Response.json({ data: [row] }));
  assert.deepEqual(await result, { state: 'cancelled' });
});
test('a newer read supersedes a pending older read', async () => {
  let resolve!: (response: Response) => void;
  let calls = 0;
  const client = createManagementCatalogClient(() =>
    ++calls === 1
      ? new Promise<Response>((done) => {
          resolve = done;
        })
      : Promise.resolve(Response.json(row)),
  );
  const old = client.list();
  assert.deepEqual(await client.detail(row.id), { state: 'ready', data: row });
  resolve(Response.json({ data: [row] }));
  assert.deepEqual(await old, { state: 'cancelled' });
});

test('stalled transport settles unavailable at 30 seconds even if abort is ignored', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | null | undefined;
  const client = createManagementCatalogClient(async (_path, init) => {
    signal = init.signal;
    return new Promise<Response>(() => {});
  });
  const pending = client.list();
  t.mock.timers.tick(30_000);
  assert.equal(signal?.aborted, true);
  assert.deepEqual(await pending, { state: 'unavailable' });
});

test('deadline includes stalled JSON decoding and ignores late private data', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish!: (value: unknown) => void;
  const response = Response.json({});
  Object.defineProperty(response, 'json', {
    value: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const client = createManagementCatalogClient(async () => response);
  const pending = client.detail(row.id);
  await Promise.resolve();
  t.mock.timers.tick(30_000);
  assert.deepEqual(await pending, { state: 'unavailable' });
  finish(row);
  await Promise.resolve();
});

test('superseded stalled reads cancel immediately without waiting for their deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const client = createManagementCatalogClient(async () => {
    calls++;
    return calls === 1 ? new Promise<Response>(() => {}) : Response.json(row);
  });
  const old = client.list();
  assert.deepEqual(await client.detail(row.id), { state: 'ready', data: row });
  assert.deepEqual(await old, { state: 'cancelled' });
  t.mock.timers.tick(30_000);
});

test('successful read clears its deadline and never later aborts the transport', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | null | undefined;
  const client = createManagementCatalogClient(async (_path, init) => {
    signal = init.signal;
    return Response.json(row);
  });
  assert.deepEqual(await client.detail(row.id), { state: 'ready', data: row });
  t.mock.timers.tick(30_000);
  assert.equal(signal?.aborted, false);
});

test('non-200 bodies are cancelled without parsing or waiting for cleanup', async () => {
  for (const [status, state] of [
    [401, 'unauthenticated'],
    [403, 'denied'],
    [404, 'missing'],
    [429, 'unavailable'],
    [500, 'unavailable'],
    [302, 'unavailable'],
  ] as const) {
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled++;
        return new Promise<void>(() => {});
      },
    });
    const response = new Response(body, { status });
    Object.defineProperty(response, 'json', {
      value: () => {
        throw new Error('must not parse private error');
      },
    });
    const client = createManagementCatalogClient(async () => response);
    assert.deepEqual(await client.list(), { state });
    assert.equal(cancelled, 1);
  }
});

test('rejected body cancellation stays private and does not block the next read', async () => {
  let calls = 0;
  let cancelled = 0;
  const client = createManagementCatalogClient(async () => {
    if (++calls > 1) return Response.json(row);
    return new Response(
      new ReadableStream({
        cancel() {
          cancelled++;
          return Promise.reject(new Error('private cleanup failure'));
        },
      }),
      { status: 503 },
    );
  });
  assert.deepEqual(await client.list(), { state: 'unavailable' });
  assert.equal(cancelled, 1);
  assert.deepEqual(await client.detail(row.id), { state: 'ready', data: row });
});

test('late ignored-abort responses release their unread body after invalidation', async () => {
  let finish!: (response: Response) => void;
  let cancelled = 0;
  const client = createManagementCatalogClient(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = client.list();
  client.invalidate();
  assert.deepEqual(await pending, { state: 'cancelled' });
  finish(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled++;
        },
      }),
    ),
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(cancelled, 1);
});

test('body-free and synchronously failing cleanup preserve safe status', async () => {
  assert.deepEqual(
    await createManagementCatalogClient(async () => new Response(null, { status: 204 })).list(),
    { state: 'unavailable' },
  );
  const response = new Response(null, { status: 403 });
  Object.defineProperty(response, 'body', {
    get() {
      throw new Error('private cleanup error');
    },
  });
  assert.deepEqual(await createManagementCatalogClient(async () => response).list(), {
    state: 'denied',
  });
});

test('a response arriving after deadline is discarded without replacing unavailable', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish!: (response: Response) => void;
  let cancelled = 0;
  const client = createManagementCatalogClient(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = client.detail(row.id);
  t.mock.timers.tick(30_000);
  assert.deepEqual(await pending, { state: 'unavailable' });
  finish(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled++;
        },
      }),
    ),
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(cancelled, 1);
});
