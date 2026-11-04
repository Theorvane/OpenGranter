import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import {
  createManagementBrowserHandler,
  createManagementBrowserServer,
} from '../src/management/browser-http.ts';

const javascript = 'document.getElementById("app").textContent = "Sign in required";';
const application = async () =>
  new Response('api-denied', { status: 401, headers: { 'www-authenticate': 'Bearer' } });

test('shell and module expose only explicit public assets with restrictive headers', async () => {
  const handle = createManagementBrowserHandler({ javascript, application });
  for (const path of ['/management', '/management/', '/management/app.js']) {
    const response = await handle(new Request(`https://example.test${path}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    const csp = response.headers.get('content-security-policy') ?? '';
    for (const rule of [
      "default-src 'none'",
      "script-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'none'",
      "base-uri 'none'",
    ])
      assert.ok(csp.includes(rule));
    assert.ok(!csp.includes('unsafe-inline') && !csp.includes('unsafe-eval'));
    const body = await response.text();
    if (path.endsWith('.js')) {
      assert.equal(body, javascript);
      assert.match(response.headers.get('content-type') ?? '', /javascript/);
    } else {
      assert.match(body, /id="app"/);
      assert.match(body, /type="module" src="\/management\/app.js"/);
      assert.ok(!body.includes(javascript));
    }
    const head = await handle(new Request(`https://example.test${path}`, { method: 'HEAD' }));
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  }
});

test('static routes reject queries, framing and methods without touching application', async () => {
  let calls = 0;
  const handle = createManagementBrowserHandler({
    javascript,
    application: async () => {
      calls++;
      return new Response();
    },
  });
  for (const path of ['/management', '/management/', '/management/app.js']) {
    assert.equal(
      (await handle(new Request(`https://example.test${path}?token=private`))).status,
      400,
    );
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
      const response = await handle(new Request(`https://example.test${path}`, { method }));
      assert.equal(response.status, 405);
      assert.equal(response.headers.get('allow'), 'GET, HEAD');
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    for (const headers of [{ 'content-length': '1' }, { 'transfer-encoding': 'chunked' }])
      assert.equal(
        (await handle(new Request(`https://example.test${path}`, { headers }))).status,
        400,
      );
    assert.equal(
      (
        await handle(
          new Request(`https://example.test${path}`, { headers: { 'content-length': '0' } }),
        )
      ).status,
      200,
    );
  }
  assert.equal(calls, 0);
});

test('non-static API requests and responses are delegated unchanged, never HTML fallback', async () => {
  for (const path of [
    '/management/v1/me',
    '/api/v1/models',
    '/api/v1/models/vendor%2Fmodel',
    '/management/unknown',
    '/management/app.js.map',
    '/',
  ]) {
    const request = new Request(`https://example.test${path}`, {
      headers: { authorization: 'Bearer test-only' },
    });
    const response = new Response('denied', {
      status: 403,
      headers: { 'cache-control': 'no-store' },
    });
    const handle = createManagementBrowserHandler({
      javascript,
      application: async (input) => {
        assert.equal(input, request);
        return response;
      },
    });
    assert.equal(await handle(request), response);
  }
});

test('real localhost serves shell/module, empty HEAD and preserves API denial', async (t) => {
  const server = createManagementBrowserServer({ javascript, application });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  assert.match(await (await fetch(`${origin}/management`)).text(), /id="app"/);
  assert.equal(await (await fetch(`${origin}/management/app.js`)).text(), javascript);
  const head = await fetch(`${origin}/management`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const api = await fetch(`${origin}/management/v1/me`);
  assert.equal(api.status, 401);
  assert.equal(api.headers.get('www-authenticate'), 'Bearer');
  assert.equal(await api.text(), 'api-denied');
  for (const headers of [{ 'Content-Length': '1' }, { 'Transfer-Encoding': 'chunked' }]) {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(`${origin}/management`, { headers, method: 'GET' }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      req.on('error', reject);
      req.end('x');
    });
    assert.equal(status, 400);
  }
});
