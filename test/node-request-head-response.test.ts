import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';

for (const source of ['normal', 'fallback'] as const) {
  for (const cleanup of ['complete', 'throw', 'reject', 'stall'] as const) {
    test(`HEAD cancels ${source} body with ${cleanup} cleanup without pulling or waiting`, async () => {
      let pulls = 0;
      let cancellations = 0;
      const response = () =>
        new Response(
          new ReadableStream<Uint8Array>(
            {
              pull() {
                pulls++;
                return new Promise<void>(() => {});
              },
              cancel() {
                cancellations++;
                if (cleanup === 'throw') throw new Error('private-cleanup');
                if (cleanup === 'reject') return Promise.reject(new Error('private-cleanup'));
                if (cleanup === 'stall') return new Promise<void>(() => {});
              },
            },
            { highWaterMark: 0 },
          ),
          {
            status: 202,
            headers: {
              'x-result': 'ready',
              'content-type': 'text/plain',
              'content-length': '1234',
            },
          },
        );
      const server = createNodeRequestServer(
        async (request) => {
          if (request.method === 'GET') return new Response('still-working');
          if (source === 'fallback') throw new Error('private-handler');
          return response();
        },
        source === 'fallback' ? response : undefined,
      );
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      try {
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        const url = `http://127.0.0.1:${address.port}/management/v1/models`;
        const result = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(750) });
        assert.equal(result.status, 202);
        assert.equal(result.headers.get('x-result'), 'ready');
        assert.equal(result.headers.get('content-length'), '1234');
        assert.equal(result.headers.get('cache-control'), 'no-store');
        assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(await result.text(), '');
        assert.equal(pulls, 0);
        assert.equal(cancellations, 1);
        const get = await fetch(url, { signal: AbortSignal.timeout(750) });
        assert.equal(await get.text(), 'still-working');
        assert.equal(cancellations, 1);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  }
}

test('HEAD invalid fallback headers are discarded and its producer cancelled', async () => {
  let cancellations = 0;
  const server = createNodeRequestServer(
    async () => {
      throw new Error('private-handler');
    },
    () =>
      new Response(
        new ReadableStream(
          {
            cancel() {
              cancellations++;
            },
          },
          { highWaterMark: 0 },
        ),
        {
          headers: { 'set-cookie': 'private-cookie', 'z-invalid': String.fromCharCode(1) },
        },
      ),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const result = await fetch(`http://127.0.0.1:${address.port}/management/v1/models`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(750),
    });
    assert.equal(result.status, 500);
    assert.equal(result.headers.get('set-cookie'), null);
    assert.equal(await result.text(), '');
    assert.equal(cancellations, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
