import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

class Element implements CatalogElement {
  textContent: string | null = null;
  value = '';
  children: Element[] = [];
  attributes: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
  readonly tag: string;
  constructor(tag = 'div') {
    this.tag = tag;
  }
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners[type] = listener;
  }
  focus() {}
}
const nodes = (root: Element): Element[] => [root, ...root.children.flatMap(nodes)];
const text = (root: Element) =>
  nodes(root)
    .map((n) => n.textContent ?? '')
    .join(' ');
function click(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
}
function input(root: Element, name: string, value: string) {
  const node = nodes(root).find((n) => n.attributes['aria-label'] === name);
  assert.ok(node, name);
  node.value = value;
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function page(audit = false, more = false) {
  const row = audit
    ? {
        eventId: '1',
        occurredAt: 100,
        kind: 'models-listed',
        requestId: 'req',
        principalId: 'human',
        credentialId: 'cred',
        policyVersions: [],
        details: { count: 1, prompt: 'PRIVATE' },
      }
    : buildUsageRecord({
        principalId: 'human',
        credentialId: 'cred',
        policyVersions: [],
        requestId: 'req',
        attemptId: 'a',
        occurredAt: 100,
        modelAlias: ' modèle/한글 + &x=1 ',
        routeKind: 'managed',
        upstreamModelId: 'upstream',
        selectedCandidateId: 'candidate',
        latencyMs: 1,
        outcome: 'succeeded',
        possiblyBilled: true,
        possibleDuplicate: true,
        estimatedCost: {
          amountDecimal: '9007199254740993.0000000001',
          currency: 'USD',
          priceVersion: 'v1',
        },
      });
  return Response.json({
    object: 'list',
    data: [row],
    has_more: more,
    next_cursor: more ? Buffer.from(JSON.stringify([100, 'a'])).toString('base64url') : null,
  });
}
function downloads() {
  const saved: [string, string][] = [];
  let disposed = 0;
  return {
    saved,
    get disposed() {
      return disposed;
    },
    save(kind: 'usage' | 'audit', csv: string) {
      saved.push([kind, csv]);
      return 'started' as const;
    },
    dispose() {
      disposed++;
    },
  };
}

const model = ' modèle/한글 + &x=1 ';
function params(path: string | undefined) {
  assert.ok(path);
  return new URL(path, 'https://test.invalid').searchParams;
}
function action(root: Element) {
  const node = nodes(root).find(
    (n) => n.tag === 'button' && n.textContent === 'View usage for this model',
  );
  assert.ok(node, 'canonical model drilldown button');
  return node;
}
test('model drilldown preserves applied scope and exact Unicode, not unapplied edits', async () => {
  const root = new Element();
  const paths: string[] = [];
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      return page();
    },
    downloads(),
    'human',
  );
  await tick();
  input(root, 'Request ID', 'req');
  input(root, 'From (UTC or Unix ms, inclusive)', '10');
  input(root, 'To (UTC or Unix ms, exclusive)', '200');
  click(root, 'Apply filters');
  await tick();
  input(root, 'Principal', 'unapplied-other');
  nodes(root)
    .find((n) => n.attributes['aria-label'] === 'Principal')
    ?.listeners.input?.();
  action(root).listeners.click?.();
  assert.match(text(root), /Loading/);
  await tick();
  const query = params(paths.at(-1));
  assert.equal(query.get('model'), model);
  assert.equal(
    nodes(root).find((n) => n.attributes['aria-label'] === 'Principal')?.value,
    'unapplied-other',
    'model drilldown retains unrelated draft without using it as authority',
  );
  assert.match(text(root), /Unapplied filter edits/);
  assert.equal(query.get('principal_id'), 'human');
  assert.equal(query.get('request_id'), 'req');
  assert.equal(query.get('from_ms'), '10');
  assert.equal(query.get('to_ms'), '200');
  assert.equal(query.has('cursor'), false);
  assert.equal(nodes(root).find((n) => n.attributes['aria-label'] === 'Model')?.value, model);
  assert.equal(
    nodes(root).some((n) => n.tag === 'script'),
    false,
  );
  app.dispose();
});
test('self model drilldown resets page cursor and keeps model for paging and CSV', async () => {
  const root = new Element();
  const paths: string[] = [];
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      if (params(path).get('format') === 'csv')
        return new Response('attempt_id\na', { headers: { 'content-type': 'text/csv' } });
      if (params(path).has('cursor'))
        return Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
      return page(false, true);
    },
    downloads(),
  );
  await tick();
  const old = action(root);
  old.listeners.click?.();
  await tick();
  assert.equal(params(paths.at(-1)).has('principal_id'), false);
  const count = paths.length;
  old.listeners.click?.();
  assert.equal(paths.length, count, 'detached action is inert');
  click(root, 'Download current page CSV');
  await tick();
  assert.equal(params(paths.at(-1)).get('model'), model);
  click(root, 'Next page');
  await tick();
  assert.equal(params(paths.at(-1)).get('model'), model);
  assert.equal(params(paths.at(-1)).has('cursor'), true);
  assert.match(text(root), /No history matches/);
  click(root, 'Previous page');
  await tick();
  action(root).listeners.click?.();
  await tick();
  assert.equal(params(paths.at(-1)).has('cursor'), false);
  assert.equal(nodes(root).find((n) => n.textContent === 'Previous page')?.attributes.disabled, '');
  app.dispose();
});
for (const status of [401, 403, 503]) {
  test(`model drilldown clears rows on HTTP ${status} and terminal controls stay inert`, async () => {
    const root = new Element();
    const paths: string[] = [];
    let fail = false;
    const app = mountHistoryWorkspace(
      root,
      async (path) => {
        paths.push(path);
        return fail ? new Response(null, { status }) : page();
      },
      downloads(),
    );
    await tick();
    const old = action(root);
    fail = true;
    old.listeners.click?.();
    await tick();
    assert.doesNotMatch(text(root), /9007199254740993/);
    assert.match(
      text(root),
      status === 401
        ? /Sign-in required/
        : status === 403
          ? /Access denied/
          : /History unavailable/,
    );
    const count = paths.length;
    old.listeners.click?.();
    assert.equal(paths.length, count);
    if (status === 503) {
      fail = false;
      click(root, 'Retry');
      await tick();
      assert.equal(params(paths.at(-1)).get('model'), model);
      assert.match(text(root), /records shown/);
    }
    app.dispose();
    old.listeners.click?.();
    assert.equal(root.children.length, 0);
  });
}
test('model drilldown leaves audit filters independent and disposed current control inert', async () => {
  const root = new Element();
  const paths: string[] = [];
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      return page(path.includes('/audit?'));
    },
    downloads(),
  );
  await tick();
  action(root).listeners.click?.();
  await tick();
  click(root, 'Audit');
  await tick();
  assert.equal(params(paths.at(-1)).has('model'), false);
  click(root, 'Usage');
  await tick();
  assert.equal(params(paths.at(-1)).get('model'), model);
  const current = action(root);
  const count = paths.length;
  app.dispose();
  current.listeners.click?.();
  assert.equal(paths.length, count);
});
