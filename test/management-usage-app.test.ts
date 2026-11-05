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
  listeners: Record<string, () => void> = {};
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
  addEventListener(type: string, listener: () => void) {
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
const cursor = Buffer.from(JSON.stringify([2, 'attempt'])).toString('base64url');
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
const response = (rows: unknown[] = [row]) =>
  new Response(
    JSON.stringify({
      object: 'list',
      data: rows,
      has_more: false,
      next_cursor: null,
    }),
    { headers: { 'content-type': 'application/json' } },
  );
async function waitFor(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(check(), 'UI settled');
}
test('disconnected mount, loading, safe text, paging, filters and CSV over actual HTTP', async () => {
  const seen: URLSearchParams[] = [];
  const server = createSsoUsageHistoryServer({
    newRequestId: () => 'trusted',
    usage: {
      async read(_token, _id, query) {
        const params = new URLSearchParams(query);
        seen.push(params);
        if (params.get('format') === 'csv')
          return {
            state: 'ready',
            format: 'csv',
            csv: 'model\r\nchat\r\n',
            hasMore: true,
            nextCursor: cursor,
          };
        return {
          state: 'ready',
          format: 'json',
          data: params.has('cursor') || params.has('model') ? [] : [row],
          hasMore: !params.has('cursor') && !params.has('model'),
          nextCursor: params.has('cursor') || params.has('model') ? null : cursor,
        };
      },
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('no address');
  const root = new Element();
  const app = mountManagementUsage(root);
  assert.match(root.text(), /Sign-in required/);
  assert.equal(seen.length, 0);
  try {
    const loading = app.connect((path, init) =>
      fetch(`http://127.0.0.1:${address.port}${path}`, {
        ...init,
        headers: { ...init.headers, authorization: 'Bearer test-port' },
      }),
    );
    assert.match(root.text(), /Loading usage/);
    await loading;
    assert.match(root.text(), /Unknown/);
    assert.match(root.text(), /<img src=x/);
    assert.equal(
      root.all().some((node) => node.tag === 'img'),
      false,
    );
    root.button('Export current page CSV').click();
    await waitFor(() => root.all().some((node) => node.tag === 'a'));
    const link = root.all().find((node) => node.tag === 'a');
    assert.ok(link?.attrs.href);
    assert.equal(link.attrs.download, 'usage.csv');
    assert.match(await (await fetch(link.attrs.href)).text(), /model/);
    root.button('Next page').click();
    await waitFor(() => root.text().includes('No usage records'));
    assert.equal(seen.at(-1)?.get('cursor'), cursor);
    assert.equal(
      root.all().some((node) => node.tag === 'a'),
      false,
    );
    await assert.rejects(fetch(link.attrs.href));
    const model = root.all().find((node) => node.tag === 'label' && node.textContent === 'Model')
      ?.children[0];
    assert.ok(model);
    model.value = 'chat/a&b';
    root.button('Apply filters').click();
    await waitFor(() => root.text().includes('No usage records'));
    assert.equal(seen.at(-1)?.get('model'), 'chat/a&b');
    assert.equal(seen.at(-1)?.has('cursor'), false);
  } finally {
    app.dispose();
    server.close();
    await once(server, 'close');
  }
});
for (const [status, message] of [
  [400, 'Invalid usage filters'],
  [401, 'Sign-in required'],
  [403, 'Access denied'],
  [503, 'Usage unavailable'],
] as const) {
  test(`HTTP ${status} removes private data and displays safe error`, async () => {
    const root = new Element();
    const app = mountManagementUsage(root);
    await app.connect(async () => response());
    assert.match(root.text(), /human/);
    await app.connect(async () => new Response('secret error', { status }));
    assert.match(root.text(), new RegExp(message));
    assert.doesNotMatch(root.text(), /human|secret error/);
    app.dispose();
  });
}
test('expiry invalidates delayed response; reconnect clears principal data; dispose is final', async () => {
  const root = new Element();
  const app = mountManagementUsage(root);
  let finish: ((response: Response) => void) | undefined;
  let signal: AbortSignal | null | undefined;
  const first = app.connect((_path, init) => {
    signal = init.signal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  app.clear('expired');
  assert.equal(signal?.aborted, true);
  finish?.(response());
  await first;
  assert.match(root.text(), /Session expired/);
  assert.doesNotMatch(root.text(), /human/);
  await app.connect(async () => response([]));
  assert.match(root.text(), /No usage records/);
  app.dispose();
  await app.connect(async () => {
    throw Error('must not fetch');
  });
  assert.equal(root.children.length, 0);
});

test('invalid numeric filters fail locally without displaying stale records', async () => {
  const root = new Element();
  const app = mountManagementUsage(root);
  let requests = 0;
  await app.connect(async () => {
    requests++;
    return response();
  });
  const size = root
    .all()
    .find((node) => node.tag === 'label' && node.textContent === 'Page size (1–100)')?.children[0];
  assert.ok(size);
  size.value = '101';
  root.button('Apply filters').click();
  await waitFor(() => root.text().includes('Invalid usage filters'));
  assert.equal(requests, 1);
  assert.doesNotMatch(root.text(), /human/);
  app.dispose();
});

test('expiry revokes CSV download and clears filter values', async () => {
  const root = new Element();
  const app = mountManagementUsage(root);
  await app.connect(async (path) =>
    path.includes('format=csv')
      ? new Response('model\r\nchat\r\n', {
          headers: { 'content-type': 'text/csv', 'x-usage-has-more': 'false' },
        })
      : response(),
  );
  root.button('Export current page CSV').click();
  await waitFor(() => root.all().some((node) => node.tag === 'a'));
  const url = root.all().find((node) => node.tag === 'a')?.attrs.href;
  assert.ok(url);
  app.clear('expired');
  assert.doesNotMatch(root.text(), /human|Download usage.csv/);
  await assert.rejects(fetch(url));
  app.dispose();
});
