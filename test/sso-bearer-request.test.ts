import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogRequest, CatalogRequestInit } from '../src/management/catalog-client.ts';
import { createSsoManagementRequest } from '../src/management/sso-bearer-request.ts';

const init = { method: 'GET', cache: 'no-store' } as const;
function fixture() {
  let time = 100;
  const calls: { path: string; init: CatalogRequestInit }[] = [];
  let operation: CatalogRequest = async () => Response.json({ ok: true });
  const transport = createSsoManagementRequest({
    accessToken: 'synthetic.access.token',
    expiresAt: 200,
    now: () => time,
    request: async (path, value) => {
      calls.push({ path, init: value });
      return operation(path, value);
    },
  });
  return {
    transport,
    calls,
    time(value: number) {
      time = value;
    },
    operation(value: CatalogRequest) {
      operation = value;
    },
  };
}

test('approved canonical reads and writes attach only the explicit bearer and hardened fetch controls', async () => {
  const f = fixture();
  for (const path of [
    '/management/v1/principal',
    '/management/v1/me',
    '/management/v1/models',
    '/management/v1/models/vendor%2Fmodel',
    '/management/v1/usage?limit=1',
    '/management/v1/audit?format=csv',
  ]) {
    await f.transport.request(path, {
      ...init,
      credentials: 'include',
      redirect: 'follow',
      mode: 'cors',
      headers: { accept: 'application/json' },
    });
  }
  for (const path of ['/management/v1/proxy-tokens', '/management/v1/proxy-tokens/revoke']) {
    await f.transport.request(path, {
      ...init,
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
  }
  assert.equal(f.calls.length, 8);
  for (const call of f.calls) {
    assert.equal(
      new Headers(call.init.headers).get('authorization'),
      'Bearer synthetic.access.token',
    );
    assert.equal(call.init.credentials, 'omit');
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.mode, 'same-origin');
    assert.equal(call.init.cache, 'no-store');
  }
  f.transport.dispose();
});

test('credential destination and method allowlist rejects before transport', async () => {
  const f = fixture();
  for (const path of [
    'https://evil.test/management/v1/principal',
    '//evil.test/management/v1/principal',
    '/api/v1/models',
    '/management/app.js',
    '/management/v1/models/../principal',
    '/management/v1/models/%2e%2e',
    '/management/v1/models/a/b',
    '/management/v1/models/a#secret',
    '/management/v1/principal#x',
    '/management/v1/proxy-tokens',
  ]) {
    await assert.rejects(f.transport.request(path, init));
  }
  for (const method of ['PUT', 'DELETE', 'PATCH', 'HEAD', 'post'])
    await assert.rejects(f.transport.request('/management/v1/principal', { ...init, method }));
  await assert.rejects(
    f.transport.request('/management/v1/proxy-tokens?x=1', { ...init, method: 'POST', body: '{}' }),
  );
  await assert.rejects(
    f.transport.request('/management/v1/principal', { ...init, body: 'secret' }),
  );
  assert.equal(f.calls.length, 0);
});

test('ambient or alternate authentication headers are never forwarded', async () => {
  const f = fixture();
  for (const name of ['authorization', 'cookie', 'proxy-authorization', 'x-api-key', 'host']) {
    await assert.rejects(
      f.transport.request('/management/v1/principal', {
        ...init,
        headers: { [name]: 'untrusted' },
      }),
    );
  }
  assert.equal(f.calls.length, 0);
});

test('expiry and invalid clock fail closed; disposal stops retained request handles', async () => {
  for (const now of [200, Number.NaN, -1]) {
    const f = fixture();
    f.time(now);
    await assert.rejects(f.transport.request('/management/v1/principal', init));
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  const retained = f.transport.request;
  f.transport.dispose();
  f.transport.dispose();
  await assert.rejects(retained('/management/v1/principal', init));
  assert.equal(f.calls.length, 0);
});

test('disposal aborts in-flight native transport and drops late response body', async () => {
  const f = fixture();
  let complete!: (response: Response) => void;
  let cancelled = false;
  f.operation(
    async () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  );
  const pending = f.transport.request('/management/v1/principal', init);
  f.transport.dispose();
  assert.equal(f.calls[0]?.init.signal?.aborted, true);
  complete(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
    ),
  );
  await assert.rejects(pending);
  assert.equal(cancelled, true);
});

test('caller cancellation and fresh server denials remain distinct from local authentication', async () => {
  const f = fixture();
  const signal = new AbortController();
  signal.abort();
  await assert.rejects(
    f.transport.request('/management/v1/principal', { ...init, signal: signal.signal }),
  );
  assert.equal(f.calls.length, 0);
  for (const status of [401, 403, 503]) {
    f.operation(async () => new Response(null, { status }));
    assert.equal((await f.transport.request('/management/v1/principal', init)).status, status);
  }
  f.operation(async () => {
    throw new Error('private diagnostics synthetic.access.token');
  });
  await assert.rejects(
    f.transport.request('/management/v1/principal', init),
    (error: unknown) =>
      error instanceof Error && error.message === 'Management transport unavailable',
  );
});

test('malformed supplied credentials and lifetime are rejected without diagnostic reflection', () => {
  for (const accessToken of ['', 'contains space', 'line\r\nbreak', 'Bearer token']) {
    assert.throws(
      () =>
        createSsoManagementRequest({
          accessToken,
          expiresAt: 200,
          now: () => 100,
          request: async () => new Response(),
        }),
      /^Error: Management transport unavailable$/,
    );
  }
  for (const expiresAt of [NaN, Infinity, -1, 1.5, 100]) {
    assert.throws(() =>
      createSsoManagementRequest({
        accessToken: 'synthetic.token',
        expiresAt,
        now: () => 100,
        request: async () => new Response(),
      }),
    );
  }
});
