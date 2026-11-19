import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { createCurrentPrincipalClient } from '../src/management/current-principal-client.ts';

test('Account integrity over actual HTTP rejects stalled oversized response and retries decoded gzip', async () => {
  const identity = { id: 'wire-human-계정', kind: 'human' };
  const json = JSON.stringify(identity);
  let calls = 0;
  let closed!: () => void;
  const disconnected = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const server = createServer((request, response) => {
    assert.equal(request.url, '/management/v1/principal');
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.accept, 'application/json');
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    if (++calls === 1) {
      response.setHeader('content-length', '4097');
      response.on('close', closed);
      response.flushHeaders();
      // A broken upstream never sends the claimed body or EOF.
    } else {
      const compressed = gzipSync(json);
      assert.notEqual(compressed.byteLength, Buffer.byteLength(json));
      response.setHeader('content-encoding', 'gzip');
      response.setHeader('content-length', compressed.byteLength);
      response.end(compressed);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const client = createCurrentPrincipalClient((path, init) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, init),
  );
  try {
    assert.deepEqual(await client.read(), { state: 'unavailable' });
    await disconnected;
    assert.deepEqual(await client.read(), { state: 'ready', data: identity });
    assert.equal(calls, 2);
  } finally {
    client.invalidate();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
