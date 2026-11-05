import assert from 'node:assert/strict';
import { once } from 'node:events';
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

test('source-only review server stays unbound and rejects unsupported and framed HTTP before SQL', async () => {
  const { request: httpRequest } = await import('node:http');
  const { createPostgresSsoReviewServer } = await import(
    '../src/gateway/postgres-sso-review-http.ts'
  );
  const jwt = await createSsoAccessTokenFixture();
  let queries = 0;
  let ids = 0;
  const server = createPostgresSsoReviewServer({
    ...jwt.config,
    client: {
      query: async () => {
        queries++;
        throw Error('private SQL must not run');
      },
    },
    newRequestId: () => `review-${++ids}`,
  });
  assert.equal(server.listening, false);
  assert.equal(server.address(), null);
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;
    for (const path of [
      '/management/v1/usage/',
      '/management/v1/usage.csv',
      '/v1/models',
      '/management/v1/proxy-tokens',
    ]) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.doesNotMatch(await response.text(), /private SQL|Bearer/);
    }
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD']) {
      for (const path of ['/management/v1/models', '/management/v1/usage']) {
        const response = await fetch(origin + path, { method });
        assert.equal(response.status, 404);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        await response.text();
      }
    }
    assert.equal(ids, 0);
    for (const path of [
      '/management/v1/models',
      '/management/v1/models/chat',
      '/management/v1/usage',
    ]) {
      for (const headers of [{ 'content-length': '1' }, { 'transfer-encoding': 'chunked' }]) {
        const result = await new Promise<{
          status: number | undefined;
          cache: string | undefined;
          body: string;
        }>((resolve, reject) => {
          const request = httpRequest(origin + path, { method: 'GET', headers }, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (part: string) => {
              body += part;
            });
            response.once('error', reject);
            response.once('end', () =>
              resolve({
                status: response.statusCode,
                cache: response.headers['cache-control'],
                body,
              }),
            );
          });
          request.once('error', reject);
          request.end('x');
        });
        assert.equal(result.status, 400);
        assert.equal(result.cache, 'no-store');
        assert.doesNotMatch(result.body, /private SQL|Bearer/);
      }
    }

    const fallback = await new Promise<{
      status: number | undefined;
      cache: string | undefined;
      nosniff: string | string[] | undefined;
      body: string;
    }>((resolve, reject) => {
      // Node accepts TRACE, while the Fetch Request constructor rejects it.
      // Exercise the production bridge's fixed management fallback, not SQL.
      const request = httpRequest(
        `${origin}/management/v1/usage`,
        { method: 'TRACE' },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (part: string) => {
            body += part;
          });
          response.once('error', reject);
          response.once('end', () =>
            resolve({
              status: response.statusCode,
              cache: response.headers['cache-control'],
              nosniff: response.headers['x-content-type-options'],
              body,
            }),
          );
        },
      );
      request.once('error', reject);
      request.end();
    });
    assert.equal(fallback.status, 503);
    assert.equal(fallback.cache, 'no-store');
    assert.equal(fallback.nosniff, 'nosniff');
    assert.doesNotMatch(fallback.body, /TRACE|private SQL|Bearer|stack/);
    assert.match(fallback.body, /internal_error/);
    assert.equal(ids, 6);
    assert.equal(queries, 0);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
