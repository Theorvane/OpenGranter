import assert from 'node:assert/strict';
import test from 'node:test';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { Element, nodes, text, tick } from './account-token-dom-fixture.ts';

function control(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  return node;
}
function click(root: Element, label: string) {
  control(root, label).listeners.click?.();
}
function field(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'input' && n.attributes['aria-label'] === label);
  assert.ok(node, label);
  return node;
}
function edit(root: Element, label: string, value: string) {
  const input = field(root, label);
  input.value = value;
  input.listeners.input?.();
  return input;
}
const page = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
function records(audit: boolean, more: boolean) {
  const occurredAt = Date.parse('2026-11-20T00:00:00.000Z') + (more ? 100 : 99);
  const row = audit
    ? {
        eventId: more ? '2' : '1',
        occurredAt,
        kind: 'route-unavailable',
        requestId: 'req',
        principalId: 'target',
        credentialId: 'cred',
        policyVersions: [],
        details: { modelAlias: 'model/a' },
      }
    : buildUsageRecord({
        principalId: 'target',
        credentialId: 'cred',
        policyVersions: [],
        requestId: 'req',
        attemptId: more ? 'a' : 'b',
        occurredAt,
        modelAlias: '모델/+ &',
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
    has_more: more,
    next_cursor: more
      ? audit
        ? '2'
        : Buffer.from(JSON.stringify([occurredAt, 'a'])).toString('base64url')
      : null,
  });
}
for (const kind of ['Usage', 'Audit'] as const) {
  test(
    kind + ': discard restores submitted scope locally and keeps CSV and the other tab draft',
    async () => {
      const root = new Element();
      const model = kind === 'Audit' ? 'model/a' : '모델/+ &';
      const paths: string[] = [];
      const saved: string[] = [];
      const app = mountHistoryWorkspace(
        root,
        async (path, init) => {
          paths.push(path);
          if (new Headers(init.headers).get('accept') === 'text/csv')
            return new Response('header\n', {
              headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
            });
          return records(
            path.includes('audit'),
            !new URL(path, 'http://localhost').searchParams.has('cursor'),
          );
        },
        {
          save: (_kind, csv) => {
            saved.push(csv);
            return 'started';
          },
          dispose() {},
        },
        'target',
      );
      await tick();
      if (kind === 'Audit') {
        click(root, kind);
        await tick();
      }
      edit(root, 'Model', model);
      edit(root, 'Request ID', 'req');
      edit(root, 'From (UTC or Unix ms, inclusive)', '2026-11-20T00:00:00.000Z');
      edit(root, 'Page size (1–100, blank for default)', '7');
      click(root, 'Apply filters');
      await tick();
      click(root, 'Next page');
      await tick();
      const currentCursor = new URL(paths.at(-1) ?? '', 'http://localhost').searchParams.get(
        'cursor',
      );
      assert.ok(currentCursor);
      const other = kind === 'Usage' ? 'Audit' : 'Usage';
      click(root, other);
      await tick();
      edit(root, 'Model', 'other-private');
      click(root, kind);
      await tick();
      const stale = edit(root, 'Principal', '');
      edit(root, 'Model', 'not-applied');
      edit(root, 'Request ID', 'wrong');
      edit(root, 'From (UTC or Unix ms, inclusive)', 'invalid');
      edit(root, 'Page size (1–100, blank for default)', '0');
      const before = paths.length;
      const retired = control(root, 'Discard filter edits');
      assert.equal(retired.attributes.type, 'button');
      retired.listeners.click?.();
      assert.equal(paths.length, before, 'discard is local, not a fresh query');
      assert.equal(stale.value, '', 'detached input scrubbed');
      assert.equal(field(root, 'Principal').value, 'target');
      assert.equal(field(root, 'Model').value, model);
      assert.equal(field(root, 'Request ID').value, 'req');
      assert.equal(
        field(root, 'From (UTC or Unix ms, inclusive)').value,
        String(Date.parse('2026-11-20T00:00:00.000Z')),
      );
      assert.equal(field(root, 'Page size (1–100, blank for default)').value, '7');
      assert.doesNotMatch(text(root), /Unapplied filter edits/);
      assert.match(text(root), /1 records shown/);
      edit(root, 'Model', 'new-draft');
      retired.listeners.click?.();
      assert.equal(
        field(root, 'Model').value,
        'new-draft',
        'retired button cannot overwrite a new draft',
      );
      click(root, 'Download current page CSV');
      await tick();
      assert.equal(saved.length, 1);
      const query = new URL(paths.at(-1) ?? '', 'http://localhost').searchParams;
      assert.equal(query.get('principal_id'), 'target');
      assert.equal(query.get('model'), model);
      assert.equal(query.get('request_id'), 'req');
      assert.equal(query.get('limit'), '7');
      assert.equal(
        query.get('cursor'),
        currentCursor,
        'discard preserves the current opaque page cursor',
      );
      click(root, other);
      await tick();
      assert.equal(field(root, 'Model').value, 'other-private');
      app.dispose();
    },
  );
  test(
    kind + ': discard does not abort pending JSON or CSV and terminal actions stay retired',
    async () => {
      const root = new Element();
      let pending: ((value: Response) => void) | undefined;
      let signal: AbortSignal | null | undefined;
      let hold = false;
      let csv = false;
      let count = 0;
      let saves = 0;
      let denied = false;
      const app = mountHistoryWorkspace(
        root,
        async (_path, init) => {
          count++;
          if (denied) return new Response(null, { status: 403 });
          if (hold && (new Headers(init.headers).get('accept') === 'text/csv') === csv) {
            signal = init.signal;
            return new Promise<Response>((resolve) => {
              pending = resolve;
            });
          }
          return page();
        },
        {
          save: () => {
            saves++;
            return 'started';
          },
          dispose() {},
        },
        'target',
      );
      await tick();
      if (kind === 'Audit') {
        click(root, kind);
        await tick();
      }
      for (csv of [false, true]) {
        hold = true;
        pending = undefined;
        click(root, csv ? 'Download current page CSV' : 'Refresh current page');
        assert.ok(pending);
        edit(root, 'Principal', 'private-draft');
        const before = count;
        click(root, 'Discard filter edits');
        assert.equal(count, before);
        assert.equal(signal?.aborted, false);
        assert.equal(field(root, 'Principal').value, 'target');
        const complete: (value: Response) => void = pending;
        hold = false;
        complete(
          csv
            ? new Response('header\n', {
                headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
              })
            : page(),
        );
        await tick();
        assert.match(text(root), /No history matches/);
      }
      assert.equal(saves, 1);
      const stale = control(root, 'Discard filter edits');
      denied = true;
      click(root, 'Refresh current page');
      await tick();
      const before = count;
      stale.listeners.click?.();
      assert.equal(count, before);
      assert.match(text(root), /Access denied/);
      assert.ok(!nodes(root).some((n) => n.tag === 'input'));
      app.dispose();
      stale.listeners.click?.();
      assert.equal(text(root), '');
    },
  );
}
