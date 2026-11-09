import assert from 'node:assert/strict';
import test from 'node:test';
import { mountManagementAudit } from '../src/management/sso-audit-app.ts';
import { createManagementSsoAuditWorkspace } from '../src/management/sso-audit-workspace.ts';
import { TokenElement } from './token-management-dom-fixture.ts';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function page(id = '9', next: string | null = null) {
  return Response.json(
    {
      object: 'list',
      data: [
        {
          eventId: id,
          occurredAt: 10,
          kind: 'request-denied',
          requestId: 'request',
          principalId: 'human',
          credentialId: 'credential',
          modelAlias: 'chat',
          policyVersions: [],
          details: { reason: 'invalid-request', modelAlias: 'chat' },
        },
      ],
      next_cursor: next,
    },
    {
      headers: {
        'x-audit-has-more': String(next !== null),
        ...(next ? { 'x-audit-next-cursor': next } : {}),
      },
    },
  );
}

test('retry preserves failed second-page filters/cursor and previous navigation', async () => {
  const paths: string[] = [];
  let fail = false;
  const workspace = createManagementSsoAuditWorkspace({ now: () => 10, schedule: () => () => {} });
  workspace.authorize({
    principalId: 'human',
    expiresAt: 100,
    request: async (path) => {
      paths.push(path);
      if (fail) return new Response(null, { status: 503 });
      return new URL(path, 'https://test.invalid').searchParams.has('cursor')
        ? page('8')
        : page('9', '9');
    },
  });
  await workspace.load({ model: 'chat', requestId: 'request', fromMs: 0, limit: 1 });
  fail = true;
  await workspace.next();
  assert.equal(workspace.snapshot().state, 'unavailable');
  assert.equal(workspace.snapshot().page, undefined);
  const failed = paths.at(-1);
  fail = false;
  await workspace.refresh();
  assert.equal(paths.at(-1), failed);
  assert.equal(workspace.snapshot().page?.events[0]?.eventId, '8');
  assert.equal(workspace.snapshot().canPrevious, true);
  await workspace.previous();
  assert.equal(
    new URL(paths.at(-1) ?? '', 'https://test.invalid').searchParams.has('cursor'),
    false,
  );
  assert.equal(workspace.snapshot().page?.events[0]?.eventId, '9');
  workspace.dispose();
});

test('mounted refresh clears evidence, ignores drafts/busy/stale controls and fails closed on Deny', async () => {
  const root = new TokenElement();
  const paths: string[] = [];
  let held: ((response: Response) => void) | undefined;
  let hold = false;
  const app = mountManagementAudit(root, { now: () => 10, schedule: () => () => {} });
  await app.authorize({
    principalId: 'human',
    expiresAt: 100,
    request: async (path) => {
      paths.push(path);
      if (hold)
        return new Promise<Response>((resolve) => {
          held = resolve;
        });
      if (path.includes('format=csv'))
        return new Response('private-csv', {
          headers: { 'content-type': 'text/csv', 'x-audit-has-more': 'false' },
        });
      return page();
    },
  });
  root.button('Export current page CSV').click();
  await settle();
  assert.match(root.text(), /private-csv/);
  root.named('requestId').value = 'unsubmitted';
  const old = root.button('Refresh current page');
  hold = true;
  old.click();
  assert.doesNotMatch(root.text(), /private-csv|credential/);
  assert.match(root.text(), /Loading audit/);
  const count = paths.length;
  assert.equal(root.button('Refresh current page').attrs.disabled, '');
  root.button('Refresh current page').click();
  old.click();
  assert.equal(paths.length, count);
  assert.equal(
    new URL(paths.at(-1) ?? '', 'https://test.invalid').searchParams.has('request_id'),
    false,
  );
  assert.ok(held);
  held(new Response(null, { status: 403 }));
  await settle();
  assert.match(root.text(), /Access denied/);
  assert.doesNotMatch(root.text(), /Refresh current page|Retry current page|credential/);
  old.click();
  assert.equal(paths.length, count);
  app.dispose();
});

test('expiry during refresh suppresses late response and further reads', async () => {
  let time = 10;
  let resolve!: (response: Response) => void;
  let calls = 0;
  const workspace = createManagementSsoAuditWorkspace({
    now: () => time,
    schedule: () => () => {},
  });
  workspace.authorize({
    principalId: 'human',
    expiresAt: 100,
    request: async () => {
      calls++;
      return calls === 1
        ? page()
        : new Promise<Response>((done) => {
            resolve = done;
          });
    },
  });
  await workspace.load();
  const pending = workspace.refresh();
  time = 100;
  assert.equal(workspace.snapshot().state, 'expired');
  resolve(page());
  await pending;
  await workspace.refresh();
  assert.equal(calls, 2);
  assert.equal(workspace.snapshot().page, undefined);
  workspace.dispose();
});
