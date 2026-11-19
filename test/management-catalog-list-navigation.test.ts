import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createManagementCatalogClient,
  createSsoManagementCatalogClient,
} from '../src/management/catalog-client.ts';
import {
  createManagementCatalogSession,
  createSsoManagementCatalogSession,
} from '../src/management/catalog-session.ts';

const row = (id: string) => ({ id, object: 'model', created: 0, owned_by: 'opengranter' });
for (const [kind, createClient, createSession] of [
  ['proxy', createManagementCatalogClient, createManagementCatalogSession],
  ['sso', createSsoManagementCatalogClient, createSsoManagementCatalogSession],
] as const) {
  for (const id of [
    '',
    '../model',
    'a//b',
    'a%2fb',
    'a?b',
    'a#b',
    'a b',
    '\ud800',
    'x'.repeat(513),
  ]) {
    test(`${kind} list rejects unopenable alias ${JSON.stringify(id)}`, async () => {
      const client = createClient(async () => Response.json({ data: [row('safe'), row(id)] }));
      assert.deepEqual(await client.list(), { state: 'unavailable' });
    });
  }
  test(`${kind} duplicate aliases are not rendered or silently deduplicated`, async () => {
    const client = createClient(async () =>
      Response.json({ data: [row('team/model'), { ...row('team/model'), created: 1 }] }),
    );
    assert.deepEqual(await client.list(), { state: 'unavailable' });
  });
  test(`${kind} malformed refresh clears a previously displayed detail`, async () => {
    let malformed = false;
    const session = createSession();
    session.authorize(async () =>
      Response.json(malformed ? { data: [row('same'), row('same')] } : row('safe')),
    );
    await session.detail('safe');
    assert.equal(session.snapshot().state, 'detail');
    malformed = true;
    const pending = session.list();
    assert.deepEqual(session.snapshot(), { state: 'loading', view: 'list' });
    await pending;
    assert.deepEqual(session.snapshot(), { state: 'unavailable' });
    session.dispose();
  });
  test(`${kind} preserves valid Unicode and exact case without normalization`, async () => {
    const data = [row('team/模型'), row('Team/model'), row('team/model')];
    const paths: string[] = [];
    const base = kind === 'sso' ? '/management/v1/models' : '/api/v1/models';
    const client = createClient(async (path) => {
      paths.push(path);
      return Response.json(
        path === base
          ? { data }
          : data.find((item) => path === `${base}/${encodeURIComponent(item.id)}`),
      );
    });
    assert.deepEqual(await client.list(), { state: 'ready', data });
    for (const item of data)
      assert.deepEqual(await client.detail(item.id), { state: 'ready', data: item });
    assert.equal(paths.length, 4);
  });
}
test('proxy reserved collection aliases fail list validation without changing SSO names', async () => {
  for (const id of ['count', 'user']) {
    assert.deepEqual(
      await createManagementCatalogClient(async () => Response.json({ data: [row(id)] })).list(),
      { state: 'unavailable' },
    );
    assert.deepEqual(
      await createSsoManagementCatalogClient(async () => Response.json({ data: [row(id)] })).list(),
      { state: 'ready', data: [row(id)] },
    );
  }
});
