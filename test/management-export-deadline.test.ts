import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { exportFilteredAuditCsv } from '../src/management/audit-export.ts';
import type { CatalogRequest } from '../src/management/catalog-client.ts';
import { exportFilteredUsageCsv } from '../src/management/usage-export.ts';

for (const kind of ['usage', 'audit'] as const) {
  const run = (request: CatalogRequest, signal: AbortSignal, maxDurationMs?: number) =>
    kind === 'usage'
      ? exportFilteredUsageCsv(
          request,
          {},
          { signal, ...(maxDurationMs === undefined ? {} : { maxDurationMs }) },
        )
      : exportFilteredAuditCsv(
          request,
          'human',
          {},
          { signal, ...(maxDurationMs === undefined ? {} : { maxDurationMs }) },
        );
  const page = (
    more = false,
    body: NonNullable<ConstructorParameters<typeof Response>[0]> = '"request_id"\r\n"r1"\r\n',
  ) =>
    new Response(body, {
      headers: {
        'content-type': 'text/csv',
        [`x-${kind}-has-more`]: String(more),
        ...(more ? { [`x-${kind}-next-cursor`]: '20' } : {}),
      },
    });

  test(`${kind}: whole deadline ends an uncooperative request without partial CSV`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let signal: AbortSignal | undefined;
    const pending = run(
      async (_path, init) => {
        signal = init.signal as AbortSignal;
        return new Promise<Response>(() => {});
      },
      new AbortController().signal,
      4000,
    );
    t.mock.timers.tick(4000);
    assert.deepEqual(await pending, { state: 'unavailable' });
    assert.equal(signal?.aborted, true);
  });

  test(`${kind}: pagination does not reset deadline and late completion stays discarded`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0;
    let release: ((value: Response) => void) | undefined;
    const pending = run(
      async () => {
        calls++;
        if (calls === 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, 3000));
          return page(true);
        }
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      },
      new AbortController().signal,
      4000,
    );
    t.mock.timers.tick(3000);
    await setImmediate();
    assert.equal(calls, 2);
    t.mock.timers.tick(1000);
    assert.deepEqual(await pending, { state: 'unavailable' });
    release?.(page());
    await setImmediate();
    assert.equal(calls, 2);
  });

  test(`${kind}: stalled CSV body is cancelled at whole deadline`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let cancelled = false;
    const pending = run(
      async () =>
        page(
          false,
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('"request_id"\r\n'));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
      new AbortController().signal,
      4000,
    );
    await setImmediate();
    t.mock.timers.tick(4000);
    assert.deepEqual(await pending, { state: 'unavailable' });
    assert.equal(cancelled, true);
  });

  test(`${kind}: caller abort wins and invalid durations never invoke transport`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0;
    const request: CatalogRequest = async () => {
      calls++;
      return new Promise<Response>(() => {});
    };
    for (const invalid of [0, -1, 1.5, NaN, Infinity, 120001]) {
      assert.deepEqual(await run(request, new AbortController().signal, invalid), {
        state: 'invalid_query',
      });
    }
    assert.equal(calls, 0);
    const controller = new AbortController();
    const pending = run(request, controller.signal, 4000);
    controller.abort();
    t.mock.timers.tick(4000);
    assert.deepEqual(await pending, { state: 'cancelled' });
  });

  test(`${kind}: default and maximum deadlines permit a complete export`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    for (const duration of [undefined, 120000]) {
      const result = await run(async () => page(), new AbortController().signal, duration);
      assert.equal(result.state, 'ready');
      t.mock.timers.tick(120000);
      assert.equal(result.state, 'ready');
    }
  });
}
