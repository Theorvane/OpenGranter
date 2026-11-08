import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { createSsoManagementServer } from '../src/gateway/sso-management-http.ts';
import { createManagementTokenClient as sourceClient } from '../src/management/token-management-client.ts';

const javascript = await buildManagementBrowser({
  root: process.cwd(),
  entry: 'src/management/token-management-client.ts',
});
const built = (await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
)) as { createManagementTokenClient: typeof sourceClient };
for (const [label, createManagementTokenClient] of [
  ['source: ', sourceClient],
  ['supported artifact: ', built.createManagementTokenClient],
] as const) {
  const input = { principalId: 'human', expiresAt: 10000 };
  function json(body: unknown, status = 201) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }
  test(`${label}issue and revoke through actual loopback SSO HTTP with synthetic trusted authority`, async () => {
    const operations: unknown[] = [];
    const server = createSsoManagementServer({
      newRequestId: () => 'server-id',
      authenticate: async (token) => {
        assert.equal(token, 'test-authority');
        return 'bound-human';
      },
      issue: async (operation) => {
        operations.push(operation);
        return { credentialId: 'credential', token: 'one-time-test-value' };
      },
      revoke: async (operation) => {
        operations.push(operation);
        return false;
      },
      writeAudit: async () => {},
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const client = createManagementTokenClient((path, init) => {
      assert.equal(init.cache, 'no-store');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'error');
      assert.equal(init.method, 'POST');
      return fetch(`http://127.0.0.1:${address.port}${path}`, {
        ...init,
        headers: { ...init.headers, authorization: 'Bearer test-authority' },
      });
    });
    try {
      assert.deepEqual(await client.issue(input), {
        state: 'issued',
        credentialId: 'credential',
        token: 'one-time-test-value',
      });
      assert.deepEqual(await client.revoke({ credentialId: 'credential' }), {
        state: 'revoked',
        revoked: false,
      });
      assert.equal(operations.length, 2);
      assert.equal(
        (operations[0] as { authenticatedActorId: string }).authenticatedActorId,
        'bound-human',
      );
    } finally {
      client.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  test(`${label}invalid exact inputs never dispatch; mutation input is snapshotted`, async () => {
    const sent: string[] = [];
    const client = createManagementTokenClient(async (_path, init) => {
      sent.push(String(init.body));
      return json({ credentialId: 'c', token: 't', private: 'excluded' });
    });
    for (const value of [
      null,
      {},
      { ...input, actorId: 'bypass' },
      { ...input, principalId: '' },
      { ...input, principalId: 'x\0' },
      { ...input, principalId: String.fromCharCode(0xd800) },
      { ...input, expiresAt: NaN },
      { ...input, expiresAt: -1 },
    ]) {
      assert.deepEqual(await client.issue(value as typeof input), { state: 'invalid_input' });
    }
    assert.deepEqual(
      await client.revoke({ credentialId: '', actorId: 'x' } as { credentialId: string }),
      { state: 'invalid_input' },
    );
    assert.equal(sent.length, 0);
    const mutable = { ...input };
    const pending = client.issue(mutable);
    mutable.principalId = 'changed';
    assert.deepEqual(await pending, { state: 'issued', credentialId: 'c', token: 't' });
    assert.equal(sent[0], JSON.stringify(input));
  });
  test(`${label}double submission never dispatches twice and lost response never retries`, async () => {
    let calls = 0;
    let release!: (response: Response) => void;
    const client = createManagementTokenClient(() => {
      calls++;
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const pending = client.issue(input);
    assert.deepEqual(await client.issue(input), { state: 'busy' });
    assert.deepEqual(await client.revoke({ credentialId: 'c' }), { state: 'busy' });
    release(json({ credentialId: 'c', token: 't' }));
    assert.equal((await pending).state, 'issued');
    assert.equal(calls, 1);
    const lost = createManagementTokenClient(async () => {
      calls++;
      throw Error('private transport');
    });
    assert.deepEqual(await lost.issue(input), { state: 'outcome_unknown' });
    assert.equal(calls, 2);
    assert.deepEqual(await lost.issue(input), { state: 'reconciliation_required' });
    assert.deepEqual(await lost.revoke({ credentialId: 'c' }), {
      state: 'reconciliation_required',
    });
    assert.equal(calls, 2);
  });
  test(`${label}dispose settles uncooperative mutation and suppresses late secret`, async () => {
    let release!: (response: Response) => void;
    let signal: AbortSignal | null | undefined;
    const client = createManagementTokenClient((_path, init) => {
      signal = init.signal;
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const pending = client.issue(input);
    client.dispose();
    assert.deepEqual(await pending, { state: 'outcome_unknown' });
    assert.equal(signal?.aborted, true);
    release(json({ credentialId: 'c', token: 'late-private' }));
    assert.deepEqual(await client.issue(input), { state: 'disposed' });
  });
  test(`${label}safe explicit errors versus uncertain outcomes; private errors never reflected`, async () => {
    for (const [status, state] of [
      [400, 'invalid_request'],
      [401, 'unauthenticated'],
      [403, 'denied'],
      [404, 'outcome_unknown'],
      [503, 'outcome_unknown'],
    ] as const) {
      const client = createManagementTokenClient(
        async () => new Response('private-server-error', { status }),
      );
      assert.deepEqual(await client.issue(input), { state });
    }
    for (const response of [
      json({ credentialId: 'c' }),
      json({ credentialId: 'c', token: '' }),
      json({ credentialId: 'c', token: String.fromCharCode(0xd800) }),
      json({ credentialId: 'c', token: 't'.repeat(16385) }),
      json({ credentialId: 'c', token: 't' }, 200),
      new Response('{bad', { status: 201, headers: { 'content-type': 'application/json' } }),
      json({ credentialId: 'c', token: 't'.repeat(70000) }),
      new Response('x', { status: 201, headers: { 'content-type': 'text/html' } }),
    ]) {
      assert.deepEqual(await createManagementTokenClient(async () => response).issue(input), {
        state: 'outcome_unknown',
      });
    }
  });
  test(`${label}oversized stream cancellation and stalled body disposal settle safely`, async () => {
    let cancelled = false;
    const client = createManagementTokenClient(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(65537));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
    );
    assert.deepEqual(await client.issue(input), { state: 'outcome_unknown' });
    assert.equal(cancelled, true);
    const stalled = createManagementTokenClient(
      async () =>
        new Response(new ReadableStream({ start() {} }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const pending = stalled.issue(input);
    await new Promise((resolve) => setTimeout(resolve, 10));
    stalled.dispose();
    assert.deepEqual(await pending, { state: 'outcome_unknown' });
  });

  test(`${label}deadline settles uncooperative dispatch without retry`, async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0;
    const client = createManagementTokenClient(() => {
      calls++;
      return new Promise(() => {});
    });
    const pending = client.issue(input);
    context.mock.timers.tick(30000);
    assert.deepEqual(await pending, { state: 'outcome_unknown' });
    assert.equal(calls, 1);
    client.dispose();
  });
}
