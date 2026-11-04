import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagementCatalogAuthority } from '../src/management/catalog-authority.ts';

const model = { id: 'team/model', object: 'model', created: 0, owned_by: 'team' };
const request = async () => Response.json({ data: [model] });
function fixture() {
  let time = 1000;
  const jobs: { delay: number; callback: () => void; cancelled: boolean }[] = [];
  const states: string[] = [];
  const authority = createManagementCatalogAuthority({
    now: () => time,
    schedule: (delay, callback) => {
      const job = { delay, callback, cancelled: false };
      jobs.push(job);
      return () => {
        job.cancelled = true;
      };
    },
    onChange: (snapshot) => states.push(snapshot.state),
  });
  return {
    authority,
    jobs,
    states,
    setTime: (value: number) => {
      time = value;
    },
  };
}
test('trusted grant drives loading, data and automatic expiry with no further API reads', async () => {
  const f = fixture();
  let calls = 0;
  f.authority.authorize({
    request: async () => {
      calls++;
      return request();
    },
    expiresAt: 2000,
  });
  await f.authority.list();
  assert.deepEqual(f.states, ['idle', 'loading', 'list']);
  assert.equal(f.jobs[0]?.delay, 1000);
  f.setTime(2000);
  f.jobs[0]?.callback();
  assert.deepEqual(f.authority.snapshot(), { state: 'expired' });
  assert.equal(f.states.at(-1), 'expired');
  await f.authority.detail(model.id);
  assert.equal(calls, 1);
});
test('delayed timer cannot release a response or start another read past expiry', async () => {
  const f = fixture();
  let finish!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  f.authority.authorize({
    request: (_path, init) => {
      signal = init.signal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
    expiresAt: 2000,
  });
  const pending = f.authority.list();
  f.setTime(2001);
  finish(Response.json({ data: [model] }));
  await pending;
  assert.deepEqual(f.authority.snapshot(), { state: 'expired' });
  // Transport already finished; the protected result is still withheld.
  assert.equal(signal?.aborted, false);
  assert.equal(f.states.includes('list'), false);
});
test('invalid grants replace previous authority without requests', async () => {
  for (const expiresAt of [NaN, Infinity, -1, 1000, 1.5]) {
    const f = fixture();
    f.authority.authorize({ request, expiresAt: 3000 });
    await f.authority.list();
    f.authority.authorize({ request, expiresAt });
    assert.deepEqual(f.authority.snapshot(), { state: 'expired' });
    await f.authority.list();
    assert.deepEqual(f.authority.snapshot(), { state: 'expired' });
    assert.equal(f.jobs[0]?.cancelled, true);
  }
});
test('renewal ignores old callbacks and pending responses', async () => {
  const f = fixture();
  let finish!: (response: Response) => void;
  f.authority.authorize({
    request: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    expiresAt: 2000,
  });
  const pending = f.authority.list();
  f.authority.authorize({ request: async () => Response.json({ data: [] }), expiresAt: 4000 });
  await f.authority.list();
  f.setTime(2000);
  f.jobs[0]?.callback();
  finish(Response.json({ data: [model] }));
  await pending;
  assert.deepEqual(f.authority.snapshot(), { state: 'empty' });
  assert.equal(f.jobs[0]?.cancelled, true);
});
test('early timer reschedules; long expiry is bounded', () => {
  const f = fixture();
  f.authority.authorize({ request, expiresAt: Number.MAX_SAFE_INTEGER });
  assert.equal(f.jobs[0]?.delay, 2147483647);
  f.jobs[0]?.callback();
  assert.equal(f.jobs[1]?.delay, 2147483647);
  assert.deepEqual(f.authority.snapshot(), { state: 'idle' });
  f.authority.dispose();
});
test('logout, denied response and terminal disposal cancel expiry', async () => {
  const f = fixture();
  f.authority.authorize({ request, expiresAt: 2000 });
  f.authority.clear('unauthenticated');
  assert.equal(f.jobs[0]?.cancelled, true);
  f.authority.authorize({
    request: async () => new Response(null, { status: 403 }),
    expiresAt: 3000,
  });
  await f.authority.list();
  assert.deepEqual(f.authority.snapshot(), { state: 'denied' });
  assert.equal(f.jobs[1]?.cancelled, true);
  f.authority.authorize({ request, expiresAt: 4000 });
  f.authority.dispose();
  assert.equal(f.jobs[2]?.cancelled, true);
  f.authority.authorize({ request, expiresAt: 5000 });
  await f.authority.list();
  f.authority.clear('expired');
  assert.deepEqual(f.authority.snapshot(), { state: 'disposed' });
  assert.equal(f.jobs.length, 3);
});
test('snapshot and navigation enforce expiry despite suspended timer', async () => {
  const f = fixture();
  f.authority.authorize({ request, expiresAt: 2000 });
  await f.authority.list();
  f.setTime(2000);
  assert.deepEqual(f.authority.snapshot(), { state: 'expired' });
  assert.equal(f.states.at(-1), 'expired');
  const g = fixture();
  let calls = 0;
  g.authority.authorize({
    request: async () => {
      calls++;
      return request();
    },
    expiresAt: 2000,
  });
  g.setTime(2000);
  await g.authority.list();
  assert.equal(calls, 0);
});
test('renderer failures do not break expiry teardown', async () => {
  let time = 1000;
  const authority = createManagementCatalogAuthority({
    now: () => time,
    schedule: () => () => {},
    onChange: () => {
      throw new Error('private');
    },
  });
  authority.authorize({ request, expiresAt: 2000 });
  await authority.list();
  time = 2000;
  assert.deepEqual(authority.snapshot(), { state: 'expired' });
  authority.dispose();
});

test('timer aborts an in-flight request and suppresses ignored-abort body', async () => {
  const f = fixture();
  let finish!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  f.authority.authorize({
    request: (_path, init) => {
      signal = init.signal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
    expiresAt: 2000,
  });
  const pending = f.authority.list();
  f.setTime(2000);
  f.jobs[0]?.callback();
  assert.equal(signal?.aborted, true);
  finish(Response.json({ data: [model] }));
  await pending;
  assert.deepEqual(f.authority.snapshot(), { state: 'expired' });
  assert.equal(f.states.includes('list'), false);
});
test('default platform timer notifies expiry and removes loaded detail', async () => {
  let time = 1000;
  let expired!: () => void;
  const completion = new Promise<void>((resolve) => {
    expired = resolve;
  });
  const authority = createManagementCatalogAuthority({
    now: () => time,
    onChange: (snapshot) => {
      if (snapshot.state === 'expired') expired();
    },
  });
  try {
    authority.authorize({ request: async () => Response.json(model), expiresAt: 1020 });
    await authority.detail(model.id);
    assert.equal(authority.snapshot().state, 'detail');
    time = 1020;
    await completion;
    assert.deepEqual(authority.snapshot(), { state: 'expired' });
  } finally {
    authority.dispose();
  }
});
