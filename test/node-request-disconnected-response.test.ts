import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { test } from 'node:test';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';

for (const cleanup of ['complete', 'reject', 'throw', 'stall', 'locked'] as const) {
  test(`disconnected management response settles with ${cleanup} producer cleanup`, async () => {
    let cancellations = 0;
    let seenSignal: AbortSignal | undefined;
    let releaseHandler: (() => void) | undefined;
    let started: (() => void) | undefined;
    const handlerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    let settled: (() => void) | undefined;
    const listenerSettled = new Promise<void>((resolve) => {
      settled = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('private-response'));
      },
      cancel() {
        cancellations++;
        if (cleanup === 'throw') throw new Error('private-cleanup');
        if (cleanup === 'reject') return Promise.reject(new Error('private-cleanup'));
        if (cleanup === 'stall') return new Promise<void>(() => {});
      },
    });
    const response = new Response(body);
    const reader = cleanup === 'locked' ? body.getReader() : undefined;
    const server = createNodeRequestServer(async (request) => {
      if (new URL(request.url).pathname === '/management/v1/models/healthy')
        return Response.json({ id: 'healthy' });
      seenSignal = request.signal;
      started?.();
      await released;
      return response;
    });
    // Observe the real async Node listener's settlement; keep actual socket/Fetch adaptation.
    const listener = server.listeners('request')[0] as (
      incoming: IncomingMessage,
      outgoing: ServerResponse,
    ) => Promise<void>;
    server.removeListener('request', listener);
    server.on('request', (incoming, outgoing) => {
      const observed = incoming.url === '/management/v1/models';
      void listener(incoming, outgoing).then(() => {
        if (observed) settled?.();
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    let client: ReturnType<typeof httpRequest> | undefined;
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      client = httpRequest(`http://127.0.0.1:${address.port}/management/v1/models`);
      client.on('error', () => {});
      client.end();
      await handlerStarted;
      assert.ok(seenSignal);
      const aborted = once(seenSignal, 'abort');
      client.destroy();
      await aborted;
      assert.equal(seenSignal.aborted, true);
      releaseHandler?.();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          listenerSettled,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Node listener retained by discarded producer')),
              500,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      assert.equal(cancellations, cleanup === 'locked' ? 0 : 1);
      const healthy = await fetch(`http://127.0.0.1:${address.port}/management/v1/models/healthy`, {
        signal: AbortSignal.timeout(1500),
      });
      assert.equal(healthy.status, 200);
      assert.equal(healthy.headers.get('cache-control'), 'no-store');
      assert.equal(healthy.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(await healthy.json(), { id: 'healthy' });
    } finally {
      client?.destroy();
      releaseHandler?.();
      reader?.releaseLock();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}
