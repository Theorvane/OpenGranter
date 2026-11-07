import assert from 'node:assert/strict';
import test from 'node:test';
import { createSsoManagementCatalogSession } from '../src/management/catalog-session.ts';

const row = { id: 'count', object: 'model', created: 0, owned_by: 'opengranter' };

test('SSO lifecycle loads list and reserved alias detail on management namespace', async () => {
  const paths: string[] = [];
  const session = createSsoManagementCatalogSession();
  await session.list();
  assert.deepEqual(session.snapshot(), { state: 'unauthenticated' });
  session.authorize(async (path) => {
    paths.push(path);
    return Response.json(path.endsWith('/count') ? row : { data: [row] });
  });
  const list = session.list();
  assert.deepEqual(session.snapshot(), { state: 'loading', view: 'list' });
  await list;
  assert.deepEqual(session.snapshot(), { state: 'list', models: [row] });
  const detail = session.detail('count');
  assert.deepEqual(session.snapshot(), { state: 'loading', view: 'detail' });
  await detail;
  assert.deepEqual(session.snapshot(), { state: 'detail', model: row });
  assert.deepEqual(paths, ['/management/v1/models', '/management/v1/models/count']);
  session.clear('expired');
  assert.deepEqual(session.snapshot(), { state: 'expired' });
  await session.list();
  assert.equal(paths.length, 2);
});

test('SSO replacement cannot publish the previous principal catalog', async () => {
  let finish!: (response: Response) => void;
  const session = createSsoManagementCatalogSession();
  session.authorize(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const previous = session.list();
  session.authorize(async () => Response.json({ data: [] }));
  assert.deepEqual(session.snapshot(), { state: 'idle' });
  await session.list();
  finish(Response.json({ data: [row] }));
  await previous;
  assert.deepEqual(session.snapshot(), { state: 'empty' });
});

test('SSO lifecycle locks on auth failures and retries safe service failures', async () => {
  for (const [status, state] of [
    [401, 'unauthenticated'],
    [403, 'denied'],
    [404, 'missing'],
    [503, 'unavailable'],
  ] as const) {
    let calls = 0;
    const session = createSsoManagementCatalogSession();
    session.authorize(async () => {
      calls++;
      return new Response('private', { status });
    });
    await session.list();
    assert.deepEqual(session.snapshot(), { state });
    await session.list();
    assert.equal(calls, status === 401 || status === 403 ? 1 : 2);
    session.dispose();
    session.authorize(async () => Response.json({ data: [row] }));
    await session.list();
    assert.deepEqual(session.snapshot(), { state: 'disposed' });
  }
});

test('SSO invalid success clears previous data and permits a valid retry', async () => {
  const session = createSsoManagementCatalogSession();
  let valid = true;
  session.authorize(async (path) => {
    const data = valid ? row : { ...row, created: -1, secret: 'must-not-display' };
    return Response.json(path.endsWith('/models') ? { data: [data] } : data);
  });
  await session.list();
  assert.deepEqual(session.snapshot(), { state: 'list', models: [row] });
  valid = false;
  await session.detail(row.id);
  assert.deepEqual(session.snapshot(), { state: 'unavailable' });
  valid = true;
  await session.detail(row.id);
  assert.deepEqual(session.snapshot(), { state: 'detail', model: row });
  valid = false;
  await session.list();
  assert.deepEqual(session.snapshot(), { state: 'unavailable' });
  valid = true;
  await session.list();
  assert.deepEqual(session.snapshot(), { state: 'list', models: [row] });
  session.dispose();
});
