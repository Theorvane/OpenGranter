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
    assert.deepEqual(await proxy.list(), { state: 'unavailable' }, JSON.stringify(id));
  }
});

test('SSO integrates the approved publication without retaining private metadata', async () => {
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
  assert.deepEqual(await sso.list(), {
    state: 'ready',
    data: [display],
  });
  assert.deepEqual(await sso.detail(base.id), {
    state: 'ready',
    data: display,
  });
  const proxy = createManagementCatalogClient(request);
  assert.deepEqual(await proxy.list(), { state: 'ready', data: [display] });
  assert.deepEqual(await proxy.detail(base.id), { state: 'ready', data: display });
});

test('SSO provider publication preserves omission/null/zero and strips private nested fields', async () => {
  const base = { id: 'team/chat', object: 'model', created: 0, owned_by: 'opengranter' };
  for (const bounds of [
    {},
    { context_length: null },
    { max_completion_tokens: 0 },
    { context_length: 128000, max_completion_tokens: 8192 },
    { context_length: 0, max_completion_tokens: null },
  ]) {
    const row = {
      ...base,
      top_provider: { ...bounds, is_moderated: true, secret: 'private' },
      secret: 'private',
    };
    const client = createSsoManagementCatalogClient(async (path) =>
      Response.json(path.endsWith('/models') ? { data: [row] } : row),
    );
    const list = await client.list();
    assert.deepEqual(list, { state: 'ready', data: [{ ...base, top_provider: bounds }] });
    assert.deepEqual(await client.detail(base.id), {
      state: 'ready',
      data: { ...base, top_provider: bounds },
    });
    assert.doesNotMatch(JSON.stringify(list), /private|is_moderated|secret/u);
    if (list.state === 'ready') {
      assert.ok(list.data[0]);
      assert.equal(Object.isFrozen(Reflect.get(list.data[0], 'top_provider')), true);
    }
  }
  const legacy = createSsoManagementCatalogClient(async () => Response.json(base));
  assert.deepEqual(await legacy.detail(base.id), { state: 'ready', data: base });
});

test('SSO malformed provider bounds fail complete lists and detail without changing proxy projection', async () => {
  const base = { id: 'team/chat', object: 'model', created: 0, owned_by: 'opengranter' };
  for (const top_provider of [
    null,
    [],
    'private',
    0,
    { context_length: -1 },
    { context_length: 0.1 },
    { context_length: Number.MAX_SAFE_INTEGER + 1 },
    { max_completion_tokens: '12' },
    { max_completion_tokens: true },
    { max_completion_tokens: -1 },
    { max_completion_tokens: [] },
  ]) {
    const row = { ...base, top_provider };
    const client = createSsoManagementCatalogClient(async (path) =>
      Response.json(
        path.endsWith('/models') ? { data: [{ ...base, id: 'other/model' }, row] } : row,
      ),
    );
    assert.deepEqual(await client.list(), { state: 'unavailable' }, JSON.stringify(top_provider));
    assert.deepEqual(await client.detail(base.id), { state: 'unavailable' });
    const proxy = createManagementCatalogClient(async () => Response.json(row));
    assert.deepEqual(await proxy.detail(base.id), { state: 'ready', data: base });
  }
});
