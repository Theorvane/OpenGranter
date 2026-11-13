import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';

for (const source of ['normal', 'fallback'] as const) {
  for (const cleanup of ['complete', 'reject', 'throw', 'stall'] as const) {
    test(`HTTP discards ${source} producer with ${cleanup} cleanup without blocking fallback`, async () => {
      let cancellations = 0;
      const rejected = () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('private-token'));
            },
            cancel() {
              cancellations++;
              if (cleanup === 'throw') throw new Error('private-cleanup');
              if (cleanup === 'reject') return Promise.reject(new Error('private-cleanup'));
              if (cleanup === 'stall') return new Promise<void>(() => {});
            },
          }),
          { headers: { 'z-invalid': String.fromCharCode(1), 'set-cookie': 'private-cookie' } },
        );
      const server = createNodeRequestServer(
        async () => {
          if (source === 'normal') return rejected();
          throw new Error('private-handler');
        },
        source === 'fallback' ? rejected : undefined,
      );
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      try {
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        for (let attempt = 1; attempt <= 2; attempt++) {
          const response = await fetch(`http://127.0.0.1:${address.port}/management/v1/models`, {
            signal: AbortSignal.timeout(1500),
          });
          assert.equal(response.status, 500);
          assert.equal(response.headers.get('cache-control'), 'no-store');
          assert.equal(response.headers.get('set-cookie'), null);
          assert.deepEqual(await response.json(), {
            error: { code: 'internal_error', message: 'Internal server error.' },
          });
          assert.equal(
            cancellations,
            attempt,
            'discarded response producer must be cancelled exactly once',
          );
        }
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  }
}

for (const source of ['normal', 'fallback'] as const) {
  test(`HTTP preserves valid ${source} streaming without cancelling its producer`, async () => {
    let cancellations = 0;
    const valid = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('public-'));
            controller.enqueue(new TextEncoder().encode('result'));
            controller.close();
          },
          cancel() {
            cancellations++;
          },
        }),
        { status: 202, headers: { 'x-result': 'ready' } },
      );
    const server = createNodeRequestServer(
      async () => {
        if (source === 'normal') return valid();
        throw new Error('private-handler');
      },
      source === 'fallback' ? valid : undefined,
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const response = await fetch(`http://127.0.0.1:${address.port}/management/v1/models`, {
        signal: AbortSignal.timeout(1500),
      });
      assert.equal(response.status, 202);
      assert.equal(response.headers.get('x-result'), 'ready');
      assert.equal(await response.text(), 'public-result');
      assert.equal(cancellations, 0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}
