import assert from 'node:assert/strict';
import test from 'node:test';
import { createSsoUsageSession } from '../src/management/usage-session.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

function row(id = 'z', time = 10) {
  return buildUsageRecord({
    principalId: 'human',
    credentialId: 'historical',
    policyVersions: [],
    requestId: 'r',
    attemptId: id,
    modelAlias: 'chat',
    routeKind: 'managed',
    upstreamModelId: 'up',
    selectedCandidateId: 'c',
    occurredAt: time,
    latencyMs: 1,
    outcome: 'succeeded',
    possiblyBilled: true,
    possibleDuplicate: true,
  });
}
function page(data = [row()], next: string | null = null) {
  return Response.json({ object: 'list', data, has_more: next !== null, next_cursor: next });
}
test('locked until authorized, empty is distinct and no invented usage', async () => {
  const session = createSsoUsageSession();
  assert.equal(session.snapshot().state, 'unauthenticated');
  await session.search();
  assert.equal(session.snapshot().state, 'unauthenticated');
  session.authorize(async () => page([]));
  assert.equal(session.snapshot().state, 'idle');
  await session.search();
  assert.deepEqual(session.snapshot(), { state: 'empty' });
  await session.next();
  assert.equal(session.snapshot().state, 'empty');
});
test('next preserves copied filters and exact opaque cursor; search resets pagination', async () => {
  const session = createSsoUsageSession();
  const cursor = Buffer.from(JSON.stringify([10, 'z'])).toString('base64url');
  const paths: string[] = [];
  session.authorize(async (url) => {
    paths.push(url);
    return url.includes('cursor=') ? page([row('a', 9)]) : page([row()], cursor);
  });
  const filters = { model: 'chat', limit: 1 };
  await session.search(filters);
  filters.model = 'changed';
  await session.next();
  assert.ok(paths[1]?.includes('model=chat'));
  assert.ok(paths[1]?.endsWith('cursor=' + cursor));
  const snapshot = session.snapshot();
  assert.equal(snapshot.state, 'rows');
  if (snapshot.state === 'rows') {
    assert.equal(snapshot.data[0]?.attemptId, 'a');
    assert.equal(snapshot.data.length, 1);
  }
  await session.search({ model: 'chat', limit: 1 });
  assert.ok(!paths[2]?.includes('cursor='));
});
test('snapshots deeply frozen without altering unknown money and duplicate markers', async () => {
  const session = createSsoUsageSession();
  session.authorize(async () => page());
  await session.search();
  const snapshot = session.snapshot();
  assert.equal(snapshot.state, 'rows');
  if (snapshot.state !== 'rows') return;
  assert.deepEqual(snapshot.data, [row()]);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.data));
  assert.ok(Object.isFrozen(snapshot.data[0]));
  assert.ok(Object.isFrozen(snapshot.data[0]?.usage));
});
test('loading hides old rows and clear cancels stalled transport without late publication', async () => {
  const session = createSsoUsageSession();
  let release: ((value: Response) => void) | undefined;
  session.authorize(async () => page());
  await session.search();
  session.authorize(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = session.search();
  assert.deepEqual(session.snapshot(), { state: 'loading' });
  session.clear('expired');
  await pending;
  assert.deepEqual(session.snapshot(), { state: 'expired' });
  release?.(page());
  await Promise.resolve();
  assert.deepEqual(session.snapshot(), { state: 'expired' });
});
test('identity replacement and newer search suppress older results', async () => {
  const session = createSsoUsageSession();
  let release: ((value: Response) => void) | undefined;
  session.authorize(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = session.search();
  session.authorize(async () => page([]));
  await session.search();
  await pending;
  release?.(page());
  await Promise.resolve();
  assert.equal(session.snapshot().state, 'empty');
  session.authorize(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const older = session.search();
  const newer = session.search({ limit: 0 });
  await newer;
  await older;
  release?.(page());
  assert.equal(session.snapshot().state, 'invalid_query');
});
test('401/403 revoke local transport until authorized; unavailable allows fresh search', async () => {
  for (const [status, state] of [
    [401, 'unauthenticated'],
    [403, 'denied'],
  ] as const) {
    const session = createSsoUsageSession();
    let calls = 0;
    session.authorize(async () => {
      calls++;
      return new Response(null, { status });
    });
    await session.search();
    assert.equal(session.snapshot().state, state);
    await session.search();
    assert.equal(calls, 1);
  }
  const session = createSsoUsageSession();
  let calls = 0;
  session.authorize(async () => (++calls === 1 ? new Response(null, { status: 503 }) : page()));
  await session.search();
  assert.equal(session.snapshot().state, 'unavailable');
  await session.search();
  assert.equal(session.snapshot().state, 'rows');
});
test('dispose is permanent and silent after teardown', async () => {
  const session = createSsoUsageSession();
  let calls = 0;
  session.authorize(async () => {
    calls++;
    return page();
  });
  await session.search();
  session.dispose();
  session.clear('expired');
  session.authorize(async () => page());
  await session.search();
  await session.next();
  assert.equal(session.snapshot().state, 'disposed');
  assert.equal(calls, 1);
});
