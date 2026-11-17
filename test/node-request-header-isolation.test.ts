import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';

for (const kind of ['status', 'header', 'consumed'] as const) {
  test(`pre-commit ${kind} failure discards normal response headers over HTTP`, async () => {
    const server = createNodeRequestServer(async () => {
      if (kind === 'status') return Response.error();
      const response = new Response('private-body');
      response.headers.set('a-private', 'must-not-survive');
      response.headers.set('set-cookie', 'private-cookie=not-a-session');
      response.headers.set('location', '/private-redirect');
      response.headers.set('content-length', '9999');
      response.headers.set('content-encoding', 'gzip');
      if (kind === 'header') response.headers.set('z-invalid', String.fromCharCode(1));
      else await response.text();
      return response;
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetch(`http://127.0.0.1:${address.port}/management/v1/models`, {
          signal: AbortSignal.timeout(3000),
          redirect: 'error',
        });
        assert.equal(response.status, 500);
        for (const name of ['a-private', 'set-cookie', 'location', 'content-encoding']) {
          assert.equal(response.headers.get(name), null, name);
        }
        assert.notEqual(response.headers.get('content-length'), '9999');
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        assert.deepEqual(await response.json(), {
          error: { code: 'internal_error', message: 'Internal server error.' },
        });
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}

test('valid response retains intended headers and body', async () => {
  const server = createNodeRequestServer(
    async () =>
      new Response('public', {
        status: 202,
        headers: { 'set-cookie': 'public-preference=one', 'x-result': 'ready' },
      }),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/management/v1/models`);
    assert.equal(response.status, 202);
    assert.equal(response.headers.get('set-cookie'), 'public-preference=one');
    assert.equal(response.headers.get('x-result'), 'ready');
    assert.equal(await response.text(), 'public');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
