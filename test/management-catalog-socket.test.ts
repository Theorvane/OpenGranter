import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { createManagementCatalogClient } from '../src/management/catalog-client.ts';
import {
  discoveryFixture,
  discoveryModel,
  discoveryPrivacy,
} from './model-discovery-filters-fixture.ts';

for (const kind of ['managed', 'delegated'] as const) {
  test(`catalog client reads real ${kind} HTTP list/detail and fresh IAM without provider calls`, async () => {
    const f = discoveryFixture([discoveryModel('team/模型', { kind, basic: true })]);
    const server = createNodeRequestServer(f.handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      // Test-only authenticated transport. Not a browser session or token bridge.
      const client = createManagementCatalogClient((path, init) =>
        fetch(origin + path, {
          ...init,
          headers: { ...init.headers, authorization: 'Bearer fixture' },
        }),
      );
      const listed = await client.list();
      assert.equal(listed.state, 'ready');
      if (listed.state !== 'ready') assert.fail('list unavailable');
      assert.equal(listed.data.length, 1);
      assert.deepEqual(await client.detail('team/模型'), { state: 'ready', data: listed.data[0] });
      f.statements.push({ effect: 'Deny', actions: ['*'], resources: ['provider:provider'] });
      assert.deepEqual(await client.detail('team/模型'), { state: 'missing' });
      assert.deepEqual(await client.list(), { state: 'ready', data: [] });
      assert.equal(f.reads(), 4);
      assert.equal(f.events.length, 4);
      discoveryPrivacy(f);
      client.invalidate();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}

test('session invalidation while body parsing suppresses released catalog', async () => {
  let resolve!: (value: unknown) => void;
  let started!: () => void;
  const parsing = new Promise<void>((done) => {
    started = done;
  });
  const client = createManagementCatalogClient(
    async () =>
      ({
        status: 200,
        json: () => {
          started();
          return new Promise((done) => {
            resolve = done;
          });
        },
      }) as Response,
  );
  const pending = client.list();
  await parsing;
  client.invalidate();
  resolve({ data: [{ id: 'private', object: 'model', created: 0, owned_by: 'owner' }] });
  assert.deepEqual(await pending, { state: 'cancelled' });
});
