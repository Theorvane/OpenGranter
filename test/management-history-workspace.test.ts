import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistoryWorkspace } from '../src/management/history-workspace.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

function page(kind: string) {
  const row =
    kind === 'usage'
      ? buildUsageRecord({
          principalId: 'human',
          credentialId: 'old',
          policyVersions: [],
          requestId: 'req',
          attemptId: 'z',
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
            amountDecimal: '9007199254740993.0000000001',
            currency: 'USD',
            priceVersion: 'v1',
          },
        })
      : {
          eventId: '9007199254740993',
          occurredAt: 100,
          kind: 'models-listed',
          requestId: 'req',
          principalId: 'human',
          credentialId: 'old',
          policyVersions: [],
          details: { count: 1, prompt: 'PRIVATE' },
        };
  return Response.json({ object: 'list', data: [row], has_more: false, next_cursor: null });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
for (const source of ['usage', 'audit'] as const) {
  for (const status of [401, 403]) {
    for (const csv of [false, true]) {
      test(`${source} ${status} ${csv ? 'CSV' : 'JSON'} clears both histories and locks retained methods`, async () => {
        let denied = false;
        let calls = 0;
        const workspace = createHistoryWorkspace(async (path) => {
          calls++;
          const kind = path.includes('/usage?') ? 'usage' : 'audit';
          return denied ? new Response('PRIVATE', { status }) : page(kind);
        });
        await workspace.usage.load();
        await workspace.audit.load();
        assert.equal(workspace.snapshot().usage.data.length, 1);
        assert.equal(workspace.snapshot().audit.data.length, 1);
        const retained = workspace[source].load;
        denied = true;
        if (csv) await workspace[source].exportCsv();
        else await workspace[source].load();
        assert.equal(workspace.snapshot().state, status === 401 ? 'unauthenticated' : 'denied');
        assert.deepEqual(workspace.snapshot().usage.data, []);
        assert.deepEqual(workspace.snapshot().audit.data, []);
        const before = calls;
        await retained();
        await workspace.usage.load();
        await workspace.audit.load();
        await workspace.usage.retry();
        await workspace.audit.retry();
        await workspace.usage.exportCsv();
        await workspace.audit.exportCsv();
        assert.equal(calls, before);
        assert.doesNotMatch(JSON.stringify(workspace.snapshot()), /PRIVATE|9007199254740993/u);
        workspace.dispose();
      });
    }
  }
}
for (const source of ['usage', 'audit'] as const) {
  test(`${source} denial aborts pending sibling even when transport ignores cancellation`, async () => {
    const slow = deferred<Response>();
    let signal: AbortSignal | undefined;
    const sibling = source === 'usage' ? 'audit' : 'usage';
    const workspace = createHistoryWorkspace(async (path, init) => {
      if (path.includes(`/${source}?`)) return new Response(null, { status: 403 });
      signal = init.signal ?? undefined;
      return slow.promise;
    });
    const pending = workspace[sibling].load();
    await workspace[source].load();
    assert.equal(signal?.aborted, true);
    await pending;
    slow.resolve(page(sibling));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(workspace.snapshot()[sibling].data, []);
    assert.equal(workspace.snapshot().state, 'denied');
  });
}
test('aborted stale denial does not terminate a new request or sibling', async () => {
  const old = deferred<Response>();
  let calls = 0;
  const workspace = createHistoryWorkspace(async (path) => {
    if (path.includes('/usage?') && ++calls === 1) return old.promise;
    return page(path.includes('/usage?') ? 'usage' : 'audit');
  });
  const pending = workspace.usage.load();
  await workspace.usage.load();
  await workspace.audit.load();
  old.resolve(new Response(null, { status: 403 }));
  await pending;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(workspace.snapshot().state, 'active');
  assert.equal(workspace.snapshot().usage.state, 'ready');
  assert.equal(workspace.snapshot().audit.state, 'ready');
  workspace.dispose();
});
for (const failure of ['server', 'transport']) {
  test(`${failure} error stays local and supports explicit retry`, async () => {
    let fails = true;
    const workspace = createHistoryWorkspace(async (path) => {
      if (fails && path.includes('/usage?')) {
        if (failure === 'transport') throw new Error('PRIVATE');
        return new Response(null, { status: 500 });
      }
      return page(path.includes('/usage?') ? 'usage' : 'audit');
    });
    await workspace.audit.load();
    await workspace.usage.load();
    assert.equal(workspace.snapshot().state, 'active');
    assert.equal(workspace.snapshot().audit.data.length, 1);
    assert.equal(workspace.snapshot().usage.state, 'unavailable');
    fails = false;
    await workspace.usage.retry();
    assert.equal(workspace.snapshot().usage.state, 'ready');
    workspace.dispose();
  });
}
test('dispose cancels both, clears rows and terminally rejects stale ports', async () => {
  let calls = 0;
  const workspace = createHistoryWorkspace(async (path) => {
    calls++;
    return page(path.includes('/usage?') ? 'usage' : 'audit');
  });
  await workspace.usage.load();
  await workspace.audit.load();
  workspace.dispose();
  workspace.dispose();
  assert.equal(workspace.snapshot().state, 'disposed');
  assert.deepEqual(workspace.snapshot().usage.data, []);
  assert.deepEqual(workspace.snapshot().audit.data, []);
  const before = calls;
  await workspace.audit.load();
  await workspace.usage.load();
  assert.equal(calls, before);
});

test('observer sees one fully cleared terminal snapshot even if it throws', async () => {
  const seen: ReturnType<ReturnType<typeof createHistoryWorkspace>['snapshot']>[] = [];
  let denied = false;
  const workspace = createHistoryWorkspace(
    async (path) =>
      denied
        ? new Response(null, { status: 403 })
        : page(path.includes('/usage?') ? 'usage' : 'audit'),
    (snapshot) => {
      seen.push(snapshot);
      throw new Error('PRIVATE observer');
    },
  );
  await workspace.usage.load();
  await workspace.audit.load();
  denied = true;
  await workspace.audit.exportCsv();
  const terminal = seen.filter((snapshot) => snapshot.state !== 'active');
  assert.equal(terminal.length, 1);
  assert.deepEqual(terminal[0]?.usage.data, []);
  assert.deepEqual(terminal[0]?.audit.data, []);
  assert.ok(Object.isFrozen(workspace.snapshot()));
});
test('reentrant disposal during loading prevents any transport and late observer publication', async () => {
  let calls = 0;
  const workspace = createHistoryWorkspace(
    async () => {
      calls++;
      return page('usage');
    },
    (snapshot) => {
      if (snapshot.usage.state === 'loading') workspace.dispose();
    },
  );
  await workspace.usage.load();
  assert.equal(calls, 0);
  assert.equal(workspace.snapshot().state, 'disposed');
  assert.deepEqual(workspace.snapshot().usage.data, []);
});

for (const source of ['usage', 'audit'] as const) {
  test(`${source} denial cancels sibling explicit CSV and suppresses late export`, async () => {
    const late = deferred<Response>();
    const sibling = source === 'usage' ? 'audit' : 'usage';
    let exporting = false;
    let signal: AbortSignal | undefined;
    const workspace = createHistoryWorkspace(async (path, init) => {
      const kind = path.includes('/usage?') ? 'usage' : 'audit';
      if (exporting && kind === sibling) {
        signal = init.signal ?? undefined;
        return late.promise;
      }
      if (exporting) return new Response(null, { status: 401 });
      return page(kind);
    });
    await workspace.usage.load();
    await workspace.audit.load();
    exporting = true;
    const pending = workspace[sibling].exportCsv();
    await workspace[source].load();
    assert.equal(signal?.aborted, true);
    assert.equal((await pending).state, 'cancelled');
    let cancelled = false;
    late.resolve(
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        {
          headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
        },
      ),
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(cancelled, true);
    assert.equal(workspace.snapshot().state, 'unauthenticated');
    assert.deepEqual(workspace.snapshot()[sibling].data, []);
  });
}
