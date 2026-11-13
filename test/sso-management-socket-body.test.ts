import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { createSsoManagementServer } from '../src/gateway/sso-management-http.ts';

for (const payload of [Buffer.alloc(16385, 120), Buffer.from([0xff])]) {
  for (const operation of ['issue', 'revoke'] as const) {
    test(`real socket ${operation} preserves invalid-body rejection (${payload.length} bytes) before upload EOF`, {
      timeout: 5000,
    }, async () => {
      let mutations = 0;
      const server = createSsoManagementServer({
        newRequestId: () => 'socket-request',
        authenticate: async () => 'human',
        issue: async () => {
          mutations++;
          return { credentialId: 'credential', token: 'secret' };
        },
        revoke: async () => {
          mutations++;
          return true;
        },
        writeAudit: async () => {},
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      try {
        const result = await new Promise<{
          status: number | undefined;
          cache: string | undefined;
          connection: string | undefined;
          body: string;
        }>((resolve, reject) => {
          const request = httpRequest(
            {
              host: '127.0.0.1',
              port: address.port,
              path:
                operation === 'issue'
                  ? '/management/v1/proxy-tokens'
                  : '/management/v1/proxy-tokens/revoke',
              method: 'POST',
              headers: {
                authorization: 'Bearer approved',
                'content-type': 'application/json',
                connection: 'keep-alive',
              },
            },
            (response) => {
              let body = '';
              response.setEncoding('utf8');
              response.on('data', (chunk: string) => {
                body += chunk;
              });
              response.on('error', reject);
              response.on('end', () => {
                request.destroy();
                resolve({
                  status: response.statusCode,
                  cache: response.headers['cache-control'],
                  connection: response.headers.connection,
                  body,
                });
              });
            },
          );
          request.on('error', reject);
          request.setTimeout(1000, () =>
            request.destroy(new Error('response unavailable before upload EOF')),
          );
          // Leave the upload open: rejection cannot require EOF or draining.
          request.write(payload);
        });
        assert.equal(result.status, 400);
        assert.equal(result.cache, 'no-store');
        assert.equal(result.connection, 'close');
        assert.deepEqual(JSON.parse(result.body), {
          error: { code: 'invalid_request', message: 'Invalid request.' },
          request_id: 'socket-request',
        });
        assert.equal(mutations, 0);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    });
  }
}

for (const operation of ['issue', 'revoke'] as const) {
  test(`real socket ${operation} preserves authenticated success and exactly one mutation`, async () => {
    const mutations: unknown[] = [];
    const server = createSsoManagementServer({
      newRequestId: () => 'success-request',
      authenticate: async () => 'human',
      issue: async (input) => {
        mutations.push(input);
        return { credentialId: 'credential', token: 'one-time-token' };
      },
      revoke: async (input) => {
        mutations.push(input);
        return true;
      },
      writeAudit: async () => {
        throw new Error('Unexpected authentication denial');
      },
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    try {
      const path =
        operation === 'issue'
          ? '/management/v1/proxy-tokens'
          : '/management/v1/proxy-tokens/revoke';
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method: 'POST',
        headers: { authorization: 'Bearer approved', 'content-type': 'application/json' },
        body: JSON.stringify(
          operation === 'issue'
            ? { principalId: 'target', expiresAt: 1234 }
            : { credentialId: 'credential' },
        ),
      });
      assert.equal(response.status, operation === 'issue' ? 201 : 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(
        await response.json(),
        operation === 'issue'
          ? { credentialId: 'credential', token: 'one-time-token' }
          : { revoked: true },
      );
      assert.deepEqual(mutations, [
        operation === 'issue'
          ? {
              authenticatedActorId: 'human',
              requestId: 'success-request',
              principalId: 'target',
              expiresAt: 1234,
            }
          : {
              authenticatedActorId: 'human',
              requestId: 'success-request',
              credentialId: 'credential',
            },
      ]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}

test('real management socket disconnect still aborts an in-flight body without mutation', {
  timeout: 5000,
}, async () => {
  let mutations = 0;
  let authenticated: () => void = () => {};
  const authenticationStarted = new Promise<void>((resolve) => {
    authenticated = resolve;
  });
  const server = createSsoManagementServer({
    newRequestId: () => 'disconnect-request',
    authenticate: async () => {
      authenticated();
      return 'human';
    },
    issue: async () => {
      mutations++;
      return { credentialId: 'credential', token: 'secret' };
    },
    revoke: async () => {
      mutations++;
      return true;
    },
    writeAudit: async () => {},
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  let socketClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    socketClosed = resolve;
  });
  server.once('connection', (socket) => socket.once('close', socketClosed));
  const request = httpRequest({
    host: '127.0.0.1',
    port: address.port,
    path: '/management/v1/proxy-tokens',
    method: 'POST',
    headers: { authorization: 'Bearer approved', 'content-type': 'application/json' },
  });
  request.on('error', () => {});
  try {
    request.write('{');
    await authenticationStarted;
    request.destroy();
    await closed;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(mutations, 0);
  } finally {
    request.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
