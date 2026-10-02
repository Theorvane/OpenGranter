import assert from 'node:assert/strict';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test('disconnect while handler is pending aborts request and cancels late body', {
  timeout: 5000,
}, async () => {
  const started = deferred<Request>();
  const release = deferred<Response>();
  const cancelled = deferred<void>();
  const server = createNodeRequestServer(async (request) => {
    started.resolve(request);
    return release.promise;
  });
  const port = await listen(server);
  const client = httpRequest({ host: '127.0.0.1', port, path: '/v1/models' });
  client.on('error', () => {});
  try {
    client.end();
    const request = await started.promise;
    assert.equal(request.signal.aborted, false);
    const aborted = deferred<void>();
    request.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
    client.destroy();
    // Give the server close listener a bounded chance to run without leaving a hung handler.
    for (let i = 0; i < 30 && !request.signal.aborted; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(request.signal.aborted, true);
    await aborted.promise;
    release.resolve(new Response(new ReadableStream({ cancel: () => cancelled.resolve() })));
    await cancelled.promise;
  } finally {
    release.resolve(new Response('cleanup'));
    client.destroy();
    await close(server);
  }
});

test('progressive response delivery and normal completion keep request signal active', {
  timeout: 5000,
}, async () => {
  const release = deferred<void>();
  const handled = deferred<Request>();
  const server = createNodeRequestServer(async (request) => {
    handled.resolve(request);
    return new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode('data: first\n\n'));
          await release.promise;
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/chat/completions`);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    const reader = response.body?.getReader();
    assert.ok(reader);
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
    release.resolve();
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: [DONE]\n\n');
    assert.equal((await reader.read()).done, true);
    reader.releaseLock();
    await tick();
    assert.equal((await handled.promise).signal.aborted, false);
  } finally {
    release.resolve();
    await close(server);
  }
});

test('disconnect during streaming aborts request and cancels response body', {
  timeout: 5000,
}, async () => {
  const handled = deferred<Request>();
  const cancelled = deferred<void>();
  const server = createNodeRequestServer(async (request) => {
    handled.resolve(request);
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: first\n\n'));
        },
        cancel() {
          cancelled.resolve();
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  const port = await listen(server);
  const first = deferred<void>();
  const client = httpRequest({ host: '127.0.0.1', port, path: '/' }, (response) => {
    response.on('error', () => {});
    response.once('data', () => {
      first.resolve();
      client.destroy();
    });
  });
  client.on('error', () => {});
  try {
    client.end();
    await first.promise;
    await cancelled.promise;
    assert.equal((await handled.promise).signal.aborted, true);
  } finally {
    client.destroy();
    await close(server);
  }
});

test('interrupted upload aborts the Fetch request signal', { timeout: 5000 }, async () => {
  const handled = deferred<Request>();
  const release = deferred<Response>();
  const server = createNodeRequestServer(async (request) => {
    handled.resolve(request);
    return release.promise;
  });
  const port = await listen(server);
  const client = httpRequest({
    host: '127.0.0.1',
    port,
    path: '/',
    method: 'POST',
    headers: { 'content-length': '1000' },
  });
  client.on('error', () => {});
  try {
    client.write('partial');
    const request = await handled.promise;
    const aborted = deferred<void>();
    request.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
    client.destroy();
    await aborted.promise;
    assert.equal(request.signal.aborted, true);
  } finally {
    release.resolve(new Response('cleanup'));
    client.destroy();
    await close(server);
  }
});

test('normal completion removes bridge cancellation listeners', { timeout: 5000 }, async () => {
  const server = createNodeRequestServer(async () => new Response('complete'));
  const finished = deferred<{ abortedListeners: number; closeListeners: number }>();
  server.on('request', (incoming, outgoing) => {
    const abortedListeners = incoming.listeners('aborted');
    const closeListeners = outgoing.listeners('close');
    outgoing.once('finish', () => {
      setImmediate(() =>
        finished.resolve({
          abortedListeners: abortedListeners.filter((listener) =>
            incoming.listeners('aborted').includes(listener),
          ).length,
          closeListeners: closeListeners.filter((listener) =>
            outgoing.listeners('close').includes(listener),
          ).length,
        }),
      );
    });
  });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(await response.text(), 'complete');
    assert.deepEqual(await finished.promise, { abortedListeners: 0, closeListeners: 0 });
  } finally {
    await close(server);
  }
});

test('handler failure before headers preserves safe compatible JSON fallback', {
  timeout: 5000,
}, async () => {
  const server = createNodeRequestServer(async () => {
    throw new Error('private upstream detail');
  });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/chat/completions`);
    assert.equal(response.status, 500);
    const body = (await response.json()) as {
      error: { code: number; metadata: { opengranter_code: string } };
    };
    assert.equal(body.error.code, 500);
    assert.equal(body.error.metadata.opengranter_code, 'internal_error');
    assert.equal(JSON.stringify(body).includes('private'), false);
  } finally {
    await close(server);
  }
});
