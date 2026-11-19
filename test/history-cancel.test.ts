import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuditReview } from '../src/management/audit-review.ts';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import { createUsageReview } from '../src/management/usage-review.ts';
import { Element, nodes, tick } from './account-token-dom-fixture.ts';

for (const [kind, create] of [
  ['usage', createUsageReview],
  ['audit', createAuditReview],
] as const) {
  test(`${kind}: cancel JSON suppresses late page and retries applied scope`, async () => {
    const calls: {
      path: string;
      signal: AbortSignal | null | undefined;
      resolve: (r: Response) => void;
    }[] = [];
    const review = create(
      (path, init) =>
        new Promise<Response>((resolve) => calls.push({ path, signal: init.signal, resolve })),
    );
    const pending = review.load({ principalId: 'human', model: 'chat', limit: 1 });
    assert.equal(review.snapshot().state, 'loading');
    review.cancel();
    assert.ok(calls[0]);
    assert.equal(calls[0].signal?.aborted, true);
    assert.equal(review.snapshot().state, 'cancelled');
    assert.deepEqual(review.snapshot().data, []);
    assert.equal(review.snapshot().canNext, false);
    assert.ok(calls[0]);
    calls[0].resolve(
      Response.json({ object: 'list', data: [], has_more: false, next_cursor: null }),
    );
    await pending;
    assert.equal(review.snapshot().state, 'cancelled');
    const retry = review.retry();
    assert.ok(calls[0]);
    assert.ok(calls[1]);
    assert.equal(calls[1].path, calls[0].path);
    assert.ok(calls[1]);
    calls[1].resolve(
      Response.json({ object: 'list', data: [], has_more: false, next_cursor: null }),
    );
    await retry;
    assert.equal(review.snapshot().state, 'empty');
    review.dispose();
  });
  test(`${kind}: CSV cancellation retains page, blocks late delivery, allows explicit export`, async () => {
    let resolve!: (r: Response) => void;
    let signal: AbortSignal | null | undefined;
    let exports = 0;
    const review = create(async (path, init) => {
      if (path.includes('format=csv')) {
        signal = init.signal;
        if (++exports === 1)
          return new Promise<Response>((r) => {
            resolve = r;
          });
        return new Response('header\n', {
          headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
        });
      }
      return Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
    });
    await review.load({ principalId: 'human', limit: 1 });
    const pending = review.exportCsv();
    review.cancel();
    assert.equal(signal?.aborted, true);
    assert.equal(review.snapshot().state, 'empty');
    assert.equal(review.snapshot().exportState, 'cancelled');
    resolve(
      new Response('late\n', { headers: { 'content-type': 'text/csv', 'x-has-more': 'false' } }),
    );
    assert.equal((await pending).state, 'cancelled');
    assert.equal((await review.exportCsv()).state, 'ready');
    review.dispose();
  });
  for (const status of [401, 403])
    test(`${kind}: cancel cannot unlock ${status}`, async () => {
      let count = 0;
      const review = create(async () => {
        count++;
        return new Response(null, { status });
      });
      await review.load();
      const state = review.snapshot();
      review.cancel();
      await review.retry();
      await review.load();
      assert.deepEqual(review.snapshot(), state);
      assert.equal(count, 1);
      review.dispose();
      review.cancel();
      await review.retry();
      assert.equal(count, 1);
    });
}

test('DOM cancel loading and retry; cancelled late CSV never saves', async () => {
  const root = new Element();
  const calls: { resolve: (r: Response) => void; signal: AbortSignal | null | undefined }[] = [];
  let saved = 0;
  const ui = mountHistoryWorkspace(
    root,
    (_path, init) =>
      new Promise<Response>((resolve) => calls.push({ resolve, signal: init.signal })),
    {
      save: () => {
        saved++;
        return 'started';
      },
      dispose() {},
    },
  );
  const click = (label: string) => {
    const n = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
    assert.ok(n, label);
    n.listeners.click?.();
  };
  click('Cancel history request');
  assert.ok(calls[0]);
  assert.equal(calls[0].signal?.aborted, true);
  assert.ok(calls[0]);
  calls[0].resolve(Response.json({ object: 'list', data: [], has_more: false, next_cursor: null }));
  await tick();
  click('Retry');
  assert.ok(calls[1]);
  calls[1].resolve(Response.json({ object: 'list', data: [], has_more: false, next_cursor: null }));
  await tick();
  click('Download current page CSV');
  click('Cancel CSV preparation');
  assert.ok(calls[2]);
  assert.equal(calls[2].signal?.aborted, true);
  assert.ok(calls[2]);
  calls[2].resolve(
    new Response('late\n', { headers: { 'content-type': 'text/csv', 'x-has-more': 'false' } }),
  );
  await tick();
  assert.equal(saved, 0);
  ui.dispose();
});
