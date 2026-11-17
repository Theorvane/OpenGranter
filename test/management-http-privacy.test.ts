import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';

async function withResponse(
  path: string,
  handle: (request: Request) => Promise<Response>,
  verify: (response: Response) => Promise<void>,
  fallback?: () => Response,
  method = 'GET',
) {
  const server = createNodeRequestServer(handle, fallback);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await verify(await fetch(`http://127.0.0.1:${address.port}${path}`, { method }));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function privateHeaders(response: Response) {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
}

for (const path of ['/management', '/management/', '/management/v1/models?view=private']) {
  test(`management transport overrides unsafe child cache headers: ${path}`, async () => {
    await withResponse(
      path,
      async () =>
        Response.json(
          { data: ['synthetic-scoped-model'] },
          {
            headers: {
              'cache-control': 'public, max-age=3600',
              'x-content-type-options': 'invalid',
              'x-request-id': 'synthetic-request',
            },
          },
        ),
      async (response) => {
        privateHeaders(response);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('x-request-id'), 'synthetic-request');
        assert.deepEqual(await response.json(), { data: ['synthetic-scoped-model'] });
      },
    );
  });
}

for (const status of [401, 403, 404, 503]) {
  test(`management transport protects failure status ${status}`, async () => {
    await withResponse(
      '/management/v1/models',
      async () =>
        new Response('fixed denial', {
          status,
          headers: { 'www-authenticate': 'Bearer' },
        }),
      async (response) => {
        privateHeaders(response);
        assert.equal(response.status, status);
        assert.equal(response.headers.get('www-authenticate'), 'Bearer');
        assert.equal(await response.text(), 'fixed denial');
      },
    );
  });
}

test('management POST response is private without changing method or body', async () => {
  await withResponse(
    '/management/v1/proxy-tokens',
    async (request) => {
      assert.equal(request.method, 'POST');
      return Response.json({ token: 'synthetic-one-time-value' }, { status: 201 });
    },
    async (response) => {
      privateHeaders(response);
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), { token: 'synthetic-one-time-value' });
    },
    undefined,
    'POST',
  );
});

test('management unexpected-error fallback is private and does not reflect the error', async () => {
  await withResponse(
    '/management/v1/models',
    async () => {
      throw new Error('synthetic-private-driver-message');
    },
    async (response) => {
      privateHeaders(response);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        error: { code: 'internal_error', message: 'Internal server error.' },
      });
    },
  );
});

test('management custom fallback cannot override privacy headers', async () => {
  await withResponse(
    '/management/v1/usage',
    async () => {
      throw new Error('private');
    },
    async (response) => {
      privateHeaders(response);
      assert.equal(response.status, 503);
      assert.equal(await response.text(), 'fixed fallback');
    },
    () =>
      new Response('fixed fallback', {
        status: 503,
        headers: { 'cache-control': 'public', 'x-content-type-options': 'invalid' },
      }),
  );
});

for (const path of ['/management-public', '/public?next=/management/v1/models']) {
  test(`management privacy does not select an unrelated path: ${path}`, async () => {
    await withResponse(
      path,
      async () =>
        new Response('public', {
          headers: { 'cache-control': 'public, max-age=60' },
        }),
      async (response) => {
        assert.equal(response.headers.get('cache-control'), 'public, max-age=60');
        assert.equal(response.headers.get('x-content-type-options'), null);
        assert.equal(await response.text(), 'public');
      },
    );
  });
}
