import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagementCatalogClient } from '../src/management/catalog-client.ts';

const row = { id: 'team/model', object: 'model', created: 0, owned_by: 'team' };
test('published descriptions and context survive list and detail without extra metadata', async () => {
  const metadata = {
    name: ' Model 模型 ',
    description: '<b>inert text</b>\n説明',
    context_length: 8192,
  };
  for (const list of [false, true]) {
    const item = { ...row, ...metadata, canonical_slug: 'private', secret: 'private' };
    const client = createManagementCatalogClient(async () =>
      Response.json(list ? { data: [item] } : item),
    );
    assert.deepEqual(await (list ? client.list() : client.detail(row.id)), {
      state: 'ready',
      data: list ? [{ ...row, ...metadata }] : { ...row, ...metadata },
    });
  }
});
test('unknown context, zero context and omitted basic metadata stay distinct', async () => {
  for (const metadata of [
    {},
    { context_length: null },
    { context_length: 0 },
    { description: '' },
  ]) {
    const client = createManagementCatalogClient(async () =>
      Response.json({ ...row, ...metadata }),
    );
    assert.deepEqual(await client.detail(row.id), {
      state: 'ready',
      data: { ...row, ...metadata },
    });
  }
});
test('malformed published descriptive metadata fails closed on list and detail', async () => {
  for (const metadata of [
    { name: '' },
    { name: ' ' },
    { name: null },
    { name: 'x'.repeat(257) },
    { description: null },
    { description: 0 },
    { description: 'x'.repeat(8193) },
    ...[-1, 0.5, '8192', Number.MAX_SAFE_INTEGER + 1].map((context_length) => ({ context_length })),
  ]) {
    for (const list of [false, true]) {
      const item = { ...row, ...metadata };
      const client = createManagementCatalogClient(async () =>
        Response.json(list ? { data: [item] } : item),
      );
      assert.deepEqual(await (list ? client.list() : client.detail(row.id)), {
        state: 'unavailable',
      });
    }
  }
});

import type { AddressInfo } from 'node:net';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import {
  discoveryFixture,
  discoveryModel,
  discoveryPrivacy,
} from './model-discovery-filters-fixture.ts';

for (const kind of ['managed', 'delegated'] as const) {
  test(`published descriptive metadata traverses ${kind} gateway HTTP with fresh policy and audit`, async () => {
    const publication = discoveryModel('team/model', { kind, name: '公開 Model', context: null });
    assert.ok(publication.openRouterMetadata);
    const f = discoveryFixture([
      {
        ...publication,
        openRouterMetadata: {
          ...publication.openRouterMetadata,
          description: '<b>plain published text</b>',
        },
      },
    ]);
    const server = createNodeRequestServer(f.handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // Local fixture proxy credential, not browser/company SSO authentication.
    const client = createManagementCatalogClient((path, init) =>
      fetch(origin + path, {
        ...init,
        headers: { ...init.headers, authorization: 'Bearer fixture' },
      }),
    );
    try {
      const listed = await client.list();
      assert.equal(listed.state, 'ready');
      if (listed.state !== 'ready') assert.fail('list unavailable');
      assert.equal(listed.data[0]?.name, '公開 Model');
      assert.equal(listed.data[0]?.description, '<b>plain published text</b>');
      assert.equal(listed.data[0]?.context_length, null);
      assert.doesNotMatch(JSON.stringify(listed), /private\/canonical|upstream|credentialRef/u);
      assert.deepEqual(await client.detail('team/model'), { state: 'ready', data: listed.data[0] });
      f.statements.push({ effect: 'Deny', actions: ['*'], resources: ['provider:provider'] });
      assert.deepEqual(await client.list(), { state: 'ready', data: [] });
      assert.deepEqual(await client.detail('team/model'), { state: 'missing' });
      assert.equal(f.events.length, 4);
      assert.equal(f.reads(), 4);
      discoveryPrivacy(f);
    } finally {
      client.invalidate();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}
