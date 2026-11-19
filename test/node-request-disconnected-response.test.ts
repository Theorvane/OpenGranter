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

for (const cleanup of ['complete', 'throw', 'reject', 'stall'] as const) {
  test(`disconnect during fallback buffering releases listener with ${cleanup} cleanup`, async () => {
    let cancellations = 0;
    let started: (() => void) | undefined;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    let settled: (() => void) | undefined;
    const finished = new Promise<void>((resolve) => {
      settled = resolve;
    });
    const server = createNodeRequestServer(
      async (request) => {
        if (new URL(request.url).pathname.endsWith('/healthy')) return new Response('healthy');
        throw new Error('private-handler');
      },
      () =>
        new Response(
          new ReadableStream<Uint8Array>(
            {
              pull() {
                started?.();
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
        ),
    );
    const listener = server.listeners('request')[0] as (
      incoming: IncomingMessage,
      outgoing: ServerResponse,
    ) => Promise<void>;
    server.removeListener('request', listener);
    server.on('request', (incoming, outgoing) => {
      void listener(incoming, outgoing).then(() => {
        if (!incoming.url?.endsWith('/healthy')) settled?.();
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    let client: ReturnType<typeof httpRequest> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const url = `http://127.0.0.1:${address.port}/management/v1/models`;
      client = httpRequest(url);
      client.on('error', () => {});
      client.end();
      await reading;
      client.destroy();
      await Promise.race([
        finished,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('fallback reader retained disconnected request')),
            750,
          );
        }),
      ]);
      assert.equal(cancellations, 1);
      const healthy = await fetch(`${url}/healthy`, { signal: AbortSignal.timeout(1500) });
      assert.equal(await healthy.text(), 'healthy');
    } finally {
      clearTimeout(timer);
      client?.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}

test('fallback buffering preserves split UTF-8 and removes only the initial BOM', async () => {
  const text = '한글\uFEFFtail';
  const bytes = new TextEncoder().encode(`\uFEFF${text}`);
  const server = createNodeRequestServer(
    async () => {
      throw new Error('private-handler');
    },
    () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
            controller.close();
          },
        }),
        { status: 503 },
      ),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/management/v1/models`, {
      signal: AbortSignal.timeout(1500),
    });
    assert.equal(response.status, 503);
    assert.equal(await response.text(), text);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
