import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { createSsoUsageClient } from '../src/management/usage-client.ts';

const CAP = 2 * 1024 * 1024;
const headers = { 'content-type': 'application/json; charset=utf-8' };
const json = JSON.stringify({
  object: 'list',
  data: [],
  has_more: false,
  next_cursor: null,
  ignored: '😀',
});
const ready = { state: 'ready', data: [], hasMore: false, nextCursor: null };

test('usage JSON: identity overflow cancels before a stalled producer closes', async () => {
  let cancelled = false;
  const client = createSsoUsageClient(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(json));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { ...headers, 'content-length': '1' } },
      ),
  );
  const alarm = AbortSignal.timeout(1000);
  try {
    assert.deepEqual(
      await Promise.race([
        client.read(),
        new Promise<never>((_, reject) =>
          alarm.addEventListener('abort', () => reject(new Error('identity overflow stalled')), {
            once: true,
          }),
        ),
      ]),
      { state: 'unavailable' },
    );
    assert.equal(cancelled, true);
  } finally {
    client.invalidate();
  }
});

test('usage JSON: decoded response is independent of compressed wire metadata', async () => {
  const client = createSsoUsageClient(
    async () =>
      new Response(json, {
        headers: {
          ...headers,
          'content-encoding': 'gzip',
          'content-length': String(CAP + 100),
        },
      }),
  );
  assert.deepEqual(await client.read(), ready);
});

test('usage JSON: native Fetch gzip exact cap, overflow and truncated identity', async () => {
  let mode: 'gzip' | 'wireLarge' | 'oversize' | 'truncated' = 'gzip';
  let calls = 0;
  const server = createServer((_req, res) => {
    calls++;
    if (mode === 'truncated') {
      res.writeHead(200, { ...headers, 'content-length': String(Buffer.byteLength(json) + 1) });
      res.end(json);
      return;
    }
    const text =
      mode === 'gzip'
        ? json
        : json + ' '.repeat(CAP - Buffer.byteLength(json) + (mode === 'oversize' ? 1 : 0));
    const wire = gzipSync(text, { level: mode === 'wireLarge' ? 0 : 6 });
    if (mode === 'wireLarge') assert.ok(wire.byteLength > CAP);
    res.writeHead(200, {
      ...headers,
      'content-encoding': 'gzip',
      'content-length': String(wire.byteLength),
    });
    res.end(wire);
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const client = createSsoUsageClient((path, init) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, init),
  );
  try {
    assert.deepEqual(await client.read(), ready);
    mode = 'wireLarge';
    assert.deepEqual(await client.read(), ready);
    mode = 'oversize';
    assert.deepEqual(await client.read(), { state: 'unavailable' });
    mode = 'truncated';
    assert.deepEqual(await client.read(), { state: 'unavailable' });
    assert.equal(calls, 4);
  } finally {
    client.invalidate();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
