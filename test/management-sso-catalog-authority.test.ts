import assert from 'node:assert/strict';
import test from 'node:test';
import { createSsoManagementCatalogAuthority } from '../src/management/catalog-authority.ts';

const model = { id: 'team/model', object: 'model', created: 0, owned_by: 'opengranter' };
function fixture() {
  let time = 1000;
  const states: string[] = [];
  const jobs: { callback: () => void; cancelled: boolean }[] = [];
  const authority = createSsoManagementCatalogAuthority({
    now: () => time,
    onChange: (snapshot) => states.push(snapshot.state),
    schedule: (_delay, callback) => {
      const job = { callback, cancelled: false };
      jobs.push(job);
      return () => {
        job.cancelled = true;
      };
    },
  });
  return {
    authority,
    states,
    jobs,
    setTime(value: number) {
      time = value;
    },
  };
}
test('SSO grant publishes list and encoded detail without proxy fallback', async () => {
  const f = fixture();
  const paths: string[] = [];
  f.authority.authorize({
    expiresAt: 2000,
    request: async (path) => {
      paths.push(path);
      return Response.json(path.endsWith('/models') ? { object: 'list', data: [model] } : model);
    },
  });
  await f.authority.list();
  assert.deepEqual(f.states, ['idle', 'loading', 'list']);
  await f.authority.detail(model.id);
  assert.deepEqual(f.authority.snapshot(), { state: 'detail', model });
  assert.deepEqual(paths, ['/management/v1/models', '/management/v1/models/team%2Fmodel']);
  f.authority.dispose();
});
test('SSO authority retains empty/error recovery and supports count alias', async () => {
  const f = fixture();
  let response = Response.json({ data: [] });
  f.authority.authorize({ expiresAt: 2000, request: async () => response });
  await f.authority.list();
  assert.equal(f.authority.snapshot().state, 'empty');
  response = new Response('private server error', { status: 503 });
  await f.authority.list();
  assert.deepEqual(f.authority.snapshot(), { state: 'unavailable' });
  response = Response.json({ ...model, id: 'count' });
  await f.authority.detail('count');
  assert.deepEqual(f.authority.snapshot(), { state: 'detail', model: { ...model, id: 'count' } });
  f.authority.dispose();
});
test('SSO expiry aborts pending read and immediately notifies data removal', async () => {
  const f = fixture();
  let signal: AbortSignal | null | undefined;
  let finish!: (value: Response) => void;
  f.authority.authorize({
    expiresAt: 2000,
    request: (_path, init) => {
      signal = init.signal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
  });
  const pending = f.authority.list();
  f.setTime(2000);
  f.jobs[0]?.callback();
  assert.equal(signal?.aborted, true);
  assert.deepEqual(f.authority.snapshot(), { state: 'expired' });
  finish(Response.json({ data: [model] }));
  await pending;
  assert.deepEqual(f.states, ['idle', 'loading', 'expired']);
  f.authority.dispose();
});
test('SSO identity replacement ignores stale response and old expiry callback', async () => {
  const f = fixture();
  let finish!: (value: Response) => void;
  f.authority.authorize({
    expiresAt: 2000,
    request: () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  });
  const pending = f.authority.list();
  f.authority.authorize({ expiresAt: 4000, request: async () => Response.json({ data: [] }) });
  await f.authority.list();
  f.setTime(2000);
  f.jobs[0]?.callback();
  finish(Response.json({ data: [model] }));
  await pending;
  assert.equal(f.jobs[0]?.cancelled, true);
  assert.deepEqual(f.authority.snapshot(), { state: 'empty' });
  f.authority.dispose();
});
for (const [status, state] of [
  [401, 'unauthenticated'],
  [403, 'denied'],
] as const) {
  test('SSO denial locks further reads: ' + status, async () => {
    const f = fixture();
    let calls = 0;
    f.authority.authorize({
      expiresAt: 2000,
      request: async () => {
        calls++;
        return new Response(null, { status });
      },
    });
    await f.authority.list();
    await f.authority.detail(model.id);
    assert.deepEqual(f.authority.snapshot(), { state });
    assert.equal(calls, 1);
    assert.equal(f.jobs[0]?.cancelled, true);
    f.authority.authorize({
      expiresAt: 3000,
      request: async () => Response.json({ data: [model] }),
    });
    await f.authority.list();
    assert.equal(f.authority.snapshot().state, 'list');
    f.authority.clear('unauthenticated');
    assert.deepEqual(f.authority.snapshot(), { state: 'unauthenticated' });
    f.authority.dispose();
    await f.authority.list();
    assert.deepEqual(f.authority.snapshot(), { state: 'disposed' });
  });
}
