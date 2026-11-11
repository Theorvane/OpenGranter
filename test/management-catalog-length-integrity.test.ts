import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createManagementCatalogClient,
  createSsoManagementCatalogClient,
} from '../src/management/catalog-client.ts';

const row = { id: 'team/모델🚀', object: 'model', created: 0, owned_by: 'opengranter' };
for (const [name, factory] of [
  ['proxy', createManagementCatalogClient],
  ['sso', createSsoManagementCatalogClient],
] as const) {
  for (const list of [true, false]) {
    const body = JSON.stringify(list ? { data: [row] } : row);
    const size = new TextEncoder().encode(body).byteLength;
    for (const declared of [0, size - 1, size + 1, body.length]) {
      test(`${name} ${list ? 'list' : 'detail'} rejects mismatched byte length ${declared}`, async () => {
        const client = factory(
          async () =>
            new Response(body, {
              headers: { 'content-length': String(declared) },
            }),
        );
        assert.deepEqual(await (list ? client.list() : client.detail(row.id)), {
          state: 'unavailable',
        });
      });
    }
    for (const encoding of [undefined, 'identity', ' Identity ', 'gzip', 'br']) {
      test(`${name} ${list ? 'list' : 'detail'} preserves ${encoding ?? 'absent encoding'}`, async () => {
        const compressed = encoding === 'gzip' || encoding === 'br';
        const headers = new Headers({ 'content-length': String(compressed ? 3 : size) });
        if (encoding) headers.set('content-encoding', encoding);
        const client = factory(async () => new Response(body, { headers }));
        assert.deepEqual(await (list ? client.list() : client.detail(row.id)), {
          state: 'ready',
          data: list ? [row] : row,
        });
      });
    }
    test(`${name} ${list ? 'list' : 'detail'} accepts absent length`, async () => {
      const client = factory(async () => new Response(body));
      assert.deepEqual(await (list ? client.list() : client.detail(row.id)), {
        state: 'ready',
        data: list ? [row] : row,
      });
    });
  }
  test(`${name} preserves status-only denial despite mismatched length`, async () => {
    const client = factory(
      async () => new Response('private', { status: 403, headers: { 'content-length': '100' } }),
    );
    assert.deepEqual(await client.list(), { state: 'denied' });
  });
}
