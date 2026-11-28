import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { createAuditReview } from '../src/management/audit-review.ts';
import { createHistoryWorkspace } from '../src/management/history-workspace.ts';
import { createUsageReview } from '../src/management/usage-review.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const cursor = Buffer.from(JSON.stringify([100, 'z'])).toString('base64url');
function page(kind: 'usage' | 'audit', more = false, after = false) {
  const row =
    kind === 'audit'
      ? {
          eventId: after ? '1' : '2',
          occurredAt: 100,
          kind: 'models-listed',
          requestId: 'req',
          principalId: 'human',
          credentialId: 'cred',
          policyVersions: [],
          details: { count: 1, modelAlias: 'chat' },
        }
      : buildUsageRecord({
          principalId: 'human',
          credentialId: 'cred',
          policyVersions: [],
          requestId: 'req',
          attemptId: after ? 'a' : 'z',
          occurredAt: 100,
          modelAlias: 'chat',
          routeKind: 'managed',
          upstreamModelId: 'upstream',
          selectedCandidateId: 'candidate',
          latencyMs: 1,
          outcome: 'succeeded',
          possiblyBilled: true,
          possibleDuplicate: false,
        });
  return Response.json({
    object: 'list',
    data: [row],
    has_more: more,
    next_cursor: more ? (kind === 'usage' ? cursor : '2') : null,
  });
}
for (const [kind, create] of [
  ['usage', createUsageReview],
  ['audit', createAuditReview],
] as const) {
  test(`${kind}: cancel aborts cursor read, ignores late success and retries exact attempted URL`, async () => {
    const urls: string[] = [];
    let release!: (value: Response) => void;
    let signal: AbortSignal | undefined;
    const review = create(async (url, init) => {
      urls.push(url);
      if (urls.length === 2) {
        signal = init.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      return page(kind, urls.length === 1, urls.length > 1);
    });
    await review.load({ principalId: 'human', fromMs: 0, toMs: 200, limit: 1 });
    assert.equal(review.snapshot().state, 'ready');
    const pending = review.next();
    assert.equal(review.snapshot().state, 'loading');
    review.cancelRead();
    assert.equal(signal?.aborted, true);
    assert.equal(review.snapshot().state, 'cancelled');
    assert.equal(review.snapshot().data.length, 0);
    assert.equal(review.snapshot().canNext, false);
    assert.equal(review.snapshot().canPrevious, false);
    assert.deepEqual(await review.exportCsv(), { state: 'unavailable' });
    review.cancelRead();
    release(page(kind));
    await pending;
    assert.equal(review.snapshot().state, 'cancelled');
    await review.retry();
    assert.equal(urls[2], urls[1]);
    assert.equal(
      new URL(urls[2] ?? '', 'https://test.invalid').searchParams.get('cursor'),
      kind === 'usage' ? cursor : '2',
    );
    assert.equal(review.snapshot().state, 'ready');
    assert.equal(review.snapshot().canPrevious, true);
    review.cancelRead();
    assert.equal(review.snapshot().state, 'ready');
  });

  test(`${kind}: loading observer cancellation prevents transport; disposal stays terminal`, async () => {
    let calls = 0;
    const review = create(
      async () => {
        calls++;
        return page(kind);
      },
      (value) => {
        if (value.state === 'loading') review.cancelRead();
      },
    );
    review.cancelRead();
    assert.equal(review.snapshot().state, 'idle');
    await review.load();
    assert.equal(calls, 0);
    assert.equal(review.snapshot().state, 'cancelled');
    review.dispose();
    review.cancelRead();
    await review.retry();
    await review.load();
    assert.equal(review.snapshot().state, 'idle');
    assert.equal(calls, 0);
  });

  test(`${kind}: cancelled late denial is stale but fresh retry denial terminates both histories`, async () => {
    let release!: (value: Response) => void;
    let hold = false;
    let deny = false;
    const workspace = createHistoryWorkspace(async (url) => {
      const target = url.includes('/audit') ? 'audit' : 'usage';
      if (target === kind && hold)
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      if (target === kind && deny) return new Response(null, { status: 403 });
      return page(target);
    });
    await workspace.usage.load();
    await workspace.audit.load();
    hold = true;
    const pending = workspace[kind].load();
    workspace[kind].cancelRead();
    release(new Response(null, { status: 401 }));
    await pending;
    await tick();
    assert.equal(workspace.snapshot().state, 'active');
    const sibling = kind === 'usage' ? 'audit' : 'usage';
    assert.equal(workspace[sibling].snapshot().state, 'ready');
    hold = false;
    deny = true;
    await workspace[kind].retry();
    assert.equal(workspace.snapshot().state, 'denied');
    assert.equal(workspace.usage.snapshot().data.length, 0);
    assert.equal(workspace.audit.snapshot().data.length, 0);
    workspace[kind].cancelRead();
    assert.equal(workspace.snapshot().state, 'denied');
  });
}

for (const [kind, create] of [
  ['usage', createUsageReview],
  ['audit', createAuditReview],
] as const) {
  test(`${kind}: abort observer disposal cannot be overwritten by cancellation`, async () => {
    const review = create(async (_url, init) => {
      init.signal?.addEventListener('abort', () => review.dispose(), { once: true });
      return new Promise<Response>(() => {});
    });
    void review.load();
    review.cancelRead();
    assert.equal(review.snapshot().state, 'idle');
    await review.retry();
    assert.equal(review.snapshot().state, 'idle');
  });

  test(`${kind}: real loopback fetch abort and explicit retry`, async () => {
    let received!: () => void;
    const arrived = new Promise<void>((resolve) => {
      received = resolve;
    });
    let closed!: () => void;
    const disconnected = new Promise<void>((resolve) => {
      closed = resolve;
    });
    let calls = 0;
    const server = createServer((_request, response) => {
      calls++;
      if (calls === 1) {
        response.once('close', closed);
        received();
        return;
      }
      void page(kind)
        .text()
        .then((body) => {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(body);
        });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const review = create((url, init) => fetch(`http://127.0.0.1:${address.port}${url}`, init));
    try {
      const pending = review.load();
      await arrived;
      review.cancelRead();
      await pending;
      await disconnected;
      assert.equal(review.snapshot().state, 'cancelled');
      await review.retry();
      assert.equal(review.snapshot().state, 'ready');
      assert.equal(calls, 2);
    } finally {
      review.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}
