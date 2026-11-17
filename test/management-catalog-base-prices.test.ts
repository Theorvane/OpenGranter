import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagementCatalogClient } from '../src/management/catalog-client.ts';

const row = { id: 'team/model', object: 'model', created: 0, owned_by: 'team' };
test('published base prices survive detail and list projection exactly', async () => {
  const pricing = { prompt: '0.00000100', completion: '2E-7', discount: 0.5, secret: 'private' };
  const expected = { ...row, pricing: { prompt: pricing.prompt, completion: pricing.completion } };
  const detail = createManagementCatalogClient(async () => Response.json({ ...row, pricing }));
  assert.deepEqual(await detail.detail(row.id), { state: 'ready', data: expected });
  const list = createManagementCatalogClient(async () =>
    Response.json({ data: [{ ...row, pricing }] }),
  );
  assert.deepEqual(await list.list(), { state: 'ready', data: [expected] });
});
test('zero prices remain known and basic legacy rows remain unchanged', async () => {
  for (const item of [row, { ...row, pricing: { prompt: '0', completion: '0e-200' } }]) {
    const client = createManagementCatalogClient(async () => Response.json(item));
    assert.deepEqual(await client.detail(row.id), { state: 'ready', data: item });
  }
});
test('malformed supplied base prices fail closed rather than fabricate unknown or zero', async () => {
  for (const pricing of [
    null,
    [],
    {},
    { prompt: '0' },
    ...[-1, 0, '', '-1', '01', 'NaN', 'Infinity', '1e999', ' 1', '1 ', '1'.repeat(129)].map(
      (prompt) => ({ prompt, completion: '0' }),
    ),
    { prompt: '0', completion: null },
  ]) {
    for (const list of [false, true]) {
      const client = createManagementCatalogClient(async () =>
        Response.json(list ? { data: [{ ...row, pricing }] } : { ...row, pricing }),
      );
      assert.deepEqual(await (list ? client.list() : client.detail(row.id)), {
        state: 'unavailable',
      });
    }
  }
});
test('valid pricing never makes a foreign detail ID acceptable', async () => {
  const client = createManagementCatalogClient(async () =>
    Response.json({
      ...row,
      id: 'foreign',
      pricing: { prompt: '0', completion: '1' },
    }),
  );
  assert.deepEqual(await client.detail(row.id), { state: 'unavailable' });
});

import type { AddressInfo } from 'node:net';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import {
  discoveryFixture,
  discoveryModel,
  discoveryPrivacy,
} from './model-discovery-filters-fixture.ts';

for (const kind of ['managed', 'delegated'] as const) {
  test(`published base prices traverse actual ${kind} HTTP with fresh IAM and required audit`, async () => {
    const f = discoveryFixture([discoveryModel('team/model', { kind })]);
    const server = createNodeRequestServer(f.handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // Test-only proxy authentication, NOT company SSO or a browser session.
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
      assert.deepEqual(listed.data[0]?.pricing, { prompt: '0.000001', completion: '0.000002' });
      assert.doesNotMatch(JSON.stringify(listed), /private\/canonical|upstream|discount/u);
      assert.deepEqual(await client.detail('team/model'), { state: 'ready', data: listed.data[0] });
      f.statements.push({ effect: 'Deny', actions: ['*'], resources: ['provider:provider'] });
      assert.deepEqual(await client.list(), { state: 'ready', data: [] });
      assert.deepEqual(await client.detail('team/model'), { state: 'missing' });
      assert.equal(f.reads(), 4);
      assert.equal(f.events.length, 4);
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
