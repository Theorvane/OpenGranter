import assert from 'node:assert/strict';
import test from 'node:test';
import { createCurrentPrincipalClient } from '../src/management/current-principal-client.ts';

const identity = { id: 'account-human', kind: 'human' };
const json = (value: unknown = identity) => Response.json(value);
test('fixed caller-authorized read projects immutable identity without credentials', async () => {
  const client = createCurrentPrincipalClient(async (path, init) => {
    assert.equal(path, '/management/v1/principal');
    assert.equal(init.method, 'GET');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, undefined);
    assert.deepEqual(init.headers, { accept: 'application/json' });
    return json();
  });
  const result = await client.read();
  assert.deepEqual(result, { state: 'ready', data: identity });
  if (result.state === 'ready') assert.equal(Object.isFrozen(result.data), true);
});
test('only exact valid human identity is accepted', async () => {
  for (const value of [
    null,
    [],
    {},
    { ...identity, token: 'private' },
    { ...identity, kind: 'service' },
    { ...identity, id: '' },
    { ...identity, id: 'x'.repeat(257) },
    { ...identity, id: '\u0000' },
    { ...identity, id: '\ud800' },
    { principalId: 'account-human' },
  ]) {
    assert.deepEqual(await createCurrentPrincipalClient(async () => json(value)).read(), {
      state: 'unavailable',
    });
  }
});
test('errors are classified without reading private bodies', async () => {
  for (const [status, state] of [
    [401, 'unauthenticated'],
    [403, 'denied'],
    [404, 'unavailable'],
    [503, 'unavailable'],
  ] as const) {
    let cancelled = 0;
    const client = createCurrentPrincipalClient(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled++;
            },
          }),
          { status },
        ),
    );
    assert.deepEqual(await client.read(), { state });
    assert.equal(cancelled, 1);
  }
  assert.deepEqual(
    await createCurrentPrincipalClient(async () => {
      throw new Error('private');
    }).read(),
    { state: 'unavailable' },
  );
});
test('bounded fatal UTF-8 JSON and explicit content type', async () => {
  for (const response of [
    new Response('<html>private</html>'),
    new Response('{}', { headers: { 'content-type': 'text/plain' } }),
    new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }),
    new Response(' '.repeat(4097), { headers: { 'content-type': 'application/json' } }),
    new Response('{', { headers: { 'content-type': 'application/json' } }),
  ]) {
    assert.deepEqual(await createCurrentPrincipalClient(async () => response).read(), {
      state: 'unavailable',
    });
  }
  assert.equal(
    (
      await createCurrentPrincipalClient(
        async () =>
          new Response(JSON.stringify(identity), {
            headers: { 'content-type': 'application/json; charset=utf-8' },
          }),
      ).read()
    ).state,
    'ready',
  );
});
test('supersession settles ignoring transport and cancels late response', async () => {
  let deliver!: (value: Response) => void;
  let calls = 0;
  let signal: AbortSignal | undefined;
  const client = createCurrentPrincipalClient(async (_path, init) => {
    if (++calls === 1) {
      signal = init.signal as AbortSignal;
      return new Promise<Response>((resolve) => {
        deliver = resolve;
      });
    }
    return json({ id: 'next-human', kind: 'human' });
  });
  const first = client.read();
  const second = await client.read();
  assert.equal(signal?.aborted, true);
  assert.deepEqual(await first, { state: 'cancelled' });
  assert.deepEqual(second, { state: 'ready', data: { id: 'next-human', kind: 'human' } });
  let cancelled = 0;
  deliver(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled++;
        },
      }),
    ),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, 1);
});
test('invalidate cancels pending body without publishing identity', async () => {
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  let cancelled = 0;
  const client = createCurrentPrincipalClient(
    async () =>
      new Response(
        new ReadableStream({
          pull() {
            started();
            return new Promise(() => {});
          },
          cancel() {
            cancelled++;
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  const read = client.read();
  await waiting;
  client.invalidate();
  assert.deepEqual(await read, { state: 'cancelled' });
  assert.equal(cancelled, 1);
});

test('deadline includes ignored transport and stalled response body', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const transport = createCurrentPrincipalClient(() => new Promise(() => {}));
  const transportRead = transport.read();
  t.mock.timers.tick(30_000);
  assert.deepEqual(await transportRead, { state: 'unavailable' });
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  let cancelled = 0;
  const stream = createCurrentPrincipalClient(
    async () =>
      new Response(
        new ReadableStream({
          pull() {
            started();
            return new Promise(() => {});
          },
          cancel() {
            cancelled++;
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  const streamRead = stream.read();
  await waiting;
  t.mock.timers.tick(30_000);
  assert.deepEqual(await streamRead, { state: 'unavailable' });
  assert.equal(cancelled, 1);
});

test('oversized producer is cancelled and multibyte identity is preserved', async () => {
  let cancelled = 0;
  const client = createCurrentPrincipalClient(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(4097));
          },
          cancel() {
            cancelled++;
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  assert.deepEqual(await client.read(), { state: 'unavailable' });
  assert.equal(cancelled, 1);
  assert.deepEqual(
    await createCurrentPrincipalClient(async () => json({ id: '사용자😀', kind: 'human' })).read(),
    { state: 'ready', data: { id: '사용자😀', kind: 'human' } },
  );
});
