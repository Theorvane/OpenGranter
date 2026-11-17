import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as turn } from 'node:timers/promises';
import { createSsoManagementHandler } from '../src/gateway/sso-management-http.ts';

for (const operation of ['issue', 'revoke'] as const) {
  for (const progress of [false, true]) {
    test(`${operation} body deadline does not renew on progress (${progress})`, async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const calls: string[] = [];
      let source!: ReadableStreamDefaultController<Uint8Array>;
      let cancellations = 0;
      const body = new ReadableStream<Uint8Array>(
        {
          start(controller) {
            source = controller;
          },
          cancel() {
            cancellations++;
            return new Promise<void>(() => {});
          },
        },
        { highWaterMark: 0 },
      );
      const handler = createSsoManagementHandler({
        newRequestId: () => 'deadline-request',
        authenticate: async () => {
          calls.push('authenticate');
          return 'human';
        },
        issue: async () => {
          calls.push('issue');
          return { credentialId: 'id', token: 'private' };
        },
        revoke: async () => {
          calls.push('revoke');
          return true;
        },
        writeAudit: async () => {
          calls.push('audit');
        },
      });
      const result = handler(
        new Request(
          `http://localhost/management/v1/proxy-tokens${operation === 'revoke' ? '/revoke' : ''}`,
          {
            method: 'POST',
            headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
            body,
            duplex: 'half',
          } as RequestInit,
        ),
      );
      await turn();
      let settled = false;
      void result.then(() => {
        settled = true;
      });
      t.mock.timers.tick(29999);
      if (progress) source.enqueue(new TextEncoder().encode('{'));
      await turn();
      assert.equal(settled, false);
      t.mock.timers.tick(1);
      await turn();
      assert.equal(
        settled,
        true,
        'unfinished authenticated body must not hold mutation request beyond 30s',
      );
      const response = await result;
      assert.equal(response.status, 400);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), {
        error: { code: 'invalid_request', message: 'Invalid request.' },
        request_id: 'deadline-request',
      });
      assert.equal(cancellations, 1);
      assert.equal(body.locked, false);
      assert.throws(() => source.enqueue(new TextEncoder().encode('{}')));
      assert.deepEqual(calls, ['authenticate']);
    });
  }
}

for (const operation of ['issue', 'revoke'] as const) {
  test(`${operation} complete JSON cancels the upload timer before a slow mutation`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let release!: () => void;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writing = new Promise<void>((resolve) => {
      started = resolve;
    });
    let cancellations = 0;
    const bytes = new TextEncoder().encode(
      JSON.stringify(
        operation === 'issue'
          ? { principalId: 'target', expiresAt: 10000 }
          : { credentialId: 'id' },
      ),
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
      cancel() {
        cancellations++;
      },
    });
    const handler = createSsoManagementHandler({
      newRequestId: () => 'complete-request',
      authenticate: async () => 'human',
      issue: async () => {
        started();
        await pending;
        return { credentialId: 'id', token: 'private' };
      },
      revoke: async () => {
        started();
        await pending;
        return true;
      },
      writeAudit: async () => {},
    });
    const result = handler(
      new Request(
        `http://localhost/management/v1/proxy-tokens${operation === 'revoke' ? '/revoke' : ''}`,
        {
          method: 'POST',
          headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
          body,
          duplex: 'half',
        } as RequestInit,
      ),
    );
    await writing;
    t.mock.timers.tick(60000);
    release();
    const response = await result;
    assert.equal(response.status, operation === 'issue' ? 201 : 200);
    assert.equal(cancellations, 0);
    assert.equal(body.locked, false);
    await response.json();
  });
}
