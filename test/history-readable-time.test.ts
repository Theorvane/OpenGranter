import assert from 'node:assert/strict';
import test from 'node:test';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { Element, nodes, text, tick } from './account-token-dom-fixture.ts';

function click(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
}
for (const kind of ['Usage', 'Audit'] as const) {
  for (const [occurredAt, expected] of [
    [1795132800123, '2026-11-20T00:00:00.123Z (UTC)'],
    [0, '1970-01-01T00:00:00.000Z (UTC)'],
    [Number.MAX_SAFE_INTEGER, '9007199254740991 Unix ms (UTC unavailable)'],
  ] as const) {
    test(`${kind}: list/detail preserve exact timestamp ${occurredAt}`, async () => {
      const root = new Element();
      let status = 200;
      const app = mountHistoryWorkspace(
        root,
        async () => {
          if (status !== 200) return new Response(null, { status });
          const row =
            kind === 'Audit'
              ? {
                  eventId: '1',
                  occurredAt,
                  kind: 'models-listed',
                  requestId: 'request-1',
                  principalId: 'human',
                  credentialId: 'cred',
                  policyVersions: [],
                  details: { count: 1 },
                }
              : buildUsageRecord({
                  occurredAt,
                  principalId: 'human',
                  credentialId: 'cred',
                  policyVersions: [],
                  requestId: 'request-1',
                  attemptId: 'attempt-1',
                  modelAlias: 'chat',
                  routeKind: 'managed',
                  upstreamModelId: 'upstream',
                  selectedCandidateId: 'candidate',
                  possiblyBilled: false,
                  possibleDuplicate: false,
                  latencyMs: 1,
                  outcome: 'succeeded',
                });
          return Response.json({ object: 'list', data: [row], has_more: false, next_cursor: null });
        },
        { save: () => 'started', dispose() {} },
        'human',
      );
      await tick();
      if (kind === 'Audit') {
        click(root, 'Audit');
        await tick();
      }
      const rendered = text(root);
      assert.equal(
        rendered.split(expected).length - 1,
        2,
        'UTC is visible in both list and detail',
      );
      assert.ok(rendered.includes('Occurred at (Unix ms) ' + occurredAt));
      assert.ok(rendered.includes('request-1'));
      status = 503;
      click(root, 'Refresh current page');
      await tick();
      assert.ok(!text(root).includes(expected), 'failed refresh clears old authorized timestamps');
      status = 200;
      click(root, 'Retry');
      await tick();
      assert.ok(text(root).includes(expected));
      status = 403;
      click(root, 'Refresh current page');
      await tick();
      assert.match(text(root), /Access denied/);
      assert.ok(!text(root).includes(expected));
      app.dispose();
      assert.equal(text(root), '');
    });
  }
}
