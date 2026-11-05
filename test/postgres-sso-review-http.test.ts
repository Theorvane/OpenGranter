import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresSsoReviewHandler } from '../src/gateway/postgres-sso-review-http.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

test('review rejects unknown routes and all writes before SQL or request-id generation', async () => {
  const jwt = await createSsoAccessTokenFixture();
  let queries = 0;
  let ids = 0;
  const handler = createPostgresSsoReviewHandler({
    ...jwt.config,
    client: {
      query: async () => {
        queries++;
        throw Error('must not query');
      },
    },
    newRequestId: () => {
      ids++;
      return 'review';
    },
  });
  for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
    for (const path of [
      '/management/v1/usage/',
      '/management/v1/usage.csv',
      '/management/v1/usage-extra',
      '/management/v1/models-extra',
      '/management/v1/proxy-tokens',
      '/v1/models',
      '/',
      ...(method === 'GET'
        ? []
        : ['/management/v1/usage', '/management/v1/models', '/management/v1/models/chat']),
    ]) {
      const response = await handler(new Request(`http://localhost${path}`, { method }));
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-request-id'), null);
      assert.doesNotMatch(await response.text(), /must not query|Bearer/);
    }
  }
  assert.equal(queries, 0);
  assert.equal(ids, 0);
});

test('review preserves aborted Request and malformed query for child rejection, never falls through', async () => {
  const jwt = await createSsoAccessTokenFixture();
  let queries = 0;
  let ids = 0;
  const handler = createPostgresSsoReviewHandler({
    ...jwt.config,
    client: {
      query: async () => {
        queries++;
        throw Error('unexpected SQL');
      },
    },
    newRequestId: () => `review-${++ids}`,
  });
  for (const path of [
    '/management/v1/usage',
    '/management/v1/models',
    '/management/v1/models/chat',
  ]) {
    const response = await handler(
      new Request(`http://localhost${path}`, { signal: AbortSignal.abort() }),
    );
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    await response.text();
  }
  const query = await handler(
    new Request('http://localhost/management/v1/models?principal_id=other'),
  );
  assert.equal(query.status, 400);
  await query.text();
  assert.equal(queries, 0);
  assert.equal(ids, 4);
});
