import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CatalogRequest } from '../src/management/catalog-client.ts';
import { issueManagementToken } from '../src/management/token-issue-client.ts';
import { revokeManagementToken } from '../src/management/token-revoke-client.ts';

const clients = [
  {
    name: 'issuance',
    call: (request: CatalogRequest, signal?: AbortSignal) =>
      issueManagementToken(request, 'human', 1234, signal),
    status: 201,
    body: { credentialId: 'fixture-id', token: 'synthetic-display-only' },
  },
  {
    name: 'revocation',
    call: (request: CatalogRequest, signal?: AbortSignal) =>
      revokeManagementToken(request, 'fixture-id', signal),
    status: 200,
    body: { revoked: true },
  },
];
const flush = async () => {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
};

for (const client of clients) {
  test(`${client.name}: stalled request becomes uncertain at deadline without retry`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0;
    let signal: AbortSignal | null | undefined;
    let state = 'pending';
    const result = client
      .call(async (_path, init) => {
        calls++;
        signal = init.signal;
        return new Promise(() => {});
      })
      .then((value) => {
        state = value.state;
        return value;
      });
    await flush();
    t.mock.timers.tick(9999);
    await flush();
    assert.equal(state, 'pending');
    t.mock.timers.tick(1);
    await flush();
    assert.equal(state, 'uncertain');
    assert.equal(signal?.aborted, true);
    assert.equal(calls, 1);
    assert.deepEqual(await result, { state: 'uncertain' });
  });

  test(`${client.name}: stalled body is cancelled at deadline`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let cancelled = 0;
    let state = 'pending';
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled++;
      },
    });
    const result = client
      .call(
        async () =>
          new Response(body, {
            status: client.status,
            headers: { 'content-type': 'application/json' },
          }),
      )
      .then((value) => {
        state = value.state;
        return value;
      });
    await flush();
    t.mock.timers.tick(10000);
    await flush();
    assert.equal(state, 'uncertain');
    assert.equal(cancelled, 1);
    assert.deepEqual(await result, { state: 'uncertain' });
  });

  test(`${client.name}: caller cancellation settles despite abort-ignoring port`, async () => {
    const controller = new AbortController();
    let state = 'pending';
    let signal: AbortSignal | null | undefined;
    const result = client
      .call(async (_path, init) => {
        signal = init.signal;
        return new Promise(() => {});
      }, controller.signal)
      .then((value) => {
        state = value.state;
        return value;
      });
    await flush();
    controller.abort();
    await flush();
    assert.equal(state, 'cancelled');
    assert.equal(signal?.aborted, true);
    assert.deepEqual(await result, { state: 'cancelled' });
  });

  test(`${client.name}: late response cannot publish success and its body is cancelled`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let resolve!: (response: Response) => void;
    let cancelled = 0;
    let state = 'pending';
    const result = client
      .call(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .then((value) => {
        state = value.state;
        return value;
      });
    await flush();
    t.mock.timers.tick(10000);
    await flush();
    assert.equal(state, 'uncertain');
    resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled++;
          },
        }),
        { status: client.status, headers: { 'content-type': 'application/json' } },
      ),
    );
    await flush();
    assert.equal(cancelled, 1);
    assert.deepEqual(await result, { state: 'uncertain' });
  });

  test(`${client.name}: completed success removes lifetime timer and caller listener`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const controller = new AbortController();
    let requestSignal: AbortSignal | null | undefined;
    let aborts = 0;
    const result = await client.call(async (_path, init) => {
      requestSignal = init.signal;
      requestSignal?.addEventListener('abort', () => {
        aborts++;
      });
      return Response.json(client.body, { status: client.status });
    }, controller.signal);
    assert.equal(result.state, 'ready');
    t.mock.timers.tick(20000);
    controller.abort();
    await flush();
    assert.equal(aborts, 0);
    assert.equal(requestSignal?.aborted, false);
  });

  for (const status of [401, 403])
    test(`${client.name}: fresh ${status} retains terminal auth state`, async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      assert.deepEqual(await client.call(async () => new Response(null, { status })), {
        state: status === 401 ? 'unauthenticated' : 'denied',
      });
    });
}

for (const client of clients) {
  test(`${client.name}: cancellation during stalled body is prompt and cancels body`, async () => {
    const controller = new AbortController();
    let cancelled = 0;
    let state = 'pending';
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled++;
      },
    });
    const result = client
      .call(
        async () =>
          new Response(body, {
            status: client.status,
            headers: { 'content-type': 'application/json' },
          }),
        controller.signal,
      )
      .then((value) => {
        state = value.state;
        return value;
      });
    await flush();
    controller.abort();
    await flush();
    assert.equal(state, 'cancelled');
    assert.equal(cancelled, 1);
    assert.deepEqual(await result, { state: 'cancelled' });
  });

  test(`${client.name}: pre-cancelled caller never invokes request`, async () => {
    let calls = 0;
    const controller = new AbortController();
    controller.abort();
    assert.deepEqual(
      await client.call(async () => {
        calls++;
        throw new Error('must not request');
      }, controller.signal),
      { state: 'cancelled' },
    );
    assert.equal(calls, 0);
  });

  test(`${client.name}: timeout does not await uncooperative body cancellation`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let cancelled = 0;
    let state = 'pending';
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled++;
        return new Promise(() => {});
      },
    });
    const result = client
      .call(
        async () =>
          new Response(body, {
            status: client.status,
            headers: { 'content-type': 'application/json' },
          }),
      )
      .then((value) => {
        state = value.state;
        return value;
      });
    await flush();
    t.mock.timers.tick(10000);
    await flush();
    assert.equal(state, 'uncertain');
    assert.equal(cancelled, 1);
    assert.deepEqual(await result, { state: 'uncertain' });
  });

  test(`${client.name}: late transport rejection is consumed without changing timeout`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let reject!: (reason: Error) => void;
    let state = 'pending';
    const result = client
      .call(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail;
          }),
      )
      .then((value) => {
        state = value.state;
        return value;
      });
    await flush();
    t.mock.timers.tick(10000);
    await flush();
    assert.equal(state, 'uncertain');
    reject(new Error('synthetic private error must not be published'));
    await flush();
    assert.deepEqual(await result, { state: 'uncertain' });
  });
}

for (const client of clients) {
  test(`${client.name}: arriving body chunks cannot extend the whole-operation deadline`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let cancellations = 0;
    let calls = 0;
    let state = 'pending';
    const result = client
      .call(async () => {
        calls++;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              stream = controller;
            },
            cancel() {
              cancellations++;
            },
          }),
          { status: client.status, headers: { 'content-type': 'application/json' } },
        );
      })
      .then((value) => {
        state = value.state;
        return value;
      });
    await flush();
    const encoder = new TextEncoder();
    for (let second = 0; second < 9; second++) {
      t.mock.timers.tick(1000);
      stream.enqueue(encoder.encode(' '));
      await flush();
      assert.equal(state, 'pending');
    }
    t.mock.timers.tick(1000);
    await flush();
    assert.equal(state, 'uncertain');
    assert.equal(cancellations, 1);
    assert.equal(calls, 1);
    assert.deepEqual(await result, { state: 'uncertain' });
  });
}
