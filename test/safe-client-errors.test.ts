import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { OpenRouterChatFailure } from '../src/providers/openrouter-chat.ts';

const privateMarker = 'private-content-key-fixture';
const cases = [
  ['not_found', 404, 'Requested endpoint was not found.'],
  ['unauthorized', 401, 'Authentication is required.'],
  ['authentication_unavailable', 503, 'Authentication is temporarily unavailable.'],
  ['invalid_request', 400, 'Invalid request.'],
  ['forbidden', 403, 'Access is denied.'],
  ['audit_history_unavailable', 503, 'Audit history is temporarily unavailable.'],
  ['usage_unavailable', 503, 'Usage data is temporarily unavailable.'],
  ['catalog_unavailable', 503, 'Model catalog is temporarily unavailable.'],
  ['route_unavailable', 503, 'Model routing is temporarily unavailable.'],
  ['unknown_model', 404, 'Requested model was not found.'],
  ['limit_exceeded', 429, 'Request limit exceeded.'],
  ['credential_unavailable', 503, 'Upstream credentials are temporarily unavailable.'],
  ['upstream_failed', 502, 'Upstream model request failed.'],
  ['audit_unavailable', 503, 'Required audit recording is temporarily unavailable.'],
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
for (const [code, status, message] of cases) {
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
      assert.deepEqual(JSON.parse(text), { error: { code, message }, request_id: 'request' });
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
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/models`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: { code: 'internal_error', message: 'Internal server error.' },
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
