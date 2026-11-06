import assert from 'node:assert/strict';
import test from 'node:test';
import { mountManagementUsage, type UsageElement } from '../src/management/usage-app.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

class Element implements UsageElement {
  textContent: string | null = null;
  value = '';
  children: Element[] = [];
  attrs: Record<string, string> = {};
  listeners: Record<string, (event?: { preventDefault(): void }) => void> = {};
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
  readonly tag: string;
  constructor(tag = 'div') {
    this.tag = tag;
  }
  setAttribute(key: string, value: string) {
    this.attrs[key] = value;
  }
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
  }
  addEventListener(type: string, listener: (event?: { preventDefault(): void }) => void) {
    this.listeners[type] = listener;
  }
  click() {
    this.listeners.click?.();
  }
  focus() {}
  all(): Element[] {
    return [this, ...this.children.flatMap((node) => node.all())];
  }
  text(): string {
    return this.all()
      .map((node) => node.textContent ?? '')
      .join(' ');
  }
  button(text: string) {
    const found = this.all().find((node) => node.tag === 'button' && node.textContent === text);
    assert.ok(found, text);
    return found;
  }
}
const row = (principalId: string, requestId: string, attemptId: string, marked = false) =>
  buildUsageRecord({
    principalId,
    requestId,
    attemptId,
    credentialId: 'credential',
    policyVersions: [],
    modelAlias: '<img src=x onerror=alert(1)>',
    routeKind: 'managed',
    upstreamModelId: 'upstream',
    selectedCandidateId: 'candidate',
    occurredAt: 2,
    latencyMs: 10,
    outcome: 'succeeded',
    possiblyBilled: marked,
    possibleDuplicate: marked,
  });
const records = [
  row('사용자', 'request', 'attempt-1'),
  row('other', 'request', 'attempt-2'),
  row('사용자', 'request', 'attempt-3', true),
  row('사용자', 'request', 'attempt-3', true),
  row('a/b', 'c', 'split-1'),
  row('a', 'b/c', 'split-2'),
];
const response = () =>
  new Response(
    JSON.stringify({
      object: 'list',
      data: records,
      has_more: false,
      next_cursor: null,
    }),
    { headers: { 'content-type': 'application/json' } },
  );

test('ready usage correlates exact principal/request pairs without discarding repeated attempts', async () => {
  const root = new Element();
  const app = mountManagementUsage(root);
  let calls = 0;
  try {
    await app.connect(async () => {
      calls++;
      return response();
    });
    const panel = root
      .all()
      .find((node) => node.attrs['aria-label'] === 'Current page request correlation');
    assert.ok(panel, 'authorized ready page exposes request correlation');
    assert.match(panel.text(), /not complete request history or reconciled billing/);
    const groups = panel.children.filter((node) => node.tag === 'details');
    assert.equal(groups.length, 4, 'neither request-only nor delimiter-based grouping');
    const [first, second] = groups;
    assert.ok(first);
    assert.ok(second);
    assert.match(first.text(), /Principal: 사용자/);
    assert.match(first.text(), /Records on this page: 3; distinct attempt IDs: 2/);
    assert.deepEqual(
      first
        .all()
        .filter((node) => node.tag === 'h3')
        .map((node) => node.textContent),
      ['Attempt: attempt-1', 'Attempt: attempt-3', 'Attempt: attempt-3'],
    );
    assert.match(first.text(), /Server-marked possible duplicate: Yes/);
    assert.match(first.text(), /Possibly billed: Yes/);
    assert.match(first.text(), /Actual inference provider Unknown/);
    assert.match(first.text(), /<img src=x onerror=alert\(1\)>/);
    assert.ok(!panel.all().some((node) => node.tag === 'img'));
    assert.match(second.text(), /Principal: other/);
    assert.ok(!second.text().includes('attempt-3'));
    assert.equal(calls, 1, 'correlation performs no secondary fetch');
    assert.equal(records.length, 6, 'does not mutate input rows');
  } finally {
    app.dispose();
  }
});

test('correlated page is removed during refresh and authority clearing; stale result cannot restore it', async () => {
  const root = new Element();
  const app = mountManagementUsage(root);
  let finish: ((value: Response) => void) | undefined;
  let calls = 0;
  try {
    await app.connect(async () => {
      calls++;
      if (calls === 1) return response();
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    });
    assert.match(root.text(), /Request correlation/);
    root.button('Refresh current page').click();
    assert.match(root.text(), /Loading usage/);
    assert.doesNotMatch(root.text(), /Request correlation/);
    app.clear('denied');
    finish?.(response());
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match(root.text(), /Access denied/);
    assert.doesNotMatch(root.text(), /Request correlation|attempt-3|사용자/);
  } finally {
    app.dispose();
  }
});

test('trusted expiry removes the correlation panel even when the timer was suspended', async () => {
  let now = 0;
  const root = new Element();
  const app = mountManagementUsage(root, { now: () => now, schedule: () => () => {} });
  try {
    await app.authorize({ request: async () => response(), expiresAt: 100 });
    assert.match(root.text(), /Request correlation/);
    now = 100;
    root.button('Refresh current page').click();
    assert.match(root.text(), /Session expired/);
    assert.doesNotMatch(root.text(), /Request correlation|attempt-3|사용자/);
  } finally {
    app.dispose();
  }
});
