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
