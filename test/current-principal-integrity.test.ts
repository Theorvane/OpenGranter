import assert from 'node:assert/strict';
import test from 'node:test';
import { createCurrentPrincipalClient } from '../src/management/current-principal-client.ts';

const identity = { id: '계정-human', kind: 'human' };
const text = JSON.stringify(identity);
const size = new TextEncoder().encode(text).byteLength;
function response(length?: string, encoding?: string) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (length !== undefined) headers.set('content-length', length);
  if (encoding !== undefined) headers.set('content-encoding', encoding);
  return new Response(text, { headers });
}

test('Account refuses complete-looking JSON when declared identity byte length differs', async () => {
  for (const length of [String(size - 1), String(size + 1), '0']) {
    assert.deepEqual(await createCurrentPrincipalClient(async () => response(length)).read(), {
      state: 'unavailable',
    });
  }
});

test('Account rejects oversized declaration without pulling a stalled producer', async () => {
  let pulls = 0;
  let cancels = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull() {
        pulls++;
        return new Promise(() => {});
      },
      cancel() {
        cancels++;
        return new Promise(() => {});
      },
    },
    { highWaterMark: 0 },
  );
  const client = createCurrentPrincipalClient(
    async () =>
      new Response(body, {
        headers: { 'content-type': 'application/json', 'content-length': '4097' },
      }),
  );
  const read = client.read();
  await new Promise((resolve) => setImmediate(resolve));
  if (pulls) client.invalidate();
  assert.deepEqual(await read, { state: 'unavailable' });
  assert.equal(pulls, 0);
  assert.equal(cancels, 1);
});

test('Account rejects malformed or unbounded identity length declarations', async () => {
  for (const length of ['-1', '+42', '1.5', '1e2', '42,42', 'NaN', '9'.repeat(100)]) {
    assert.deepEqual(await createCurrentPrincipalClient(async () => response(length)).read(), {
      state: 'unavailable',
    });
  }
});

test('Account accepts exact bytes, absent length and Fetch-decoded encoded representations', async () => {
  for (const [length, encoding] of [
    [undefined, undefined],
    [String(size), undefined],
    [String(size), 'identity'],
    [String(size), ' IDENTITY '],
    [`000${String(size)}`, undefined],
    ['10', 'gzip'],
    ['10', 'br'],
  ]) {
    assert.deepEqual(
      await createCurrentPrincipalClient(async () => response(length, encoding)).read(),
      {
        state: 'ready',
        data: identity,
      },
    );
  }
});

test('Account can retry after integrity failure without reusing the rejected identity', async () => {
  let calls = 0;
  const client = createCurrentPrincipalClient(async () =>
    response(String(++calls === 1 ? size + 1 : size)),
  );
  assert.deepEqual(await client.read(), { state: 'unavailable' });
  assert.deepEqual(await client.read(), { state: 'ready', data: identity });
});

test('Account cancels on declared overflow before waiting for producer EOF', async () => {
  let cancels = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
      },
      cancel() {
        cancels++;
      },
    },
    { highWaterMark: 0 },
  );
  const client = createCurrentPrincipalClient(
    async () =>
      new Response(body, {
        headers: { 'content-type': 'application/json', 'content-length': '1' },
      }),
  );
  const read = client.read();
  await new Promise((resolve) => setImmediate(resolve));
  if (!cancels) client.invalidate();
  assert.deepEqual(await read, { state: 'unavailable' });
  assert.equal(cancels, 1);
});

test('Account counts split multibyte bytes and still bounds decoded compressed bodies', async () => {
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  assert.deepEqual(
    await createCurrentPrincipalClient(
      async () =>
        new Response(stream, {
          headers: { 'content-type': 'application/json', 'content-length': String(size) },
        }),
    ).read(),
    { state: 'ready', data: identity },
  );
  const padded = text + ' '.repeat(4096 - size);
  assert.equal(new TextEncoder().encode(padded).byteLength, 4096);
  assert.deepEqual(
    await createCurrentPrincipalClient(
      async () =>
        new Response(padded, {
          headers: { 'content-type': 'application/json', 'content-length': '4096' },
        }),
    ).read(),
    { state: 'ready', data: identity },
  );
  assert.deepEqual(
    await createCurrentPrincipalClient(
      async () =>
        new Response(`${padded} `, {
          headers: {
            'content-type': 'application/json',
            'content-length': '10',
            'content-encoding': 'gzip',
          },
        }),
    ).read(),
    { state: 'unavailable' },
  );
});
