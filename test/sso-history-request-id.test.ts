import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { createPostgresSsoAuditHistoryHandler } from '../src/gateway/postgres-sso-audit-history-http.ts';
import { createPostgresSsoUsageHistoryHandler } from '../src/gateway/postgres-sso-usage-history-http.ts';
import { createSsoAuditHistoryHandler } from '../src/gateway/sso-audit-history-http.ts';
import { createSsoUsageHistoryHandler } from '../src/gateway/sso-usage-history-http.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const invalid: readonly unknown[] = [
  '',
  'a'.repeat(257),
  'private value',
  'private\r\nheader',
  '/private',
  'é',
  'private\u0000value',
  undefined,
  null,
  42,
  {},
];
const factories = [
  ['usage', createSsoUsageHistoryHandler, createPostgresSsoUsageHistoryHandler],
  ['audit', createSsoAuditHistoryHandler, createPostgresSsoAuditHistoryHandler],
] as const;

for (const [kind, factory, composed] of factories) {
  test(`${kind}: invalid generated IDs never reach the history service or response`, async () => {
    let reads = 0;
    const history = {
      read: async () => {
        ++reads;
        return { state: 'unauthenticated' } as const;
      },
    };
    for (const id of invalid) {
      const handler = factory({ history, newRequestId: () => id as string });
      const response = await handler(new Request(`https://management.test/management/v1/${kind}`));
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('x-request-id'), null);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(await response.json(), {
        error: { code: 'internal_error', message: 'Internal server error.' },
      });
    }
    assert.equal(reads, 0);
  });

  test(`${kind}: durable composition rejects invalid IDs before identity/history/audit SQL`, async () => {
    const jwt = await createSsoAccessTokenFixture();
    let queries = 0;
    for (const id of invalid) {
      const handler = composed({
        ...jwt.config,
        client: {
          query: async () => {
            ++queries;
            throw Error('private SQL');
          },
        },
        newRequestId: () => id as string,
      });
      const response = await handler(
        new Request(`https://management.test/management/v1/${kind}`, {
          headers: { authorization: `Bearer ${await jwt.token()}` },
        }),
      );
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('x-request-id'), null);
      assert.deepEqual(await response.json(), {
        error: { code: 'internal_error', message: 'Internal server error.' },
      });
    }
    assert.equal(queries, 0);
  });

  test(`${kind}: valid grammar and maximum length retain audited denial`, async () => {
    for (const id of ['read-1', 'A._+:/@-09', 'a'.repeat(256)]) {
      let reads = 0;
      const handler = factory({
        newRequestId: () => id,
        history: {
          read: async (token, requestId) => {
            ++reads;
            assert.equal(token, '');
            assert.equal(requestId, id);
            return { state: 'unauthenticated' } as const;
          },
        },
      });
      const response = await handler(new Request(`https://management.test/management/v1/${kind}`));
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('x-request-id'), id);
      assert.equal(response.headers.get('www-authenticate'), 'Bearer');
      assert.equal(reads, 1);
    }
  });

  test(`${kind}: loopback Node HTTP returns safe error and never invokes service`, async () => {
    let reads = 0;
    const handler = factory({
      newRequestId: () => 'private value',
      history: {
        read: async () => {
          ++reads;
          return { state: 'unauthenticated' } as const;
        },
      },
    });
    const server = createNodeRequestServer(handler);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const response = await fetch(`http://127.0.0.1:${address.port}/management/v1/${kind}`);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('x-request-id'), null);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(await response.json(), {
        error: { code: 'internal_error', message: 'Internal server error.' },
      });
      assert.equal(reads, 0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}
