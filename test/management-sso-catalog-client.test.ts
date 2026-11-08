import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createManagementCatalogClient,
  createSsoManagementCatalogClient,
} from '../src/management/catalog-client.ts';

test('SSO exact list/detail including proxy-only reserved names', async () => {
  const paths: string[] = [];
  const row = (id: string) => ({ id, object: 'model', created: 0, owned_by: 'opengranter' });
  const client = createSsoManagementCatalogClient(async (path, init) => {
    paths.push(path);
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).has('authorization'), false);
    return Response.json(
      path === '/management/v1/models'
        ? { data: [row('team/模型')] }
        : row(decodeURIComponent(path.split('/').at(-1) ?? '')),
    );
  });
  assert.deepEqual(await client.list(), { state: 'ready', data: [row('team/模型')] });
  for (const id of ['team/模型', 'count', 'user'])
    assert.deepEqual(await client.detail(id), { state: 'ready', data: row(id) });
  assert.deepEqual(paths, [
    '/management/v1/models',
    '/management/v1/models/team%2F%E6%A8%A1%E5%9E%8B',
    '/management/v1/models/count',
    '/management/v1/models/user',
  ]);
  const proxy = createManagementCatalogClient(async () => {
    throw Error('must not request');
  });
  assert.deepEqual(await proxy.detail('count'), { state: 'unavailable' });
  assert.deepEqual(await proxy.detail('user'), { state: 'unavailable' });
});

test('SSO preserves safe states', async () => {
  for (const [status, state] of [
    [401, 'unauthenticated'],
    [403, 'denied'],
    [404, 'missing'],
    [503, 'unavailable'],
  ] as const) {
    const client = createSsoManagementCatalogClient(
      async () => new Response('private-error', { status }),
    );
    assert.deepEqual(await client.list(), { state });
  }
});

test('SSO rejects invalid contract rows without changing proxy decoding', async () => {
  const valid = { id: 'team/chat', object: 'model', created: 0, owned_by: 'opengranter' };
  for (const patch of [
    { created: -1 },
    { created: 0.5 },
    { created: Number.MAX_SAFE_INTEGER + 1 },
    { owned_by: 'private-provider' },
  ]) {
    const invalid = { ...valid, ...patch };
    const sso = createSsoManagementCatalogClient(async (path) =>
      Response.json(path.endsWith('/models') ? { data: [valid, invalid] } : invalid),
    );
    assert.deepEqual(await sso.list(), { state: 'unavailable' });
    assert.deepEqual(await sso.detail(valid.id), { state: 'unavailable' });
    const proxy = createManagementCatalogClient(async () => Response.json(invalid));
    assert.deepEqual(await proxy.detail(valid.id), { state: 'ready', data: invalid });
  }
});

test('SSO list exposes only aliases navigable by the detail contract', async () => {
  for (const id of [
    'a b',
    'a%2Fb',
    'a?b',
    'a#b',
    'a\\b',
    'a/../b',
    'a//b',
    '/a',
    'a/',
    'a\u007fb',
    'a'.repeat(513),
    '\ud800',
  ]) {
    const row = { id, object: 'model', created: 0, owned_by: 'opengranter' };
    const sso = createSsoManagementCatalogClient(async () => Response.json({ data: [row] }));
    assert.deepEqual(await sso.list(), { state: 'unavailable' }, JSON.stringify(id));
    const proxy = createManagementCatalogClient(async () => Response.json({ data: [row] }));
    assert.deepEqual(await proxy.list(), { state: 'ready', data: [row] });
  }
});

test('SSO preserves its basic publication boundary while proxy retains display metadata', async () => {
  const base = { id: 'team/chat', object: 'model', created: 0, owned_by: 'opengranter' };
  const display = {
    ...base,
    name: 'Published model',
    description: 'Information',
    context_length: null,
    supported_parameters: ['tools'],
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    pricing: { prompt: '0.01', completion: '0.02' },
  };
  const request = async (path: string) =>
    Response.json(path.endsWith('/models') ? { data: [display] } : display);
  const sso = createSsoManagementCatalogClient(request);
  assert.deepEqual(await sso.list(), { state: 'ready', data: [base] });
  assert.deepEqual(await sso.detail(base.id), { state: 'ready', data: base });
  const proxy = createManagementCatalogClient(request);
  assert.deepEqual(await proxy.list(), { state: 'ready', data: [display] });
  assert.deepEqual(await proxy.detail(base.id), { state: 'ready', data: display });
});
