import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { type ClientErrorCode, createClientErrorResponse } from '../src/gateway/client-errors.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { OpenRouterChatFailure } from '../src/providers/openrouter-chat.ts';

const privateMarker = 'private-content-key-fixture';
const cases = [
  ['not_found', 404, 'Requested endpoint was not found.', 'not_found'],
  ['unauthorized', 401, 'Authentication is required.', 'authentication'],
  ['authentication_unavailable', 503, 'Authentication is temporarily unavailable.', 'server'],
  ['invalid_request', 400, 'Invalid request.', 'invalid_request'],
  ['forbidden', 403, 'Access is denied.', 'permission_denied'],
  ['audit_history_unavailable', 503, 'Audit history is temporarily unavailable.', 'server'],
  ['usage_unavailable', 503, 'Usage data is temporarily unavailable.', 'server'],
  ['catalog_unavailable', 503, 'Model catalog is temporarily unavailable.', 'server'],
  ['route_unavailable', 503, 'Model routing is temporarily unavailable.', 'server'],
  ['unknown_model', 404, 'Requested model was not found.', 'not_found'],
  ['limit_exceeded', 429, 'Request limit exceeded.', 'rate_limit_exceeded'],
  ['credential_unavailable', 503, 'Upstream credentials are temporarily unavailable.', 'server'],
  ['upstream_failed', 502, 'Upstream model request failed.', 'unmapped'],
  ['audit_unavailable', 503, 'Required audit recording is temporarily unavailable.', 'server'],
] as const;
function fixture(code: string) {
  const audits: unknown[] = [];
  const handler = createChatHandler({
    newRequestId: () => 'request',
    authenticate: async () => {
      if (code === 'authentication_unavailable') throw new Error(privateMarker);
      return code === 'unauthorized'
        ? undefined
        : {
            id: 'user',
            active: true,
            credentialId: 'credential',
            policyVersions: [],
            statements:
              code === 'forbidden' ? [] : [{ effect: 'Allow', actions: ['*'], resources: ['*'] }],
          };
    },
    resolveRoute: async () => {
      if (code === 'route_unavailable') throw new Error(privateMarker);
      if (code === 'unknown_model') return undefined;
      const delegated = code === 'credential_unavailable';
      return {
        kind: delegated ? 'delegated' : 'managed',
        version: 'v1',
        credentialRef: 'secret/reference',
        candidates: [
          {
            id: 'candidate',
            kind: delegated ? 'delegated' : 'managed',
            upstreamModelId: 'model',
            providerId: 'provider',
          },
        ],
      };
    },
    listPublishedModels: async () => {
      throw new Error(privateMarker);
    },
    listUsage: async () => {
      throw new Error(privateMarker);
    },
    listAudit: async () => {
      throw new Error(privateMarker);
    },
    checkLimit: async () => code !== 'limit_exceeded',
    resolveSecret: async () => 'fixture',
    resolveVerifiedProviderSlug: async () => 'provider',
    invokeOpenRouter: async () => {
      throw new OpenRouterChatFailure('credential', false, false);
    },
    invokeDirect: async () => {
      if (code === 'upstream_failed') throw new Error(privateMarker);
      return { id: 'completion' };
    },
    writeAudit: async (event) => {
      if (code === 'audit_unavailable') throw new Error(privateMarker);
      audits.push(event);
    },
    writeUsage: async () => {},
  });
  return { handler, audits };
}
for (const [code, status, message, errorType] of cases) {
  test(`${code} has a fixed safe display message`, async () => {
    for (const base of ['/v1', '/api/v1']) {
      const endpoint =
        code === 'not_found'
          ? '/unknown'
          : code === 'catalog_unavailable'
            ? '/models'
            : code === 'audit_history_unavailable'
              ? '/v1/audit'
              : code === 'usage_unavailable'
                ? '/v1/usage'
                : '/chat/completions';
      const path = endpoint.startsWith('/v1/') ? endpoint : base + endpoint;
      const chat = path.endsWith('/chat/completions');
      const f = fixture(code);
      const response = await f.handler(
        new Request(`http://localhost${path}`, {
          method: chat ? 'POST' : 'GET',
          headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
          ...(chat
            ? {
                body: JSON.stringify(
                  code === 'invalid_request'
                    ? { model: privateMarker }
                    : { model: 'chat', messages: [{ role: 'user', content: privateMarker }] },
                ),
              }
            : {}),
        }),
      );
      assert.equal(response.status, status);
      const text = await response.text();
      assert.equal(text.includes(privateMarker), false);
      assert.deepEqual(JSON.parse(text), {
        error: path.startsWith('/api/v1/')
          ? { code: status, message, metadata: { opengranter_code: code, error_type: errorType } }
          : { code, message },
        request_id: 'request',
      });
      assert.equal(response.headers.get('x-request-id'), 'request');
      assert.equal(JSON.stringify(f.audits).includes(privateMarker), false);
    }
  });
}
test('successful completion has no error envelope', async () => {
  const response = await fixture('success').handler(
    new Request('http://localhost/api/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'chat', messages: [{ role: 'user', content: 'fixture' }] }),
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: 'completion' });
});
test('Node pre-header fallback supplies a fixed internal message without exception content', async () => {
  const server = createNodeRequestServer(async () => {
    throw new Error(privateMarker);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    for (const path of ['/v1/models', '/api/v1/models?probe=1', '/api/v10/models']) {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        error: path.startsWith('/api/v1/')
          ? {
              code: 500,
              message: 'Internal server error.',
              metadata: { opengranter_code: 'internal_error', error_type: 'server' },
            }
          : { code: 'internal_error', message: 'Internal server error.' },
      });
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('error format selection does not expand paths and ignores query text', async () => {
  for (const [path, method, status, reason] of [
    ['/api/v1/models?probe=1', 'GET', 400, 'invalid_request'],
    ['/api/v1/models', 'POST', 404, 'not_found'],
    ['/api/v1/usage', 'GET', 404, 'not_found'],
    ['/api/v1/audit', 'GET', 404, 'not_found'],
    ['/api/v10/models', 'GET', 404, 'not_found'],
    ['/api/v1models?path=/api/v1/', 'GET', 404, 'not_found'],
  ] as const) {
    const response = await fixture('success').handler(
      new Request(`http://localhost${path}`, {
        method,
        headers: { authorization: 'Bearer fixture' },
      }),
    );
    assert.equal(response.status, status);
    const data = (await response.json()) as { error: { code: unknown; metadata?: unknown } };
    assert.equal(data.error.code, path.startsWith('/api/v1/') ? status : reason);
    assert.deepEqual(
      data.error.metadata,
      path.startsWith('/api/v1/') ? { opengranter_code: reason, error_type: reason } : undefined,
    );
  }
});

test('public serializer classifies all local reasons without changing legacy envelopes', async () => {
  const complete: readonly (readonly [ClientErrorCode, number, string, string])[] = [
    ...cases,
    ['internal_error', 500, 'Internal server error.', 'server'],
  ];
  for (const [code, status, message, errorType] of complete) {
    for (const format of ['opengranter', 'openrouter'] as const) {
      const response = createClientErrorResponse(status, code, 'request', format);
      assert.equal(response.status, status);
      assert.equal(response.headers.get('x-request-id'), 'request');
      assert.deepEqual(await response.json(), {
        error:
          format === 'openrouter'
            ? { code: status, message, metadata: { opengranter_code: code, error_type: errorType } }
            : { code, message },
        request_id: 'request',
      });
    }
  }
});
