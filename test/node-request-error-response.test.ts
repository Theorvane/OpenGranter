import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';

for (const prefix of ['/v1/', '/api/v1/']) {
  test(`existing Node bridge fallback retains fixed proxy error format at ${prefix}`, async () => {
    const server = createNodeRequestServer(async () => {
      throw Error('private-adapter');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const response = await fetch(`http://127.0.0.1:${address.port}${prefix}chat/completions`);
      assert.equal(response.status, 500);
      assert.equal(response.headers.get('cache-control'), null);
      assert.equal(response.headers.get('x-request-id'), null);
      assert.deepEqual(
        await response.json(),
        prefix === '/api/v1/'
          ? {
              error: {
                code: 500,
                message: 'Internal server error.',
                metadata: { opengranter_code: 'internal_error', error_type: 'server' },
              },
            }
          : { error: { code: 'internal_error', message: 'Internal server error.' } },
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });
}
