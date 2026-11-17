import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogRequest } from '../src/management/catalog-client.ts';
import { issueManagementToken } from '../src/management/token-issue-client.ts';
import { revokeManagementToken } from '../src/management/token-revoke-client.ts';

const encode = (text: string) => new TextEncoder().encode(text);
const cases = [
  {
    name: 'issue',
    status: 201,
    limit: 131072,
    text: JSON.stringify({ credentialId: '계정😀', token: 'synthetic-only' }),
    run: (request: CatalogRequest, signal?: AbortSignal) =>
      issueManagementToken(request, 'owner', 2000000000000, signal),
    ready: { state: 'ready', credentialId: '계정😀', token: 'synthetic-only' },
  },
  {
    name: 'revoke',
    status: 200,
    limit: 4096,
    text: JSON.stringify({ revoked: true }),
    run: (request: CatalogRequest, signal?: AbortSignal) =>
      revokeManagementToken(request, 'credential', signal),
    ready: { state: 'ready', revoked: true },
  },
] as const;

for (const scenario of cases) {
  const size = encode(scenario.text).byteLength;
  const response = (length?: string, encoding?: string) => {
    const headers = new Headers({ 'content-type': 'application/json' });
    if (length !== undefined) headers.set('content-length', length);
    if (encoding !== undefined) headers.set('content-encoding', encoding);
    return new Response(scenario.text, { status: scenario.status, headers });
  };
  test(`${scenario.name}: inconsistent complete-looking JSON is uncertain and never retried`, async () => {
    for (const length of ['0', String(size - 1), String(size + 1)]) {
      let calls = 0;
      assert.deepEqual(
        await scenario.run(async () => {
          calls++;
          return response(length);
        }),
        { state: 'uncertain' },
      );
      assert.equal(calls, 1);
    }
  });
  test(`${scenario.name}: malformed, unsafe and oversized declarations are uncertain`, async () => {
    for (const length of [
      '',
      '-1',
      '+1',
      '1.5',
      '1e2',
      '1,1',
      'NaN',
      '9'.repeat(100),
      String(scenario.limit + 1),
    ]) {
      assert.deepEqual(await scenario.run(async () => response(length)), { state: 'uncertain' });
    }
  });
  test(`${scenario.name}: exact byte length, absent length and decoded compressed bodies remain valid`, async () => {
    for (const [length, encoding] of [
      [undefined, undefined],
      [String(size), undefined],
      [`000${size}`, ' IDENTITY '],
      ['1', 'gzip'],
      ['1', 'br'],
    ]) {
      assert.deepEqual(await scenario.run(async () => response(length, encoding)), scenario.ready);
    }
  });
  test(`${scenario.name}: reject oversized declaration before reading stalled producer`, async () => {
    let pulls = 0;
    let cancels = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulls++;
          return new Promise(() => {});
        },
        cancel() {
          cancels++;
          return new Promise(() => {});
        },
      },
      { highWaterMark: 0 },
    );
    const controller = new AbortController();
    const result = scenario.run(
      async () =>
        new Response(body, {
          status: scenario.status,
          headers: {
            'content-type': 'application/json',
            'content-length': String(scenario.limit + 1),
          },
        }),
      controller.signal,
    );
    await new Promise((resolve) => setImmediate(resolve));
    if (pulls) controller.abort();
    assert.deepEqual(await result, { state: 'uncertain' });
    assert.equal(pulls, 0);
    assert.equal(cancels, 1);
  });
  test(`${scenario.name}: declared overflow cancels without waiting for producer EOF`, async () => {
    let cancels = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          controller.enqueue(encode(scenario.text));
        },
        cancel() {
          cancels++;
        },
      },
      { highWaterMark: 0 },
    );
    const controller = new AbortController();
    const result = scenario.run(
      async () =>
        new Response(body, {
          status: scenario.status,
          headers: { 'content-type': 'application/json', 'content-length': String(size - 1) },
        }),
      controller.signal,
    );
    await new Promise((resolve) => setImmediate(resolve));
    if (!cancels) controller.abort();
    assert.deepEqual(await result, { state: 'uncertain' });
    assert.equal(cancels, 1);
  });
  test(`${scenario.name}: malformed UTF-8 and decoded cap cannot yield success`, async () => {
    for (const bytes of [new Uint8Array([0xff]), encode(' '.repeat(scenario.limit + 1))]) {
      assert.deepEqual(
        await scenario.run(
          async () =>
            new Response(bytes, {
              status: scenario.status,
              headers: {
                'content-type': 'application/json',
                'content-encoding': 'gzip',
                'content-length': '1',
              },
            }),
        ),
        { state: 'uncertain' },
      );
    }
  });
  test(`${scenario.name}: status denial and cancellation retain safe states`, async () => {
    for (const [status, state] of [
      [401, 'unauthenticated'],
      [403, 'denied'],
    ] as const) {
      assert.deepEqual(
        await scenario.run(
          async () =>
            new Response('private error', {
              status,
              headers: { 'content-length': 'invalid' },
            }),
        ),
        { state },
      );
    }
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    assert.deepEqual(
      await scenario.run(async () => {
        calls++;
        return response();
      }, controller.signal),
      { state: 'cancelled' },
    );
    assert.equal(calls, 0);
  });
}
