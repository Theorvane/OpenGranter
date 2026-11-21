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
function input(root: Element, label: string, value?: string) {
  const node = nodes(root).find((n) => n.attributes['aria-label'] === label);
  assert.ok(node, label);
  if (value !== undefined) node.value = value;
  return node;
}
const empty = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });

test('clear filters recovers invalid drafts and resets only the active tab with fresh authorization', async () => {
  const root = new Element();
  const calls: string[] = [];
  const ui = mountHistoryWorkspace(
    root,
    async (path) => {
      calls.push(path);
      return empty();
    },
    { save: () => 'started', dispose() {} },
    'human/exact',
  );
  await tick();
  input(root, 'From (UTC or Unix ms, inclusive)', 'invalid');
  input(root, 'Model', 'chat');
  click(root, 'Apply filters');
  await tick();
  assert.match(text(root), /Invalid filters/);
  assert.equal(calls.length, 1);
  const retained = input(root, 'Model');
  const stale = click(root, 'Clear filters');
  await tick();
  assert.equal(calls.at(-1), '/management/v1/usage?format=json');
  for (const label of [
    'Principal',
    'Model',
    'From (UTC or Unix ms, inclusive)',
    'To (UTC or Unix ms, exclusive)',
    'Request ID',
  ])
    assert.equal(input(root, label).value, '');
  assert.equal(retained.value, '');
  assert.match(text(root), /No history matches/);
  click(root, 'Audit');
  await tick();
  assert.equal(input(root, 'Principal').value, 'human/exact');
  assert.match(calls.at(-1) ?? '', /principal_id=human%2Fexact/);
  click(root, 'Clear filters');
  await tick();
  assert.equal(calls.at(-1), '/management/v1/audit?format=json');
  const count = calls.length;
  stale.listeners.click?.();
  await tick();
  assert.equal(calls.length, count);
  ui.dispose();
});

test('clear filters cancels pending CSV and cannot dispatch retained controls after disposal', async () => {
  const root = new Element();
  let finish: ((response: Response) => void) | undefined;
  let exportSignal: AbortSignal | undefined;
  let saved = 0;
  const calls: string[] = [];
  const ui = mountHistoryWorkspace(
    root,
    async (path, init) => {
      calls.push(path);
      if (path.includes('format=csv')) {
        exportSignal = init.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      return empty();
    },
    {
      save: () => {
        saved++;
        return 'started';
      },
      dispose() {},
    },
  );
  await tick();
  click(root, 'Download current page CSV');
  await tick();
  assert.ok(finish);
  const stale = click(root, 'Clear filters');
  assert.equal(exportSignal?.aborted, true);
  await tick();
  finish(new Response('private csv', { headers: { 'content-type': 'text/csv' } }));
  await tick();
  assert.equal(saved, 0);
  assert.equal(calls.at(-1), '/management/v1/usage?format=json');
  ui.dispose();
  const count = calls.length;
  stale.listeners.click?.();
  assert.equal(calls.length, count);
  assert.equal(text(root), '');
});

for (const status of [401, 403])
  test(`reset request still enforces ${status} and clears both histories`, async () => {
    const root = new Element();
    let calls = 0;
    let released = 0;
    mountHistoryWorkspace(
      root,
      async () => (++calls === 1 ? empty() : new Response('PRIVATE', { status })),
      {
        save: () => 'started',
        dispose() {
          released++;
        },
      },
    );
    await tick();
    const stale = click(root, 'Clear filters');
    await tick();
    assert.match(text(root), status === 401 ? /Sign-in required/ : /Access denied/);
    assert.doesNotMatch(text(root), /PRIVATE/);
    assert.equal(released, 1);
    stale.listeners.click?.();
    assert.equal(calls, 2);
  });
