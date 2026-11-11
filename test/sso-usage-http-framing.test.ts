import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import {
  createSsoUsageHistoryHandler,
  type SsoUsageHistoryHttpPorts,
} from '../src/gateway/sso-usage-history-http.ts';

function fixture() {
  let calls = 0;
  let state: 'ready' | 'unauthenticated' | 'forbidden' | 'audit_unavailable' = 'ready';
  const history: SsoUsageHistoryHttpPorts['history'] = {
    async read(
      _token,
      _requestId,
      search,
    ): Promise<import('../src/gateway/postgres-sso-usage-history.ts').SsoUsageResult> {
      calls++;
      if (state !== 'ready') return { state };
      return search.includes('csv')
        ? { state: 'ready', format: 'csv', csv: 'attempt_id\r\n', hasMore: false, nextCursor: null }
        : { state: 'ready', format: 'json', data: [], hasMore: false, nextCursor: null };
    },
  };
  return {
    handle: createSsoUsageHistoryHandler({ history, newRequestId: () => 'server-framing' }),
    calls: () => calls,
    setState(value: typeof state) {
      state = value;
    },
  };
}
function get(headers: Record<string, string>, format = 'json') {
  return new Request(`http://localhost/management/v1/usage?format=${format}`, {
    headers: { authorization: 'Bearer test-opaque-value', ...headers },
  });
}
async function invalid(response: Response) {
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('content-disposition'), null);
  assert.equal(response.headers.get('x-next-cursor'), null);
  const body = await response.text();
  assert.match(body, /invalid_request/u);
  assert.doesNotMatch(body, /test-opaque-value|attempt_id|has_more/u);
}
for (const format of ['json', 'csv']) {
  for (const headers of [
    { 'content-length': '1' },
    { 'content-length': '00' },
    { 'transfer-encoding': 'chunked' },
    { 'transfer-encoding': 'identity', 'content-length': '0' },
  ]) {
    test(`usage ${format} rejects framing ${JSON.stringify(headers)} before service`, async () => {
      const f = fixture();
      await invalid(await f.handle(get(headers, format)));
      assert.equal(f.calls(), 0);
    });
  }
}
test('bodyless and exact zero-length usage JSON/CSV preserve ordinary service outcomes', async () => {
  const f = fixture();
  for (const format of ['json', 'csv']) {
    for (const headers of [{}, { 'content-length': '0' }]) {
      const response = await f.handle(get(headers, format));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(
        response.headers.get('content-type') ?? '',
        format === 'csv' ? /text\/csv/u : /application\/json/u,
      );
      await response.text();
    }
  }
  for (const [state, status] of [
    ['unauthenticated', 401],
    ['forbidden', 403],
    ['audit_unavailable', 503],
  ] as const) {
    f.setState(state);
    const response = await f.handle(get({}));
    assert.equal(response.status, status);
    await response.text();
  }
  assert.equal(f.calls(), 7);
});
test('framed usage is rejected even without bearer; unsupported path and method stay private', async () => {
  const f = fixture();
  await invalid(
    await f.handle(
      new Request('http://localhost/management/v1/usage', { headers: { 'content-length': '1' } }),
    ),
  );
  assert.equal(
    (
      await f.handle(
        new Request('http://localhost/management/v1/usage/', {
          headers: { 'content-length': '1' },
        }),
      )
    ).status,
    404,
  );
  await invalid(
    await f.handle(
      new Request('http://localhost/management/v1/usage', {
        method: 'POST',
        body: 'private-input',
      }),
    ),
  );
  assert.equal(f.calls(), 0);
});
test('real Node socket rejects fixed-length and chunked GET bodies that Fetch cannot represent', async () => {
  const f = fixture();
  const server = createNodeRequestServer(f.handle);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  async function send(headers: Record<string, string>, body?: string) {
    return new Promise<{
      status: number;
      headers: import('node:http').IncomingHttpHeaders;
      text: string;
    }>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/management/v1/usage?format=csv',
          method: 'GET',
          agent: false,
          headers: { authorization: 'Bearer test-opaque-value', ...headers },
        },
        (response) => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            text += chunk;
          });
          response.on('end', () =>
            resolve({ status: response.statusCode ?? 0, headers: response.headers, text }),
          );
          response.on('error', reject);
        },
      );
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error('test socket timeout')));
      req.end(body);
    });
  }
  try {
    for (const headers of [{ 'content-length': '7' }, { 'transfer-encoding': 'chunked' }]) {
      const response = await send(headers, 'private');
      assert.equal(response.status, 400);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      assert.equal(response.headers['content-disposition'], undefined);
      assert.doesNotMatch(response.text, /private|test-opaque-value|attempt_id/u);
      assert.equal(f.calls(), 0);
    }
    for (const headers of [{}, { 'content-length': '0' }]) {
      assert.equal((await send(headers)).status, 200);
    }
    assert.equal(f.calls(), 2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
