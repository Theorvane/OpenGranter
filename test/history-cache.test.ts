import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';

function fixture(mode = 'ok') {
  const state = { reads: 0, audits: 0 };
  const handler = createChatHandler({
    newRequestId: () => 'cache-check',
    authenticate: async () => {
      if (mode === 'auth-error') throw new Error('private auth');
      return {
        id: 'person-1',
        active: true,
        credentialId: 'cred-1',
        policyVersions: [],
        statements:
          mode === 'denied'
            ? []
            : [
                {
                  effect: 'Allow' as const,
                  actions: ['audit:Read', 'usage:ReadSelf'],
                  resources: ['principal:person-1'],
                },
              ],
      };
    },
    resolveRoute: async () => {
      throw new Error('unexpected routing');
    },
    checkLimit: async () => {
      throw new Error('unexpected limits');
    },
    resolveSecret: async () => {
      throw new Error('unexpected secrets');
    },
    writeUsage: async () => {
      throw new Error('unexpected usage write');
    },
    invokeDirect: async () => {
      throw new Error('unexpected inference');
    },
    writeAudit: async () => {
      state.audits++;
      if (mode === 'audit-error') throw new Error('private audit');
    },
    listAudit: async () => {
      state.reads++;
      if (mode === 'storage-error') throw new Error('private storage');
      return { events: [], nextCursor: null };
    },
    listUsage: async () => {
      state.reads++;
      if (mode === 'storage-error') throw new Error('private storage');
      return { records: [], hasMore: false };
    },
  });
  return { handler, state };
}

for (const path of ['/v1/audit', '/v1/usage']) {
  test(`${path} JSON and CSV success prohibit cache storage without changing body or audit`, async () => {
    for (const query of ['', '?format=csv']) {
      const { handler, state } = fixture();
      const response = await handler(
        new Request(`http://localhost${path}${query}`, {
          headers: { authorization: 'Bearer token' },
        }),
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-request-id'), 'cache-check');
      assert.equal(state.reads, 1);
      assert.ok(state.audits > 0);
      if (!query)
        assert.deepEqual(await response.json(), {
          object: 'list',
          data: [],
          has_more: false,
          next_cursor: null,
        });
      else assert.match(response.headers.get('content-type') ?? '', /text\/csv/);
    }
  });

  test(`${path} no-store covers all safe failure paths and unsupported methods`, async () => {
    for (const [mode, query, method, token, status] of [
      ['ok', '', 'GET', '', 401],
      ['auth-error', '', 'GET', 'Bearer token', 503],
      ['denied', '', 'GET', 'Bearer token', 403],
      ['ok', '?unknown=x', 'GET', 'Bearer token', 400],
      ['storage-error', '', 'GET', 'Bearer token', 503],
      ['audit-error', '', 'GET', 'Bearer token', 503],
      ['ok', '', 'POST', 'Bearer token', 404],
    ] as const) {
      const { handler, state } = fixture(mode);
      const response = await handler(
        new Request(`http://localhost${path}${query}`, {
          method,
          headers: { authorization: token },
        }),
      );
      assert.equal(response.status, status, mode);
      assert.equal(response.headers.get('cache-control'), 'no-store', mode);
      assert.equal((await response.text()).includes('private'), false);
      if (status === 401 || status === 403 || status === 400 || status === 404)
        assert.equal(state.reads, 0);
    }
  });
}

test('real HTTP history responses and unexpected transport fallbacks cannot opt into caching', async () => {
  for (const mode of ['normal', 'throw', 'custom'] as const) {
    const server = createNodeRequestServer(
      mode === 'normal'
        ? fixture().handler
        : async () => {
            throw new Error('private exception');
          },
      mode === 'custom'
        ? () =>
            new Response('safe fallback', {
              status: 503,
              headers: { 'cache-control': 'public, max-age=3600' },
            })
        : undefined,
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      for (const path of ['/v1/audit', '/v1/usage']) {
        const response = await fetch(`${origin}${path}?limit=1`, {
          headers: { authorization: 'Bearer token' },
        });
        assert.equal(response.status, mode === 'normal' ? 200 : mode === 'custom' ? 503 : 500);
        assert.equal(response.headers.get('cache-control'), 'no-store', `${mode} ${path}`);
        assert.equal((await response.text()).includes('private'), false);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
});

test('transport does not invent history aliases or change unrelated caching policies', async () => {
  const server = createNodeRequestServer(
    async () => new Response('unrelated', { headers: { 'cache-control': 'private, max-age=5' } }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const path of ['/api/v1/audit', '/api/v1/usage', '/v1/chat/completions', '/v1/audit/']) {
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`,
      );
      assert.equal(response.headers.get('cache-control'), 'private, max-age=5');
      await response.text();
    }
    assert.equal(
      (await fixture().handler(new Request('http://localhost/api/v1/audit'))).status,
      404,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
