import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as nodeRequest } from 'node:http';
import { test } from 'node:test';
import {
  createSsoManagementHandler,
  createSsoManagementServer,
} from '../src/gateway/sso-management-http.ts';
import {
  SsoManagementAuthenticationUnavailable,
  SsoManagementUnauthenticated,
} from '../src/identity/postgres-sso-human-authentication.ts';

type Ports = Parameters<typeof createSsoManagementHandler>[0];
function fixture(patch: Partial<Ports> = {}) {
  const calls: string[] = [];
  const events: unknown[] = [];
  const ports: Ports = {
    newRequestId: () => 'server-me-1',
    authenticate: async (token) => {
      calls.push(token);
      return 'human-current';
    },
    issue: async () => {
      throw new Error('must not issue');
    },
    revoke: async () => {
      throw new Error('must not revoke');
    },
    writeAudit: async (event) => {
      events.push(event);
    },
    ...patch,
  };
  const handler = createSsoManagementHandler(ports);
  return { handler, ports, calls, events };
}
function request(path = '/management/v1/me', init: RequestInit = {}) {
  return new Request(`https://management.invalid${path}`, {
    headers: { authorization: 'Bearer synthetic-access-token', 'x-request-id': 'untrusted' },
    ...init,
  });
}
async function failure(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, code);
  assert.ok(!JSON.stringify(body).includes('synthetic-access-token'));
}

test('GET me projects only the freshly authenticated principal, never grants permissions or sets cookies', async () => {
  let principalId = 'human-first';
  const f = fixture({ authenticate: async () => principalId });
  for (const id of ['human-first', 'human-second']) {
    principalId = id;
    const response = await f.handler(request());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-request-id'), 'server-me-1');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), { principalId: id });
  }
  assert.deepEqual(f.events, []);
});

for (const unavailable of [false, true]) {
  test(`GET me audits ${unavailable ? 'unavailable' : 'denied'} authentication without secrets`, async () => {
    const f = fixture({
      authenticate: async () => {
        throw unavailable
          ? new SsoManagementAuthenticationUnavailable()
          : new SsoManagementUnauthenticated();
      },
    });
    const response = await f.handler(request());
    await failure(
      response,
      unavailable ? 503 : 401,
      unavailable ? 'authentication_unavailable' : 'unauthorized',
    );
    assert.equal(response.headers.get('www-authenticate'), unavailable ? null : 'Bearer');
    assert.deepEqual(f.events, [
      {
        kind: unavailable ? 'management-auth-unavailable' : 'management-auth-denied',
        operation: 'current-principal',
        requestId: 'server-me-1',
      },
    ]);
  });
}

test('GET me fails closed when auth-failure audit is unavailable', async () => {
  const f = fixture({
    writeAudit: async () => {
      throw new Error('synthetic-access-token');
    },
  });
  await failure(await f.handler(request(undefined, { headers: {} })), 503, 'audit_unavailable');
  assert.deepEqual(f.calls, []);
});

test('GET me validates query only after authentication and rejects unsupported methods', async () => {
  const f = fixture();
  await failure(
    await f.handler(request('/management/v1/me?principalId=other')),
    400,
    'invalid_request',
  );
  assert.equal(f.calls.length, 1);
  await failure(
    await f.handler(request(undefined, { method: 'POST', body: '{}' })),
    404,
    'not_found',
  );
  assert.equal(f.calls.length, 1);
});

test('GET me rejects malformed trusted identity and cancellation without reflecting errors', async () => {
  const f = fixture({ authenticate: async () => '' });
  await failure(await f.handler(request()), 503, 'authentication_unavailable');
  const controller = new AbortController();
  controller.abort();
  await failure(
    await fixture().handler(request(undefined, { signal: controller.signal })),
    400,
    'invalid_request',
  );
});

test('GET me rejects a body supplied by an adapter after authenticating', async () => {
  const f = fixture();
  const req = request();
  Object.defineProperty(req, 'body', { value: new ReadableStream() });
  await failure(await f.handler(req), 400, 'invalid_request');
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.events, []);
});

test('GET me missing bearer authenticates nobody and audits before returning 401', async () => {
  const f = fixture();
  await failure(await f.handler(request(undefined, { headers: {} })), 401, 'unauthorized');
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.events, [
    { kind: 'management-auth-denied', operation: 'current-principal', requestId: 'server-me-1' },
  ]);
});

test('GET me authentication precedes query validation', async () => {
  const f = fixture();
  await failure(
    await f.handler(request('/management/v1/me?principalId=other', { headers: {} })),
    401,
    'unauthorized',
  );
  assert.equal(f.events.length, 1);
});

for (const framing of ['length', 'chunked', 'empty'] as const) {
  for (const authenticated of [true, false]) {
    test(`GET me socket ${framing}, authenticated=${authenticated}`, async (t) => {
      const f = fixture();
      const server = createSsoManagementServer(f.ports);
      t.after(
        () =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      );
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const result = await new Promise<{
        status: number | undefined;
        headers: import('node:http').IncomingHttpHeaders;
        body: string;
      }>((resolve, reject) => {
        const req = nodeRequest(
          {
            hostname: '127.0.0.1',
            port: address.port,
            path: '/management/v1/me',
            method: 'GET',
            headers: {
              ...(authenticated ? { authorization: 'Bearer synthetic-access-token' } : {}),
              ...(framing === 'chunked'
                ? { 'transfer-encoding': 'chunked' }
                : { 'content-length': framing === 'empty' ? '0' : '2' }),
            },
          },
          (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => {
              body += chunk;
            });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
            res.on('error', reject);
          },
        );
        req.on('error', reject);
        req.setTimeout(3000, () => req.destroy(new Error('socket test timeout')));
        req.end(framing === 'empty' ? undefined : '{}');
      });
      assert.equal(result.status, authenticated ? (framing === 'empty' ? 200 : 400) : 401);
      assert.equal(result.headers['cache-control'], 'no-store');
      assert.equal(result.headers['x-request-id'], 'server-me-1');
      assert.equal(f.calls.length, authenticated ? 1 : 0);
      assert.equal(f.events.length, authenticated ? 0 : 1);
      if (authenticated && framing === 'empty') {
        assert.deepEqual(JSON.parse(result.body), { principalId: 'human-current' });
      } else {
        assert.equal(
          JSON.parse(result.body).error.code,
          authenticated ? 'invalid_request' : 'unauthorized',
        );
      }
      assert.ok(!result.body.includes('synthetic-access-token'));
    });
  }
}
