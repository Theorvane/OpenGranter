import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagementCatalogClient } from '../src/management/catalog-client.ts';

const row = { id: 'team/model', object: 'model', created: 0, owned_by: 'team' };
const capabilities = {
  architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
  supported_parameters: ['tools', 'future-option'],
};
test('list and detail preserve only published display capabilities', async () => {
  for (const list of [false, true]) {
    const item = {
      ...row,
      ...capabilities,
      architecture: {
        ...capabilities.architecture,
        modality: 'not-display',
        tokenizer: 'not-display',
        secret: 'private',
      },
      upstreamModelId: 'private',
    };
    const client = createManagementCatalogClient(async () =>
      Response.json(list ? { data: [item] } : item),
    );
    const result = await (list ? client.list() : client.detail(row.id));
    assert.deepEqual(result, {
      state: 'ready',
      data: list ? [{ ...row, ...capabilities }] : { ...row, ...capabilities },
    });
    if (result.state === 'ready') {
      const model = Array.isArray(result.data) ? result.data[0] : result.data;
      assert.ok(model);
      assert.ok(Object.isFrozen(model.architecture));
      assert.ok(Object.isFrozen(model.architecture.input_modalities));
      assert.ok(Object.isFrozen(model.architecture.output_modalities));
      assert.ok(Object.isFrozen(model.supported_parameters));
    }
  }
});
test('empty arrays, exact future labels and omitted metadata remain distinct', async () => {
  for (const extra of [
    {},
    { supported_parameters: [] },
    { architecture: { input_modalities: [], output_modalities: [' Future '] } },
  ]) {
    const client = createManagementCatalogClient(async () => Response.json({ ...row, ...extra }));
    assert.deepEqual(await client.detail(row.id), { state: 'ready', data: { ...row, ...extra } });
  }
});
test('invalid published capability lists fail closed without partial data', async () => {
  const invalid = [
    null,
    'text',
    [null],
    [1],
    [''],
    [' '],
    ['x'.repeat(129)],
    ['text', 'text'],
    Array.from({ length: 65 }, (_, i) => String(i)),
  ];
  for (const value of invalid) {
    for (const extra of [
      { supported_parameters: value },
      { architecture: { input_modalities: value, output_modalities: ['text'] } },
      { architecture: { input_modalities: ['text'], output_modalities: value } },
    ]) {
      for (const list of [false, true]) {
        const item = { ...row, ...extra };
        const client = createManagementCatalogClient(async () =>
          Response.json(list ? { data: [row, item] } : item),
        );
        assert.deepEqual(await (list ? client.list() : client.detail(row.id)), {
          state: 'unavailable',
        });
      }
    }
  }
  for (const architecture of [
    null,
    [],
    {},
    { input_modalities: ['text'] },
    { output_modalities: ['text'] },
  ]) {
    const client = createManagementCatalogClient(async () =>
      Response.json({ ...row, architecture }),
    );
    assert.deepEqual(await client.detail(row.id), { state: 'unavailable' });
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
  test(`published capabilities traverse ${kind} HTTP with fresh authorization and audit`, async () => {
    const f = discoveryFixture([
      discoveryModel(row.id, {
        kind,
        inputs: ['text', 'image'],
        outputs: ['text'],
        parameters: ['tools', 'future-option'],
      }),
    ]);
    const server = createNodeRequestServer(f.handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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
      assert.deepEqual(listed.data[0]?.architecture, capabilities.architecture);
      assert.deepEqual(listed.data[0]?.supported_parameters, capabilities.supported_parameters);
      assert.doesNotMatch(
        JSON.stringify(listed),
        /unrelated-private-label|private\/canonical|upstream|credentialRef/u,
      );
      assert.deepEqual(await client.detail(row.id), { state: 'ready', data: listed.data[0] });
      f.statements.push({ effect: 'Deny', actions: ['*'], resources: ['provider:provider'] });
      assert.deepEqual(await client.list(), { state: 'ready', data: [] });
      assert.deepEqual(await client.detail(row.id), { state: 'missing' });
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
