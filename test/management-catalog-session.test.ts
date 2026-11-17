import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagementCatalogSession } from '../src/management/catalog-session.ts';

const model = { id: 'team/model', object: 'model', created: 0, owned_by: 'team' };
const request = async () => Response.json({ data: [model] });

test('locked session never reads; authorized list exposes loading then data', async () => {
  const session = createManagementCatalogSession();
  await session.list();
  assert.deepEqual(session.snapshot(), { state: 'unauthenticated' });
  session.authorize(request);
  const pending = session.list();
  assert.deepEqual(session.snapshot(), { state: 'loading', view: 'list' });
  await pending;
  assert.deepEqual(session.snapshot(), { state: 'list', models: [model] });
});
test('empty is distinct; logout drops loaded data synchronously', async () => {
  const session = createManagementCatalogSession();
  session.authorize(async () => Response.json({ data: [] }));
  await session.list();
  assert.deepEqual(session.snapshot(), { state: 'empty' });
  session.authorize(request);
  await session.list();
  session.clear('expired');
  assert.deepEqual(session.snapshot(), { state: 'expired' });
  await session.detail(model.id);
  assert.deepEqual(session.snapshot(), { state: 'expired' });
});
test('session replacement suppresses old responses when abort is ignored', async () => {
  let finish!: (response: Response) => void;
  const session = createManagementCatalogSession();
  session.authorize(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const old = session.list();
  session.authorize(async () => Response.json({ data: [] }));
  await session.list();
  finish(Response.json({ data: [model] }));
  await old;
  assert.deepEqual(session.snapshot(), { state: 'empty' });
});
test('expiry during body consumption cannot republish protected data', async () => {
  let started!: () => void;
  let cancelled = 0;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const session = createManagementCatalogSession();
  session.authorize(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull() {
            started();
          },
          cancel() {
            cancelled++;
          },
        }),
      ),
  );
  const pending = session.list();
  await reading;
  session.clear('expired');
  await pending;
  assert.deepEqual(session.snapshot(), { state: 'expired' });
  assert.equal(cancelled, 1);
});
test('detail navigation supersedes pending list', async () => {
  let finish!: (response: Response) => void;
  const session = createManagementCatalogSession();
  session.authorize((path) =>
    path.endsWith('models')
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(Response.json(model)),
  );
  const old = session.list();
  const current = session.detail(model.id);
  assert.deepEqual(session.snapshot(), { state: 'loading', view: 'detail' });
  await current;
  finish(Response.json({ data: [] }));
  await old;
  assert.deepEqual(session.snapshot(), { state: 'detail', model });
});
test('401/403 clear authority; missing/unavailable permit retry', async () => {
  for (const [status, state] of [
    [401, 'unauthenticated'],
    [403, 'denied'],
    [404, 'missing'],
    [500, 'unavailable'],
  ] as const) {
    let calls = 0;
    const session = createManagementCatalogSession();
    session.authorize(async () => {
      calls++;
      return new Response('private', { status });
    });
    await session.list();
    assert.deepEqual(session.snapshot(), { state });
    await session.list();
    assert.equal(calls, status === 401 || status === 403 ? 1 : 2);
  }
});
test('dispose is terminal', async () => {
  const session = createManagementCatalogSession();
  session.authorize(request);
  session.dispose();
  session.authorize(request);
  await session.list();
  session.clear('expired');
  assert.deepEqual(session.snapshot(), { state: 'disposed' });
});

test('a stalled catalog read leaves loading for the retryable unavailable state', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const session = createManagementCatalogSession();
  session.authorize(async () => new Promise<Response>(() => {}));
  const pending = session.list();
  assert.deepEqual(session.snapshot(), { state: 'loading', view: 'list' });
  t.mock.timers.tick(30_000);
  await pending;
  assert.deepEqual(session.snapshot(), { state: 'unavailable' });
  session.authorize(async () => Response.json({ data: [] }));
  await session.list();
  assert.deepEqual(session.snapshot(), { state: 'empty' });
  session.dispose();
});
