import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { createSsoManagementServer } from '../src/gateway/sso-management-http.ts';

test('real issue and revoke sockets reject unfinished JSON uploads at the body deadline', {
  timeout: 35000,
}, async () => {
  let mutations = 0;
  const server = createSsoManagementServer({
    newRequestId: () => 'upload-deadline',
    authenticate: async () => 'human',
    issue: async () => {
      mutations++;
      return { credentialId: 'id', token: 'private' };
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
    await Promise.all(
      ['', '/revoke'].map(
        (suffix) =>
          new Promise<void>((resolve, reject) => {
            const start = performance.now();
            const request = httpRequest(
              {
                host: '127.0.0.1',
                port: address.port,
                path: `/management/v1/proxy-tokens${suffix}`,
                method: 'POST',
                headers: {
                  authorization: 'Bearer fixture',
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
                  try {
                    assert.ok(performance.now() - start >= 29500);
                    assert.equal(response.statusCode, 400);
                    assert.equal(response.headers['cache-control'], 'no-store');
                    assert.equal(response.headers.connection, 'close');
                    assert.deepEqual(JSON.parse(body), {
                      error: { code: 'invalid_request', message: 'Invalid request.' },
                      request_id: 'upload-deadline',
                    });
                    resolve();
                  } catch (error) {
                    reject(error);
                  } finally {
                    request.destroy();
                  }
                });
              },
            );
            request.on('error', reject);
            request.setTimeout(33000, () =>
              request.destroy(new Error('body deadline did not release socket')),
            );
            request.write('{'); // Never finish upload: no EOF and no complete JSON.
          }),
      ),
    );
    assert.equal(mutations, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
