import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createSsoUsageHistoryServer } from '../src/gateway/sso-usage-history-http.ts';
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
const row = buildUsageRecord({
  principalId: 'human',
  credentialId: 'credential',
  policyVersions: [],
  requestId: 'req',
  attemptId: 'attempt',
  modelAlias: '<img src=x onerror=alert(1)>',
  routeKind: 'managed',
  upstreamModelId: 'model',
  selectedCandidateId: 'candidate',
  occurredAt: 2,
  latencyMs: 10,
  outcome: 'succeeded',
  possiblyBilled: true,
  possibleDuplicate: false,
});
const response = () =>
  new Response(JSON.stringify({ object: 'list', data: [], has_more: false, next_cursor: null }), {
    headers: { 'content-type': 'application/json' },
  });
async function waitFor(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(check(), 'UI settled');
}

test('browser CSV allocation failure is private, recoverable and reauthorized over HTTP', async (t) => {
  const seen: string[] = [];
  const server = createSsoUsageHistoryServer({
    newRequestId: () => 'trusted',
    usage: {
      async read(_token, _id, query) {
        seen.push(query);
        if (new URLSearchParams(query).get('format') === 'csv')
          return {
            state: 'ready',
            format: 'csv',
            csv: 'private-csv',
            hasMore: false,
            nextCursor: null,
          };
        return { state: 'ready', format: 'json', data: [row], hasMore: false, nextCursor: null };
      },
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const root = new Element();
  const app = mountManagementUsage(root);
  const original = URL.createObjectURL;
  let fail = true;
  t.mock.method(URL, 'createObjectURL', (blob: Blob) => {
    if (fail) throw Error('private-browser-error');
    return original(blob);
  });
  try {
    await app.connect((path, init) =>
      fetch('http://127.0.0.1:' + address.port + path, {
        ...init,
        headers: { ...init.headers, authorization: 'Bearer test-port' },
      }),
    );
    const request = root
      .all()
      .find((node) => node.tag === 'label' && node.textContent === 'Request ID')?.children[0];
    assert.ok(request);
    request.value = 'req';
    root.button('Apply filters').click();
    await waitFor(() => seen.length === 2 && root.text().includes('human'));
    root.button('Export current page CSV').click();
    await waitFor(() => root.text().includes('Usage unavailable'));
    assert.doesNotMatch(root.text(), /Preparing CSV|human|private-csv|private-browser-error/);
    assert.equal(
      root.all().some((node) => node.tag === 'a'),
      false,
    );
    fail = false;
    root.button('Retry current page').click();
    await waitFor(() => root.text().includes('human'));
    root.button('Export current page CSV').click();
    await waitFor(() => root.text().includes('Download usage.csv'));
    assert.equal(seen.length, 5);
    assert.equal(new URLSearchParams(seen[3]).get('format'), 'json');
    assert.equal(new URLSearchParams(seen[3]).get('request_id'), 'req');
  } finally {
    app.dispose();
    server.close();
    await once(server, 'close');
  }
});

test('throwing URL revocation cannot interrupt authority cleanup or revive detached download', async (t) => {
  const root = new Element();
  const app = mountManagementUsage(root);
  const transport = async (path: string) =>
    path.includes('format=csv')
      ? new Response('private-csv', {
          headers: { 'content-type': 'text/csv', 'x-usage-has-more': 'false' },
        })
      : response();
  await app.connect(transport);
  root.button('Export current page CSV').click();
  await waitFor(() => root.text().includes('Download usage.csv'));
  const download = root.all().find((node) => node.tag === 'a');
  assert.ok(download);
  const url = download.attrs.href;
  const original = URL.revokeObjectURL;
  t.mock.method(URL, 'revokeObjectURL', () => {
    throw Error('private-revoke-error');
  });
  try {
    assert.doesNotThrow(() => app.clear('expired'));
    assert.match(root.text(), /Session expired/);
    assert.doesNotMatch(root.text(), /private-csv|private-revoke-error/);
    for (const type of ['click', 'auxclick', 'contextmenu']) {
      let prevented = false;
      download.listeners[type]?.({
        preventDefault() {
          prevented = true;
        },
      });
      assert.equal(prevented, true);
    }
    await app.connect(async () => response());
    assert.match(root.text(), /No usage records/);
  } finally {
    app.dispose();
    if (url) original(url);
  }
});
