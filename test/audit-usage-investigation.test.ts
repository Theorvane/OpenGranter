import assert from 'node:assert/strict';
import test from 'node:test';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import { Element, nodes, text, tick } from './account-token-dom-fixture.ts';

function click(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
  return node;
}
function input(root: Element, label: string, value: string) {
  const node = nodes(root).find((n) => n.attributes['aria-label'] === label);
  assert.ok(node, label);
  node.value = value;
  node.listeners.input?.();
}
const empty = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
const audit = () =>
  Response.json({
    object: 'list',
    data: [
      {
        eventId: '1',
        occurredAt: 100,
        kind: 'models-listed',
        requestId: 'req:A+1/@x',
        principalId: 'audit-target',
        credentialId: 'old',
        policyVersions: [],
        details: { count: 1 },
      },
    ],
    has_more: false,
    next_cursor: null,
  });
function fixture(status = 200) {
  const root = new Element();
  const paths: string[] = [];
  let resolve: ((response: Response) => void) | undefined;
  let investigationSignal: AbortSignal | undefined;
  const ui = mountHistoryWorkspace(
    root,
    async (path, init) => {
      paths.push(path);
      const url = new URL(path, 'https://local.invalid');
      if (url.pathname.endsWith('/audit')) return audit();
      if (url.searchParams.has('request_id')) {
        investigationSignal = init.signal ?? undefined;
        if (status === 0)
          return new Promise<Response>((r) => {
            resolve = r;
          });
        return status === 200 ? empty() : new Response('PRIVATE', { status });
      }
      return empty();
    },
    { save: () => 'started', dispose() {} },
  );
  return {
    root,
    paths,
    ui,
    signal: () => investigationSignal,
    release() {
      resolve?.(empty());
    },
  };
}
test('Audit request investigation performs fresh self-scoped Usage read without copying Audit target or draft', async () => {
  const f = fixture(0);
  await tick();
  click(f.root, 'Audit');
  await tick();
  input(f.root, 'Principal', 'audit-target');
  click(f.root, 'Apply filters');
  await tick();
  input(f.root, 'Model', 'unsubmitted-audit-draft');
  click(f.root, 'View usage for this request');
  assert.match(text(f.root), /Loading history/);
  assert.doesNotMatch(text(f.root), /audit-target/);
  const q = new URL(f.paths.at(-1) ?? '', 'https://local.invalid').searchParams;
  assert.equal(q.get('request_id'), 'req:A+1/@x');
  for (const key of ['principal_id', 'model', 'cursor']) assert.equal(q.has(key), false);
  f.release();
  await tick();
  assert.match(text(f.root), /No history matches/);
  assert.match(text(f.root), /not proof of no provider call or bill/);
  f.ui.dispose();
});
test('Audit investigation preserves Usage applied target/model/time, discards unsubmitted Usage drafts', async () => {
  const f = fixture();
  await tick();
  input(f.root, 'Principal', 'usage-target');
  input(f.root, 'Model', 'chat');
  input(f.root, 'From (Unix ms, inclusive)', '10');
  input(f.root, 'To (Unix ms, exclusive)', '200');
  click(f.root, 'Apply filters');
  await tick();
  input(f.root, 'Model', 'unsubmitted');
  click(f.root, 'Audit');
  await tick();
  click(f.root, 'View usage for this request');
  await tick();
  const q = new URL(f.paths.at(-1) ?? '', 'https://local.invalid').searchParams;
  assert.equal(q.get('principal_id'), 'usage-target');
  assert.equal(q.get('model'), 'chat');
  assert.equal(q.get('from_ms'), '10');
  assert.equal(q.get('to_ms'), '200');
  const model = nodes(f.root).find((n) => n.attributes['aria-label'] === 'Model');
  assert.equal(model?.value, 'chat');
  f.ui.dispose();
});
for (const status of [401, 403, 503])
  test(`investigation handles fresh HTTP ${status} without raw diagnostics`, async () => {
    const f = fixture(status);
    await tick();
    click(f.root, 'Audit');
    await tick();
    const stale = click(f.root, 'View usage for this request');
    await tick();
    assert.match(
      text(f.root),
      status === 401
        ? /Sign.in required/
        : status === 403
          ? /Access denied/
          : /History unavailable/,
    );
    assert.doesNotMatch(text(f.root), /PRIVATE/);
    const count = f.paths.length;
    stale.listeners.click?.();
    await tick();
    assert.equal(f.paths.length, count);
    f.ui.dispose();
  });
test('detached Audit controls cannot execute after tab change or disposal', async () => {
  const f = fixture();
  await tick();
  click(f.root, 'Audit');
  await tick();
  const stale = nodes(f.root).find((n) => n.textContent === 'View usage for this request');
  assert.ok(stale);
  click(f.root, 'Usage');
  await tick();
  let count = f.paths.length;
  stale.listeners.click?.();
  await tick();
  assert.equal(f.paths.length, count);
  f.ui.dispose();
  count = f.paths.length;
  stale.listeners.click?.();
  await tick();
  assert.equal(f.paths.length, count);
});

test('disposing a pending investigation aborts transport and discards late results', async () => {
  const f = fixture(0);
  await tick();
  click(f.root, 'Audit');
  await tick();
  click(f.root, 'View usage for this request');
  assert.match(text(f.root), /Loading history/);
  f.ui.dispose();
  assert.equal(f.signal()?.aborted, true);
  f.release();
  await tick();
  assert.equal(text(f.root), '');
});

test('refresh invalidates retained Audit investigation controls', async () => {
  const f = fixture();
  await tick();
  click(f.root, 'Audit');
  await tick();
  const stale = nodes(f.root).find((n) => n.textContent === 'View usage for this request');
  assert.ok(stale);
  click(f.root, 'Refresh current page');
  await tick();
  const count = f.paths.length;
  stale.listeners.click?.();
  await tick();
  assert.equal(f.paths.length, count);
  f.ui.dispose();
});

test('invalid applied Usage scope cannot broaden an Audit investigation', async () => {
  const f = fixture();
  await tick();
  input(f.root, 'From (Unix ms, inclusive)', 'invalid');
  click(f.root, 'Apply filters');
  await tick();
  assert.match(text(f.root), /Invalid filters/);
  click(f.root, 'Audit');
  await tick();
  const count = f.paths.length;
  click(f.root, 'View usage for this request');
  await tick();
  assert.match(text(f.root), /Invalid filters/);
  assert.equal(f.paths.length, count);
  f.ui.dispose();
});
