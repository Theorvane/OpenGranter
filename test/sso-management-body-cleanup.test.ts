import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSsoManagementHandler } from '../src/gateway/sso-management-http.ts';

const paths = ['/management/v1/proxy-tokens', '/management/v1/proxy-tokens/revoke'];
for (const path of paths) {
  for (const mode of ['oversize', 'abort'] as const) {
    test(`${path} ${mode} does not await producer cancellation`, async () => {
      const calls: string[] = [];
      const handler = createSsoManagementHandler({
        newRequestId: () => 'cleanup-request',
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
      let started!: () => void;
      const reading = new Promise<void>((resolve) => {
        started = resolve;
      });
      let cancellations = 0;
      const abort = new AbortController();
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            started();
            if (mode === 'oversize') controller.enqueue(new Uint8Array(16385));
          },
          cancel() {
            cancellations++;
            return new Promise<void>(() => {});
          },
        },
        { highWaterMark: 0 },
      );
      const request = new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
        body,
        signal: abort.signal,
        duplex: 'half',
      } as RequestInit);
      const response = handler(request);
      await reading;
      if (mode === 'abort') abort.abort();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          response,
          new Promise<undefined>((resolve) => {
            timer = setTimeout(() => resolve(undefined), 250);
          }),
        ]);
        assert.ok(result, 'invalid input response must not await untrusted cancellation cleanup');
        assert.equal(result.status, 400);
        assert.equal(result.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await result.json(), {
          error: { code: 'invalid_request', message: 'Invalid request.' },
          request_id: 'cleanup-request',
        });
        assert.equal(cancellations, 1);
        assert.equal(body.locked, false);
        assert.deepEqual(calls, ['authenticate']);
      } finally {
        clearTimeout(timer);
      }
    });
  }
}
