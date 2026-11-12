import assert from 'node:assert/strict';
import test from 'node:test';
import { createUsageReview } from '../src/management/usage-review.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

const cursor = (id: string) => Buffer.from(JSON.stringify([100, id])).toString('base64url');
function row(attemptId = 'z') {
  return buildUsageRecord({
    principalId: 'human',
    credentialId: 'historical',
    policyVersions: [],
    requestId: 'req-1',
    attemptId,
    occurredAt: 100,
    modelAlias: 'chat',
    routeKind: 'managed',
    upstreamModelId: 'upstream',
    selectedCandidateId: 'candidate',
    latencyMs: 2,
    outcome: 'succeeded',
    possiblyBilled: true,
    possibleDuplicate: true,
    estimatedCost: {
      amountDecimal: '9007199254740993.000000000000000001',
      currency: 'USD',
      priceVersion: 'v1',
    },
    upstreamBilledCost: {
      amountDecimal: '9007199254740993.000000000000000002',
      currency: 'USD',
      source: 'openrouter',
    },
  });
}
function page(id = 'z', more = false) {
  return Response.json({
    object: 'list',
    data: [{ ...row(id), secret: 'PRIVATE' }],
    has_more: more,
    next_cursor: more ? cursor(id) : null,
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('screen supports loading, opaque next/back and filter reset with real JSON client', async () => {
  const paths: string[] = [];
  const states: string[] = [];
  const review = createUsageReview(
    async (url) => {
      paths.push(url);
      const cursor = new URL(url, 'https://local.invalid').searchParams.get('cursor');
      return cursor ? page('a') : page('z', true);
    },
    (value) => {
      states.push(value.state);
    },
  );
  await review.load({ principalId: 'human', limit: 1, cursor: '1' });
  assert.equal(review.snapshot().state, 'ready');
  assert.equal(paths[0]?.includes('cursor='), false);
  assert.equal(JSON.stringify(review.snapshot()).includes('PRIVATE'), false);
  await review.next();
  assert.equal(
    new URL(paths[1] ?? '', 'https://local.invalid').searchParams.get('cursor'),
    cursor('z'),
  );
  assert.equal(review.snapshot().canPrevious, true);
  await review.previous();
  assert.equal(paths[2], paths[0]);
  await review.next();
  await review.load({ model: 'chat' });
  assert.equal(review.snapshot().canPrevious, false);
  assert.ok(!paths.at(-1)?.includes('cursor='));
  assert.ok(states.includes('loading'));
  assert.ok(Object.isFrozen(review.snapshot()));
});

test('explicit CSV uses displayed page filters and does not run on list load', async () => {
  const paths: string[] = [];
  const review = createUsageReview(async (url) => {
    paths.push(url);
    const query = new URL(url, 'https://local.invalid').searchParams;
    if (query.get('format') === 'csv')
      return new Response('attempt_id\na\n', {
        headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
      });
    return query.has('cursor') ? page('a') : page('z', true);
  });
  const filters = { principalId: 'human', model: 'chat', fromMs: 0, toMs: 101, limit: 1 };
  await review.load(filters);
  filters.model = 'other';
  await review.next();
  assert.equal(paths.length, 2);
  const result = await review.exportCsv();
  assert.equal(result.state, 'ready');
  const previousPath = paths[1];
  assert.ok(previousPath);
  const json = new URL(previousPath, 'https://local.invalid');
  json.searchParams.set('format', 'csv');
  assert.equal(paths[2], json.pathname + json.search);
  assert.equal(review.snapshot().exportState, 'idle');
});

test('empty pages, failed next retry and invalid filters have explicit states', async () => {
  let failure = true;
  const review = createUsageReview(async (url) => {
    const query = new URL(url, 'https://local.invalid').searchParams;
    if (query.has('cursor') && failure) return new Response(null, { status: 503 });
    if (query.has('cursor'))
      return Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
    return page('z', true);
  });
  await review.load();
  await review.next();
  assert.equal(review.snapshot().state, 'unavailable');
  assert.deepEqual(review.snapshot().data, []);
  failure = false;
  await review.retry();
  assert.equal(review.snapshot().state, 'empty');
  assert.equal(review.snapshot().canPrevious, true);
  await review.load({ limit: 101 });
  assert.equal(review.snapshot().state, 'invalid_query');
});

test('filter and identity changes suppress stale JSON and CSV, disposal is terminal', async () => {
  const held = deferred<Response>();
  const review = createUsageReview(async (url) =>
    url.includes('format=csv') ? held.promise : page(),
  );
  await review.load();
  const pending = review.exportCsv();
  assert.equal(review.snapshot().exportState, 'loading');
  await review.load({ model: 'chat' });
  assert.equal((await pending).state, 'cancelled');
  held.resolve(
    new Response('PRIVATE', { headers: { 'content-type': 'text/csv', 'x-has-more': 'false' } }),
  );
  review.dispose();
  await review.load();
  assert.equal(review.snapshot().state, 'idle');
  assert.deepEqual(review.snapshot().data, []);
  assert.equal((await review.exportCsv()).state, 'cancelled');
  const delayed = deferred<Response>();
  const other = createUsageReview(async () => delayed.promise);
  const old = other.load();
  other.dispose();
  await old;
  delayed.resolve(page());
  assert.equal(other.snapshot().state, 'idle');
});

test('401/403 on JSON or export remove rows and block port reuse; observers cannot leak diagnostics', async () => {
  for (const status of [401, 403]) {
    for (const onExport of [false, true]) {
      let count = 0;
      const review = createUsageReview(
        async (url) => {
          count++;
          return !onExport || url.includes('format=csv')
            ? new Response('PRIVATE', { status })
            : page();
        },
        () => {
          throw new Error('PRIVATE observer');
        },
      );
      await review.load();
      if (onExport) await review.exportCsv();
      assert.equal(review.snapshot().state, status === 401 ? 'unauthenticated' : 'denied');
      assert.deepEqual(review.snapshot().data, []);
      await review.load();
      await review.retry();
      await review.next();
      assert.equal(count, onExport ? 2 : 1);
      assert.equal(JSON.stringify(review.snapshot()).includes('PRIVATE'), false);
    }
  }
});

test('a new search snapshots getters once and reports accessor failure without request', async () => {
  let reads = 0;
  let count = 0;
  const review = createUsageReview(async () => {
    count++;
    return page();
  });
  await review.load({
    get model() {
      reads++;
      return 'chat';
    },
  });
  assert.equal(reads, 1);
  assert.equal(count, 1);
  await review.load({
    get model(): string {
      throw new Error('PRIVATE getter');
    },
  });
  assert.equal(review.snapshot().state, 'invalid_query');
  assert.equal(count, 1);
});

test('new search overtakes stale JSON; snapshots cannot be mutated', async () => {
  const held = deferred<Response>();
  let calls = 0;
  const review = createUsageReview(async () => (++calls === 1 ? held.promise : page()));
  const pending = review.load();
  assert.equal(review.snapshot().state, 'loading');
  await review.next();
  assert.equal(calls, 1);
  await review.load({ model: 'chat' });
  await pending;
  held.resolve(page('zz'));
  assert.equal(review.snapshot().data[0]?.attemptId, 'z');
  const immutableRow = review.snapshot().data[0];
  assert.ok(immutableRow);
  assert.throws(() => {
    (immutableRow.usage as { status: string }).status = 'reported';
  }, TypeError);
});

test('CSV failure keeps authorized page; overlapping exports and hostile observer teardown are safe', async () => {
  const first = deferred<Response>();
  let exports = 0;
  const review = createUsageReview(async (url) => {
    if (!url.includes('format=csv')) return page();
    return ++exports === 1 ? first.promise : new Response(null, { status: 503 });
  });
  await review.load();
  const old = review.exportCsv();
  assert.equal((await review.exportCsv()).state, 'unavailable');
  assert.equal((await old).state, 'cancelled');
  first.resolve(new Response('PRIVATE'));
  assert.equal(review.snapshot().state, 'ready');
  assert.equal(review.snapshot().exportState, 'unavailable');
  assert.equal(review.snapshot().data.length, 1);
  let stopOnReady = false;
  const observer = createUsageReview(
    async (url) =>
      url.includes('format=csv')
        ? new Response('PRIVATE', {
            headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
          })
        : page(),
    (snapshot) => {
      if (stopOnReady && snapshot.exportState === 'idle' && snapshot.state === 'ready')
        observer.dispose();
    },
  );
  await observer.load();
  stopOnReady = true;
  assert.equal((await observer.exportCsv()).state, 'cancelled');
  assert.equal(observer.snapshot().state, 'idle');
});

test('screen retains exact decimal comparison and unknown usage without conflating duplicate billing', async () => {
  const review = createUsageReview(async () => page());
  await review.load();
  const data = review.snapshot().data[0];
  assert.ok(data);
  assert.equal(data.estimatedCost?.amountDecimal, '9007199254740993.000000000000000001');
  assert.equal(data.upstreamBilledCost?.amountDecimal, '9007199254740993.000000000000000002');
  assert.deepEqual(data.costComparison, {
    status: 'reported_above_estimate',
    reportedMinusEstimated: '0.000000000000000001',
    currency: 'USD',
  });
  assert.equal(data.usage.status, 'missing');
  assert.equal(data.usage.totalTokens, null);
  assert.equal(data.possibleDuplicate, true);
  assert.equal(data.possiblyBilled, true);
  assert.ok(Object.isFrozen(data.costComparison));
  assert.ok(Object.isFrozen(data.estimatedCost));
});
