import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as nodeRequest } from 'node:http';
import test from 'node:test';
import {
  createSsoModelCatalogHandler,
  createSsoModelCatalogServer,
  type SsoModelCatalogHttpPorts,
} from '../src/gateway/sso-model-catalog-http.ts';

function fixture() {
  let calls = 0;
  const model = { id: 'team/chat', object: 'model', created: 42, owned_by: 'opengranter' } as const;
  const ports: SsoModelCatalogHttpPorts = {
    newRequestId: () => 'framing-1',
    catalog: {
      list: async () => {
        calls++;
        return { state: 'ready', data: [model] };
      },
      detail: async () => {
        calls++;
        return { state: 'ready', data: model };
      },
    },
  };
  return { ports, calls: () => calls };
}

for (const suffix of ['', '/team%2Fchat']) {
  for (const [name, headers] of [
    ['nonempty length', { 'content-length': '3' }],
    ['noncanonical zero length', { 'content-length': '00' }],
    ['chunked framing', { 'transfer-encoding': 'chunked' }],
  ] as const) {
    test(`Fetch catalog rejects ${name} for ${suffix || 'list'} before service work`, async () => {
      const f = fixture();
      const response = await createSsoModelCatalogHandler(f.ports)(
        new Request(`http://localhost/management/v1/models${suffix}`, {
          headers: { authorization: 'Bearer fixture-token', ...headers },
        }),
      );
      assert.equal(response.status, 400);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.doesNotMatch(await response.text(), /fixture-token|team\/chat/u);
      assert.equal(f.calls(), 0);
    });
  }
}

test('Fetch catalog accepts absent body or exact zero length for list and detail', async () => {
  const f = fixture();
  const handle = createSsoModelCatalogHandler(f.ports);
  for (const suffix of ['', '/team%2Fchat']) {
    for (const headers of [{}, { 'content-length': '0' }]) {
      const response = await handle(
        new Request(`http://localhost/management/v1/models${suffix}`, {
          headers: { authorization: 'Bearer fixture-token', ...headers },
        }),
      );
      assert.equal(response.status, 200);
    }
  }
  assert.equal(f.calls(), 4);
});

for (const suffix of ['', '/team%2Fchat']) {
  for (const chunked of [false, true]) {
    test(`real Node catalog rejects ${chunked ? 'chunked' : 'length-delimited'} GET body for ${suffix || 'list'}`, async () => {
      const f = fixture();
      const server = createSsoModelCatalogServer(f.ports);
      try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        const response = await new Promise<{
          status: number | undefined;
          body: string;
          cache: string | undefined;
        }>((resolve, reject) => {
          const req = nodeRequest(
            {
              host: '127.0.0.1',
              port: address.port,
              path: `/management/v1/models${suffix}`,
              method: 'GET',
              headers: {
                authorization: 'Bearer fixture-token',
                ...(chunked ? { 'transfer-encoding': 'chunked' } : { 'content-length': '3' }),
                connection: 'close',
              },
            },
            (res) => {
              let body = '';
              res.setEncoding('utf8');
              res.on('data', (chunk: string) => {
                body += chunk;
              });
              res.on('end', () =>
                resolve({ status: res.statusCode, body, cache: res.headers['cache-control'] }),
              );
              res.on('error', reject);
            },
          );
          req.on('error', reject);
          req.end('abc');
        });
        assert.equal(response.status, 400);
        assert.equal(response.cache, 'no-store');
        assert.doesNotMatch(response.body, /fixture-token|team\/chat|abc/u);
        assert.equal(f.calls(), 0);
      } finally {
        if (server.listening)
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
      }
    });
  }
}
