import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as nodeRequest } from 'node:http';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import {
  createSsoManagementHandler,
  createSsoManagementServer,
} from '../src/gateway/sso-management-http.ts';

for (const operation of ['issue', 'revoke'] as const) {
  const payload = JSON.stringify(
    operation === 'issue'
      ? { principalId: 'target', expiresAt: 10000 }
      : { credentialId: 'credential' },
  );
  const path =
    operation === 'issue' ? '/management/v1/proxy-tokens' : '/management/v1/proxy-tokens/revoke';
  function fixture(
    body: ReadableStream<Uint8Array>,
    patch: Partial<Parameters<typeof createSsoManagementHandler>[0]> = {},
  ) {
    const calls: string[] = [];
    const abort = new AbortController();
    const request = new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { authorization: 'Bearer sso', 'content-type': 'application/json' },
      body,
      duplex: 'half',
      signal: abort.signal,
    } as RequestInit);
    const handler = createSsoManagementHandler({
      newRequestId: () => 'deadline-id',
      authenticate: async () => {
        calls.push('authenticate');
        return 'human';
      },
      issue: async () => {
        calls.push('issue');
        return { credentialId: 'credential', token: 'one-time' };
      },
      revoke: async () => {
        calls.push('revoke');
        return true;
      },
      writeAudit: async () => {
        calls.push('audit');
      },
      ...patch,
    });
    return { calls, abort, request, handler };
  }
  for (const cleanup of ['settle', 'reject', 'stall'] as const) {
    test(`${operation} bounds stalled reads independently of ${cleanup} cleanup`, async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      let cancelled = 0;
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          cancelled++;
          if (cleanup === 'reject') return Promise.reject(Error('private-cleanup'));
          if (cleanup === 'stall') return new Promise<void>(() => {});
        },
      });
      const f = fixture(body);
      let response: Response | undefined;
      const pending = f.handler(f.request).then((value) => {
        response = value;
      });
      try {
        await nextTurn();
        t.mock.timers.tick(14999);
        await nextTurn();
        assert.equal(Boolean(response), false);
        t.mock.timers.tick(1);
        await nextTurn();
        assert.ok(response, 'deadline must settle without awaiting producer cleanup');
        assert.equal(response.status, 400);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await response.json(), {
          error: { code: 'invalid_request', message: 'Invalid request.' },
          request_id: 'deadline-id',
        });
        assert.deepEqual(f.calls, ['authenticate']);
        assert.equal(cancelled, 1);
        await pending;
      } finally {
        f.abort.abort();
        await nextTurn();
      }
    });
  }
  test(`${operation} trickle does not renew whole read budget`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const f = fixture(
      new ReadableStream({
        start(value) {
          controller = value;
        },
      }),
    );
    let response: Response | undefined;
    const pending = f.handler(f.request).then((value) => {
      response = value;
    });
    try {
      await nextTurn();
      t.mock.timers.tick(10000);
      controller.enqueue(new TextEncoder().encode(payload.slice(0, 4)));
      await nextTurn();
      t.mock.timers.tick(5000);
      await nextTurn();
      assert.equal(response?.status, 400);
      assert.deepEqual(f.calls, ['authenticate']);
      await pending;
    } finally {
      f.abort.abort();
      await nextTurn();
    }
  });
  test(`${operation} late valid EOF cannot dispatch when timer is delayed`, async (t) => {
    let now = 0;
    t.mock.method(performance, 'now', () => now);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const f = fixture(
      new ReadableStream({
        start(value) {
          controller = value;
        },
      }),
    );
    const pending = f.handler(f.request);
    await nextTurn();
    controller.enqueue(new TextEncoder().encode(payload));
    await nextTurn();
    now = 15000;
    controller.close();
    const response = await pending;
    assert.equal(response.status, 400);
    assert.deepEqual(f.calls, ['authenticate']);
  });
  test(`${operation} successful read releases deadline before mutation completion`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    });
    const f = fixture(body);
    const response = await f.handler(f.request);
    t.mock.timers.tick(30000);
    assert.equal(response.status, operation === 'issue' ? 201 : 200);
    assert.deepEqual(f.calls, ['authenticate', operation]);
    assert.equal(body.locked, false);
  });
  test(`${operation} abort settles even when reader cancellation cannot settle a read`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture(new ReadableStream());
    let cancels = 0;
    let releases = 0;
    Object.defineProperty(f.request, 'body', {
      value: {
        getReader: () => ({
          read: () => new Promise(() => {}),
          cancel: () => {
            cancels++;
            return new Promise(() => {});
          },
          releaseLock: () => {
            releases++;
          },
        }),
      },
    });
    let response: Response | undefined;
    const pending = f.handler(f.request).then((value) => {
      response = value;
    });
    await nextTurn();
    f.abort.abort();
    await nextTurn();
    assert.equal(response?.status, 400);
    assert.equal(cancels, 1);
    assert.equal(releases, 1);
    assert.deepEqual(f.calls, ['authenticate']);
    await pending;
  });
  test(`${operation} read deadline cannot time out an already dispatched mutation`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let dispatched = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    });
    const f = fixture(body, {
      issue: async () => {
        dispatched = true;
        await gate;
        return { credentialId: 'credential', token: 'one-time' };
      },
      revoke: async () => {
        dispatched = true;
        await gate;
        return true;
      },
    });
    let response: Response | undefined;
    const pending = f.handler(f.request).then((value) => {
      response = value;
    });
    await nextTurn();
    assert.equal(dispatched, true);
    t.mock.timers.tick(30000);
    await nextTurn();
    assert.equal(Boolean(response), false);
    finish();
    await pending;
    assert.equal(response?.status, operation === 'issue' ? 201 : 200);
  });
}

test('real sockets reject incomplete issue and revoke uploads before mutation', {
  timeout: 22000,
}, async () => {
  const calls: string[] = [];
  const server = createSsoManagementServer({
    newRequestId: () => 'socket-deadline',
    authenticate: async () => 'human',
    issue: async () => {
      calls.push('issue');
      return { credentialId: 'credential', token: 'one-time' };
    },
    revoke: async () => {
      calls.push('revoke');
      return true;
    },
    writeAudit: async () => {
      calls.push('audit');
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const clients = ['/management/v1/proxy-tokens', '/management/v1/proxy-tokens/revoke'].map(
    (path) =>
      nodeRequest({
        hostname: '127.0.0.1',
        port: address.port,
        path,
        method: 'POST',
        headers: { authorization: 'Bearer sso', 'content-type': 'application/json' },
      }),
  );
  try {
    await Promise.all(
      clients.map(async (client) => {
        const responseReady = once(client, 'response');
        client.write('{');
        const [response] = await responseReady;
        let text = '';
        for await (const chunk of response) text += chunk;
        assert.equal(response.statusCode, 400);
        assert.equal(response.headers['cache-control'], 'no-store');
        assert.equal(response.headers.connection, 'close');
        assert.equal(JSON.parse(text).error.code, 'invalid_request');
        assert.equal(text.includes('one-time'), false);
      }),
    );
    assert.deepEqual(calls, []);
  } finally {
    for (const client of clients) client.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
