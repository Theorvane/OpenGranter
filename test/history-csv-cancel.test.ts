import assert from 'node:assert/strict';
import test from 'node:test';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
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
  const input = nodes(root).find((n) => n.attributes['aria-label'] === 'Model');
  assert.ok(input);
  return input;
}
const empty = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
const csv = () =>
  new Response('csv', { headers: { 'content-type': 'text/csv', 'x-has-more': 'false' } });
function fixture(stream: boolean, populated = false) {
  const root = new Element();
  const paths: string[] = [];
  const pending: Array<{ resolve: (r: Response) => void; signal: AbortSignal | null | undefined }> =
    [];
  let saves = 0;
  let cancelledBody = 0;
  let disposals = 0;
  const app = mountHistoryWorkspace(
    root,
    async (path, init) => {
      paths.push(path);
      if (!path.includes('format=csv')) {
        if (!populated || path.includes('cursor=')) return empty();
        const row = path.includes('audit')
          ? {
              eventId: '1',
              occurredAt: 100,
              kind: 'models-listed',
              requestId: 'kept-request',
              principalId: 'human',
              credentialId: 'cred',
              policyVersions: [],
              details: { count: 1 },
            }
          : buildUsageRecord({
              principalId: 'human',
              credentialId: 'cred',
              policyVersions: [],
              requestId: 'kept-request',
              attemptId: 'a',
              occurredAt: 100,
              modelAlias: 'kept-model',
              routeKind: 'managed',
              upstreamModelId: 'upstream',
              selectedCandidateId: 'candidate',
              latencyMs: 1,
              outcome: 'succeeded',
              possiblyBilled: false,
              possibleDuplicate: false,
            });
        return Response.json({
          object: 'list',
          data: [row],
          has_more: true,
          next_cursor: path.includes('audit')
            ? '1'
            : Buffer.from(JSON.stringify([100, 'a'])).toString('base64url'),
        });
      }
      if (stream)
        return new Response(
          new ReadableStream({
            cancel() {
              cancelledBody++;
            },
          }),
          {
            headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
          },
        );
      return new Promise<Response>((resolve) => pending.push({ resolve, signal: init.signal }));
    },
    {
      save() {
        saves++;
        return 'started';
      },
      dispose() {
        disposals++;
      },
    },
  );
  return {
    root,
    paths,
    pending,
    app,
    saves: () => saves,
    cancelledBody: () => cancelledBody,
    disposals: () => disposals,
  };
}
for (const kind of ['Usage', 'Audit'] as const) {
  test(`${kind} cancellation preserves authorized populated page and pagination`, async () => {
    const f = fixture(false, true);
    await tick();
    if (kind === 'Audit') {
      click(f.root, kind);
      await tick();
    }
    assert.match(text(f.root), /kept-request/);
    const before = f.paths.length;
    click(f.root, 'Download current page CSV');
    await tick();
    click(f.root, 'Cancel CSV export');
    assert.match(text(f.root), /kept-request/);
    assert.equal(f.paths.length, before + 1);
    assert.equal(find(f.root, 'Next page')?.attributes.disabled, undefined);
    click(f.root, 'Next page');
    await tick();
    assert.match(f.paths.at(-1) ?? '', /cursor=/);
    assert.match(text(f.root), /No history matches/);
    click(f.root, 'Previous page');
    await tick();
    assert.match(text(f.root), /kept-request/);
    f.app.dispose();
  });
  for (const staleStatus of [200, 403]) {
    test(`${kind} explicit CSV cancel preserves query/drafts and suppresses late ${staleStatus}`, async () => {
      const f = fixture(false);
      await tick();
      if (kind === 'Audit') {
        click(f.root, kind);
        await tick();
      }
      assert.equal(find(f.root, 'Cancel CSV export'), undefined);
      model(f.root).value = 'applied-model';
      model(f.root).listeners.input?.();
      click(f.root, 'Apply filters');
      await tick();
      model(f.root).value = 'unapplied-model';
      model(f.root).listeners.input?.();
      const reads = f.paths.length;
      click(f.root, 'Download current page CSV');
      await tick();
      assert.match(text(f.root), /Preparing CSV/);
      const oldCancel = click(f.root, 'Cancel CSV export');
      assert.equal(f.pending[0]?.signal?.aborted, true);
      assert.match(text(f.root), /CSV export cancelled/);
      assert.doesNotMatch(text(f.root), /CSV unavailable|Preparing CSV/);
      assert.match(text(f.root), /No history matches/);
      assert.equal(model(f.root).value, 'unapplied-model');
      assert.equal(f.paths.length, reads + 1);
      assert.equal(find(f.root, 'Cancel CSV export'), undefined);
      f.pending[0]?.resolve(
        staleStatus === 200 ? csv() : new Response('PRIVATE', { status: staleStatus }),
      );
      await tick();
      assert.equal(f.saves(), 0);
      assert.doesNotMatch(text(f.root), /Access denied|PRIVATE/);
      click(f.root, 'Download current page CSV');
      await tick();
      assert.match(f.paths.at(-1) ?? '', /model=applied-model/);
      assert.doesNotMatch(f.paths.at(-1) ?? '', /unapplied/);
      oldCancel.listeners.click?.();
      assert.equal(f.pending[1]?.signal?.aborted, false);
      f.pending[1]?.resolve(csv());
      await tick();
      assert.equal(f.saves(), 1);
      assert.doesNotMatch(text(f.root), /CSV export cancelled/);
      f.app.dispose();
      oldCancel.listeners.click?.();
      assert.equal(text(f.root), '');
      assert.equal(f.disposals(), 1);
    });
  }
  test(`${kind} cancel stops streamed body without cancelling JSON`, async () => {
    const f = fixture(true);
    await tick();
    if (kind === 'Audit') {
      click(f.root, kind);
      await tick();
    }
    click(f.root, 'Download current page CSV');
    await tick();
    click(f.root, 'Cancel CSV export');
    await tick();
    assert.equal(f.cancelledBody(), 1);
    assert.equal(f.saves(), 0);
    assert.match(text(f.root), /No history matches/);
    assert.match(text(f.root), /CSV export cancelled/);
    f.app.dispose();
  });
  for (const status of [401, 403, 503]) {
    test(`${kind} fresh export after cancellation still handles HTTP ${status}`, async () => {
      const f = fixture(false);
      await tick();
      if (kind === 'Audit') {
        click(f.root, kind);
        await tick();
      }
      click(f.root, 'Download current page CSV');
      await tick();
      const retained = click(f.root, 'Cancel CSV export');
      click(f.root, 'Download current page CSV');
      await tick();
      f.pending[1]?.resolve(new Response('PRIVATE', { status }));
      await tick();
      assert.match(
        text(f.root),
        status === 401 ? /Sign-in required/ : status === 403 ? /Access denied/ : /CSV unavailable/,
      );
      assert.doesNotMatch(text(f.root), /PRIVATE|CSV export cancelled/);
      const count = f.paths.length;
      retained.listeners.click?.();
      assert.equal(f.paths.length, count);
      assert.equal(f.saves(), 0);
      f.app.dispose();
      f.pending[0]?.resolve(csv());
      await tick();
      assert.equal(f.saves(), 0);
    });
  }
}
