import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuditReview } from '../src/management/audit-review.ts';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import { createUsageReview } from '../src/management/usage-review.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { Element, nodes, text, tick } from './account-token-dom-fixture.ts';

function find(root: Element, label: string) {
  return nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
}
function click(root: Element, label: string) {
  const node = find(root, label);
  assert.ok(node, label);
  node.listeners.click?.();
  return node;
}
function model(root: Element) {
  const node = nodes(root).find((n) => n.attributes['aria-label'] === 'Model');
  assert.ok(node);
  return node;
}
const empty = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
function fixture() {
  const root = new Element();
  const pending: Array<{
    path: string;
    signal: AbortSignal | null | undefined;
    resolve: (r: Response) => void;
  }> = [];
  let saves = 0;
  const app = mountHistoryWorkspace(
    root,
    async (path, init) =>
      new Promise<Response>((resolve) => {
        pending.push({ path, signal: init.signal, resolve });
      }),
    {
      save() {
        saves++;
        return 'started';
      },
      dispose() {},
    },
  );
  return { root, pending, app, saves: () => saves };
}

for (const kind of ['usage', 'audit'] as const) {
  async function setup() {
    const f = fixture();
    if (kind === 'audit') {
      f.pending[0]?.resolve(empty());
      await tick();
      click(f.root, 'Audit');
    }
    await tick();
    return f;
  }
  test(`${kind}: cancel headers preserves drafts and explicit retry reuses applied scope`, async () => {
    const f = await setup();
    const first = f.pending.at(-1);
    assert.ok(first);
    model(f.root).value = 'draft-model';
    model(f.root).listeners.input?.();
    const retired = click(f.root, 'Cancel history request');
    await tick();
    assert.equal(first.signal?.aborted, true);
    assert.match(text(f.root), /History request cancelled/);
    assert.equal(
      nodes(f.root).find((n) => n.textContent === 'History request cancelled.')?.attributes.role,
      'status',
    );
    assert.equal(model(f.root).value, 'draft-model');
    assert.equal(find(f.root, 'Cancel history request'), undefined);
    assert.equal(find(f.root, 'Next page')?.attributes.disabled, '');
    const count = f.pending.length;
    await tick();
    assert.equal(f.pending.length, count);
    click(f.root, 'Retry');
    await tick();
    const retry = f.pending.at(-1);
    assert.ok(retry);
    assert.equal(retry.path, first.path);
    assert.equal(retry.signal?.aborted, false);
    retired.listeners.click?.();
    assert.equal(retry.signal?.aborted, false);
    retry.resolve(empty());
    await tick();
    assert.match(text(f.root), /No history matches/);
    assert.equal(model(f.root).value, 'draft-model');
    assert.equal(f.saves(), 0);
    f.app.dispose();
    retired.listeners.click?.();
    assert.equal(text(f.root).trim(), '');
    first.resolve(empty());
    await tick();
    assert.equal(text(f.root).trim(), '');
  });
  for (const late of [200, 401, 403]) {
    test(`${kind}: late cancelled ${late} cannot overwrite fresh read or revoke workspace`, async () => {
      const f = await setup();
      const old = f.pending.at(-1);
      assert.ok(old);
      click(f.root, 'Cancel history request');
      click(f.root, 'Retry');
      await tick();
      const fresh = f.pending.at(-1);
      assert.ok(fresh);
      old.resolve(late === 200 ? empty() : new Response(null, { status: late }));
      await tick();
      assert.match(text(f.root), /Loading history/);
      assert.equal(fresh.signal?.aborted, false);
      fresh.resolve(empty());
      await tick();
      assert.match(text(f.root), /No history matches/);
      assert.equal(find(f.root, 'Cancel history request'), undefined);
      f.app.dispose();
    });
  }
  for (const status of [401, 403]) {
    test(`${kind}: current retry ${status} remains terminal`, async () => {
      const f = await setup();
      const old = f.pending.at(-1);
      click(f.root, 'Cancel history request');
      const retryControl = click(f.root, 'Retry');
      await tick();
      f.pending.at(-1)?.resolve(new Response(null, { status }));
      await tick();
      assert.match(text(f.root), status === 401 ? /Sign.in required/i : /Access denied/);
      const count = f.pending.length;
      retryControl.listeners.click?.();
      assert.equal(f.pending.length, count);
      old?.resolve(empty());
      f.app.dispose();
    });
  }
  test(`${kind}: cancel interrupts a streamed JSON body without replay`, async () => {
    const f = await setup();
    let bodyCancelled = 0;
    f.pending.at(-1)?.resolve(
      new Response(
        new ReadableStream({
          cancel() {
            bodyCancelled++;
          },
        }),
        {
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    await tick();
    const count = f.pending.length;
    click(f.root, 'Cancel history request');
    await tick();
    assert.equal(bodyCancelled, 1);
    assert.equal(f.pending.length, count);
    assert.match(text(f.root), /History request cancelled/);
    f.app.dispose();
  });
  test(`${kind}: review retry retains opaque next-page cursor and applied filters`, async () => {
    const paths: string[] = [];
    const signals: (AbortSignal | null | undefined)[] = [];
    let resolvePage: ((r: Response) => void) | undefined;
    const review = (kind === 'usage' ? createUsageReview : createAuditReview)(
      async (path, init) => {
        paths.push(path);
        signals.push(init.signal);
        if (paths.length > 1)
          return new Promise<Response>((resolve) => {
            resolvePage = resolve;
          });
        return Response.json({
          object: 'list',
          data: [
            kind === 'audit'
              ? {
                  eventId: '1',
                  occurredAt: 100,
                  kind: 'route-unavailable',
                  requestId: 'req',
                  principalId: 'human',
                  credentialId: 'cred',
                  policyVersions: [],
                  details: { modelAlias: 'applied-model' },
                }
              : buildUsageRecord({
                  principalId: 'human',
                  credentialId: 'cred',
                  policyVersions: [],
                  requestId: 'req',
                  attemptId: 'a',
                  occurredAt: 100,
                  modelAlias: 'applied-model',
                  routeKind: 'managed',
                  upstreamModelId: 'up',
                  selectedCandidateId: 'candidate',
                  latencyMs: 1,
                  outcome: 'succeeded',
                  possiblyBilled: false,
                  possibleDuplicate: false,
                }),
          ],
          has_more: true,
          next_cursor:
            kind === 'audit' ? '1' : Buffer.from(JSON.stringify([100, 'a'])).toString('base64url'),
        });
      },
    );
    review.cancelRead(); // idle: inert
    await review.load({ model: 'applied-model', principalId: 'human', limit: 5 });
    const state = review.snapshot();
    review.cancelRead(); // ready/empty: inert
    assert.equal(review.snapshot(), state);
    const next = review.next();
    await tick();
    assert.match(paths.at(-1) ?? '', /cursor=/);
    review.cancelRead();
    await next;
    assert.equal(signals.at(-1)?.aborted, true);
    assert.equal(review.snapshot().state, 'cancelled');
    const nextPath = paths.at(-1);
    const retry = review.retry();
    await tick();
    assert.equal(paths.at(-1), nextPath);
    assert.match(nextPath ?? '', /model=applied-model/);
    assert.match(nextPath ?? '', /principal_id=human/);
    resolvePage?.(empty());
    await retry;
    assert.equal(review.snapshot().canPrevious, true);
    review.dispose();
    const disposed = review.snapshot();
    review.cancelRead();
    assert.equal(review.snapshot(), disposed);
  });
}
