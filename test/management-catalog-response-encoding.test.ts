import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { createManagementCatalogClient } from '../src/management/catalog-client.ts';

const row = { id: 'team/model', object: 'model', created: 0, owned_by: 'team' };

async function withHttp(body: Buffer, operation: (origin: string) => Promise<void>, status = 200) {
  const server = createServer((_request, response) => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    for (const byte of body) response.write(Buffer.from([byte]));
    response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await operation(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
}

function malformed(list: boolean, bytes: readonly number[]) {
  const json = JSON.stringify(list ? { data: [row] } : row);
  const marker = list ? 'team/model' : 'team';
  const start = list ? 0 : json.indexOf('owned_by');
  const offset = json.indexOf(marker, start);
  return Buffer.concat([
    Buffer.from(json.slice(0, offset)),
    Buffer.from(bytes),
    Buffer.from(json.slice(offset + marker.length)),
  ]);
}

for (const list of [true, false]) {
  test(`actual HTTP ${list ? 'list' : 'detail'} rejects malformed UTF-8 instead of replacing model identity`, async () => {
    for (const bytes of [[0xff], [0xe2, 0x82], [0xc0, 0xaf], [0xed, 0xa0, 0x80]]) {
      await withHttp(malformed(list, bytes), async (origin) => {
        const client = createManagementCatalogClient((path, init) => fetch(origin + path, init));
        assert.deepEqual(await (list ? client.list() : client.detail(row.id)), {
          state: 'unavailable',
        });
      });
    }
  });
}

test('actual HTTP preserves valid multibyte identifiers and publishers across writes', async () => {
  const unicode = { ...row, id: 'team/모델🚀', owned_by: '공급자' };
  await withHttp(Buffer.from(JSON.stringify({ data: [unicode] })), async (origin) => {
    const client = createManagementCatalogClient((path, init) => fetch(origin + path, init));
    assert.deepEqual(await client.list(), { state: 'ready', data: [unicode] });
  });
  await withHttp(Buffer.from(JSON.stringify(unicode)), async (origin) => {
    const client = createManagementCatalogClient((path, init) => fetch(origin + path, init));
    assert.deepEqual(await client.detail(unicode.id), { state: 'ready', data: unicode });
  });
});

test('actual HTTP private malformed errors retain authentication and denial mapping', async () => {
  for (const [status, state] of [
    [401, 'unauthenticated'],
    [403, 'denied'],
  ] as const) {
    await withHttp(
      Buffer.from([0xff]),
      async (origin) => {
        const client = createManagementCatalogClient((path, init) => fetch(origin + path, init));
        assert.deepEqual(await client.list(), { state });
      },
      status,
    );
  }
});
