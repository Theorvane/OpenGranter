import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createPostgresSsoReviewBrowserServer } from '../src/gateway/postgres-sso-review-browser-http.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

test('public same-origin review assets neither authenticate nor query SQL; private routes still audit authentication', async () => {
  const jwt = await createSsoAccessTokenFixture();
  let queries = 0;
  let ids = 0;
  const javascript = 'export const publicReview = true;';
  const server = createPostgresSsoReviewBrowserServer({
    ...jwt.config,
    client: {
      query: async () => {
        queries++;
        throw Error('private database failure');
      },
    },
    newRequestId: () => `static-review-${++ids}`,
    javascript,
  });
  assert.equal(server.listening, false);
  assert.equal(server.address(), null);
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;
    for (const path of ['/management', '/management/', '/management/app.js']) {
      const response = await fetch(origin + path, { headers: { cookie: 'session=not-authority' } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.match(response.headers.get('content-security-policy') ?? '', /connect-src 'self'/);
      const text = await response.text();
      if (path.endsWith('.js')) assert.equal(text, javascript);
      else assert.match(text, /src="\/management\/app.js"/);
      assert.equal(queries, 0);
      assert.equal(ids, 0);
    }
    for (const path of ['/management?next=private', '/management/app.js?token=private']) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 400);
      assert.doesNotMatch(await response.text(), /private/);
    }
    for (const path of ['/management/v1/models', '/management/v1/usage']) {
      const before = queries;
      const response = await fetch(origin + path, { headers: { cookie: 'session=not-authority' } });
      // Anonymous auth must be durably audited; broken audit is fail-closed, not public data.
      assert.equal(response.status, 503);
      assert.ok(queries > before);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.doesNotMatch(await response.text(), /private database failure|publicReview/);
    }
    for (const path of ['/management/no-fallback', '/management/v1/proxy-tokens', '/v1/models']) {
      const before = queries;
      const response = await fetch(origin + path);
      assert.equal(response.status, 404);
      assert.equal(queries, before);
      assert.doesNotMatch(await response.text(), /publicReview|id="app"/);
    }
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
