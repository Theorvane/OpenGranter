import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';

const encoder = new TextEncoder();
const prefix = encoder.encode('{"model":"chat","messages":[{"role":"user","content":"');
const suffix = encoder.encode('"}]}');

function setup(
  chunks: Uint8Array[],
  options: { auditFails?: boolean; cancelFails?: boolean } = {},
) {
  const calls: string[] = [];
  const audits: unknown[] = [];
  let received: unknown;
  let cancelled = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (!options.cancelFails) controller.close();
      else closeTimer = setTimeout(() => controller.close(), 50);
    },
    cancel() {
      cancelled = true;
      clearTimeout(closeTimer);
      if (options.cancelFails) throw new Error('private-body-error');
    },
  });
  const handler = createChatHandler({
    newRequestId: () => 'utf8-request',
    authenticate: async () => ({
      id: 'user',
      active: true,
      credentialId: 'credential',
      policyVersions: [],
      statements: [{ effect: 'Allow', actions: ['llm:*'], resources: ['*'] }],
    }),
    resolveRoute: async () => {
      calls.push('route');
      return {
        version: 'v1',
        candidates: [
          { id: 'candidate', kind: 'managed', upstreamModelId: 'gpt', providerId: 'openai' },
        ],
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
    writeUsage: async () => {
      calls.push('usage');
    },
    writeAudit: async (event) => {
      audits.push(event);
      if (options.auditFails) throw new Error('private-audit-error');
    },
    invokeDirect: async (_candidate, request) => {
      calls.push('inference');
      received = request;
      return { id: 'completion' };
    },
  });
  const request = new Request('http://localhost/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' },
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  return {
    run: () => handler(request),
    calls,
    audits,
    received: () => received,
    cancelled: () => cancelled,
    body,
  };
}

for (const [name, chunks] of [
  ['invalid byte in message', [prefix, Uint8Array.of(0xff), suffix]],
  ['truncated trailing sequence', [prefix, suffix, Uint8Array.of(0xe2, 0x82)]],
] as const) {
  test(`rejects ${name} before downstream work`, async () => {
    const fixture = setup([...chunks]);
    const response = await fixture.run();
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: { code: 'invalid_request', message: 'Invalid request.' },
      request_id: 'utf8-request',
    });
    assert.deepEqual(fixture.calls, []);
    assert.equal(JSON.stringify(fixture.audits).includes('invalid-request'), true);
    assert.equal(JSON.stringify(fixture.audits).includes('content'), false);
    assert.equal(fixture.body.locked, false);
  });
}

test('cancels unread malformed input even when cancellation fails', async () => {
  const fixture = setup([prefix, Uint8Array.of(0xff)], { cancelFails: true });
  const response = await fixture.run();
  assert.equal(response.status, 400);
  assert.equal(fixture.cancelled(), true);
  assert.equal(fixture.body.locked, false);
  assert.deepEqual(fixture.calls, []);
  assert.equal((await response.text()).includes('private'), false);
});

test('malformed input retains mandatory denial-audit failure response', async () => {
  const fixture = setup([prefix, Uint8Array.of(0xff), suffix], { auditFails: true });
  const response = await fixture.run();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'audit_unavailable',
      message: 'Required audit recording is temporarily unavailable.',
    },
    request_id: 'utf8-request',
  });
  assert.deepEqual(fixture.calls, []);
});

for (const text of ['한😀', '\uFFFD']) {
  test(`preserves valid split Unicode ${text}`, async () => {
    const bytes = encoder.encode(text);
    const fixture = setup([prefix, ...Array.from(bytes, (byte) => Uint8Array.of(byte)), suffix]);
    const response = await fixture.run();
    assert.equal(response.status, 200);
    assert.deepEqual(fixture.received(), {
      model: 'chat',
      messages: [{ role: 'user', content: text }],
    });
    assert.equal(fixture.calls.includes('inference'), true);
    assert.equal(fixture.body.locked, false);
  });
}
