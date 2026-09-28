import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';

function setup(options: { auditFails?: boolean; authenticated?: boolean } = {}) {
  const calls: string[] = [];
  const audit: unknown[] = [];
  const handler = createChatHandler({
    newRequestId: () => 'media-request',
    authenticate: async () =>
      options.authenticated === false
        ? undefined
        : {
            id: 'user',
            active: true,
            credentialId: 'credential',
            policyVersions: [],
            statements: [{ effect: 'Allow', actions: ['llm:*'], resources: ['*'] }],
          },
    resolveRoute: async () => {
      calls.push('route');
      return {
        version: 'v1',
        candidates: [{ id: 'one', kind: 'managed', upstreamModelId: 'gpt', providerId: 'openai' }],
      };
    },
    checkLimit: async () => {
      calls.push('limit');
      return true;
    },
    resolveSecret: async () => {
      calls.push('secret');
      return 'fixture-key';
    },
    invokeDirect: async () => {
      calls.push('inference');
      return { id: 'completion' };
    },
    writeUsage: async () => {
      calls.push('usage');
    },
    writeAudit: async (event) => {
      audit.push(event);
      if (options.auditFails) throw new Error('private-audit-error');
    },
  });
  return {
    calls,
    audit,
    run: (type: string | undefined) =>
      handler(
        new Request('http://localhost/v1/chat/completions', {
          method: 'POST',
          headers: {
            authorization: 'Bearer fixture-token',
            ...(type === undefined ? {} : { 'content-type': type }),
          },
          body: new TextEncoder().encode(
            JSON.stringify({
              model: 'chat',
              messages: [{ role: 'user', content: 'private-prompt' }],
            }),
          ),
        }),
      ),
  };
}

for (const type of [
  'application/jsonp',
  'application/json-seq',
  'application/json+custom',
  'application/json, text/plain',
  'text/plain',
  undefined,
]) {
  test(`rejects unsupported media type ${type ?? 'missing'}`, async () => {
    const fixture = setup();
    const response = await fixture.run(type);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: { code: 'invalid_request' },
      request_id: 'media-request',
    });
    assert.deepEqual(fixture.calls, []);
    assert.equal(JSON.stringify(fixture.audit).includes('invalid-request'), true);
    assert.equal(JSON.stringify(fixture.audit).includes('private-prompt'), false);
  });
}

for (const type of [
  'application/json',
  'APPLICATION/JSON',
  'application/json; charset=utf-8',
  ' application/json ; charset=utf-8 ',
]) {
  test(`accepts supported media type ${type}`, async () => {
    const fixture = setup();
    const response = await fixture.run(type);
    assert.equal(response.status, 200);
    assert.equal(fixture.calls.includes('inference'), true);
  });
}

test('unsupported type retains mandatory denial-audit failure response', async () => {
  const fixture = setup({ auditFails: true });
  const response = await fixture.run('application/jsonp');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: { code: 'audit_unavailable' },
    request_id: 'media-request',
  });
  assert.deepEqual(fixture.calls, []);
});

test('authentication precedes unsupported media type validation', async () => {
  const fixture = setup({ authenticated: false });
  const response = await fixture.run('application/jsonp');
  assert.equal(response.status, 401);
  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(fixture.audit, [{ kind: 'auth-denied', requestId: 'media-request' }]);
});
