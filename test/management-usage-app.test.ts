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
    root.button('Previous page').click();
    await waitFor(() => root.text().includes('Inspect attempt'));
    assert.equal(seen.at(-1)?.has('cursor'), false);
    assert.equal(
      root.all().some((node) => node.textContent === 'Previous page'),
      false,
    );
    root.button('Next page').click();
    await waitFor(() => root.text().includes('No usage records'));
    assert.equal(seen.at(-1)?.get('cursor'), cursor);
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
    signal = init.signal ?? undefined;
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

test('authorized per-attempt details preserve unknowns and clear with identity', async () => {
  const root = new Element();
  const app = mountManagementUsage(root);
  const observed = {
    ...row,
    requestId: '<script>request</script>',
    credentialId: 'NEVER-RENDER-CREDENTIAL',
    attemptId: 'attempt-A',
    actualInferenceProviderId: null,
    usage: { status: 'partial', promptTokens: 0, completionTokens: null, totalTokens: null },
    estimatedCost: {
      amountDecimal: '0.000000000000000001',
      currency: 'USD',
      priceVersion: 'price-v2',
    },
    upstreamBilledCost: {
      amountDecimal: '0.000000000000000002',
      currency: 'USD',
      source: 'direct-provider',
    },
  };
  let calls = 0;
  await app.connect(async () => {
    calls++;
    return response([observed, { ...observed, attemptId: 'attempt-B' }]);
  });
  const details = root.all().filter((node) => node.tag === 'details');
  assert.equal(details.length, 2, 'one native detail for each authorized attempt');
  const first = details[0];
  assert.ok(first);
  assert.match(first.text(), /<script>request<\/script>/u);
  assert.match(first.text(), /attempt-A/u);
  assert.doesNotMatch(first.text(), /attempt-B|NEVER-RENDER-CREDENTIAL/u);
  assert.equal(first.children[0]?.tag, 'summary');
  assert.equal(first.children[0]?.textContent, 'Inspect attempt');
  const fields = new Map(
    first
      .all()
      .filter((node) => node.tag === 'dt')
      .map((node) => {
        const dl = first.children.find((child) => child.tag === 'dl');
        assert.ok(dl);
        return [node.textContent, dl.children[dl.children.indexOf(node) + 1]?.textContent];
      }),
  );
  assert.equal(fields.get('Prompt tokens'), '0');
  assert.equal(fields.get('Completion tokens'), 'Unknown');
  assert.equal(fields.get('Actual inference provider'), 'Unknown');
  assert.equal(fields.get('Estimated price version'), 'price-v2');
  assert.equal(fields.get('Reported billing source'), 'direct-provider');
  assert.equal(fields.get('Latency (ms)'), '10');
  assert.match(root.text(), /0\.000000000000000001 USD/u);
  assert.match(root.text(), /0\.000000000000000002 USD/u);
  assert.equal(calls, 1, 'inspection uses the existing authorized page only');
  app.clear('expired');
  assert.equal(root.all().filter((node) => node.tag === 'details').length, 0);
  assert.doesNotMatch(root.text(), /attempt-A|price-v2|<script>/u);
  app.dispose();
});

test('attempt inspection disappears during reload, HTTP denial, and disposal', async () => {
  const root = new Element();
  const app = mountManagementUsage(root);
  let finish: ((value: Response) => void) | undefined;
  let calls = 0;
  await app.connect(async () => {
    calls++;
    if (calls === 1) return response();
    return await new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  assert.equal(root.all().filter((node) => node.tag === 'details').length, 1);
  assert.match(root.text(), /Unknown/u);
  root.button('Retry / first page').click();
  assert.equal(root.all().filter((node) => node.tag === 'details').length, 0);
  assert.ok(finish);
  finish(new Response(null, { status: 403 }));
  await waitFor(() => root.text().includes('Access denied.'));
  assert.doesNotMatch(root.text(), /attempt|credential|candidate/u);
  await app.connect(async () => response());
  assert.equal(root.all().filter((node) => node.tag === 'details').length, 1);
  app.dispose();
  assert.equal(root.children.length, 0);
});

test('previous navigation refetches opaque queries, preserves CSV scope and resets on filters', async () => {
  const root = new Element();
  const app = mountManagementUsage(root);
  const seen: URL[] = [];
  const second = 'opaque_SECOND_123';
  const third = 'opaque_THIRD_456';
  await app.connect(async (path) => {
    const url = new URL(path, 'http://localhost');
    seen.push(url);
    const current = url.searchParams.get('cursor');
    if (url.searchParams.get('format') === 'csv')
      return new Response(current ?? 'first', {
        headers: { 'content-type': 'text/csv', 'x-usage-has-more': 'false' },
      });
    return new Response(
      JSON.stringify({
        object: 'list',
        data: [{ ...row, attemptId: current ?? 'first' }],
        has_more: current !== third,
        next_cursor: current === third ? null : current === second ? third : second,
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  });
  const hasPrevious = () => root.all().some((node) => node.textContent === 'Previous page');
  assert.equal(hasPrevious(), false);
  root.button('Next page').click();
  await waitFor(() => root.text().includes(second));
  root.button('Next page').click();
  await waitFor(() => root.text().includes(third));
  root.button('Previous page').click();
  assert.doesNotMatch(root.text(), /opaque_THIRD_456/);
  await waitFor(() => root.text().includes(second));
  assert.equal(seen.at(-1)?.searchParams.get('cursor'), second);
  root.button('Export current page CSV').click();
  await waitFor(() => root.all().some((node) => node.tag === 'a'));
  const download = root.all().find((node) => node.tag === 'a')?.attrs.href;
  assert.ok(download);
  assert.equal(await (await fetch(download)).text(), second);
  root.button('Previous page').click();
  await waitFor(() => root.text().includes('Inspect attempt'));
  assert.equal(seen.at(-1)?.searchParams.has('cursor'), false);
  assert.equal(hasPrevious(), false);
  await assert.rejects(fetch(download));
  root.button('Next page').click();
  await waitFor(() => root.text().includes(second));
  root.button('Retry / first page').click();
  await waitFor(() => root.text().includes('Inspect attempt'));
  assert.equal(hasPrevious(), false);
  root.button('Next page').click();
  await waitFor(() => root.text().includes(second));
  root.button('Apply filters').click();
  await waitFor(() => root.text().includes('Inspect attempt'));
  assert.equal(hasPrevious(), false);
  assert.equal(seen.at(-1)?.searchParams.has('cursor'), false);
  app.clear('expired');
  await app.connect(async () => response());
  assert.equal(hasPrevious(), false);
  app.dispose();
});

test('failed pagination and superseded identity cannot restore navigation or old rows', async () => {
  const root = new Element();
  const app = mountManagementUsage(root);
  const hasPrevious = () => root.all().some((node) => node.textContent === 'Previous page');
  let finish: ((value: Response) => void) | undefined;
  let failExport = false;
  const firstPage = () =>
    new Response(
      JSON.stringify({
        object: 'list',
        data: [row],
        has_more: true,
        next_cursor: cursor,
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  await app.connect(async (path) => {
    if (path.includes('format=csv') && failExport) return new Response(null, { status: 503 });
    if (path.includes('cursor=')) return response();
    return firstPage();
  });
  root.button('Next page').click();
  await waitFor(hasPrevious);
  failExport = true;
  root.button('Export current page CSV').click();
  await waitFor(() => root.text().includes('Usage unavailable'));
  assert.equal(hasPrevious(), false);
  assert.doesNotMatch(root.text(), /human/);
  root.button('Retry / first page').click();
  await waitFor(() => root.text().includes('Inspect attempt'));
  assert.equal(hasPrevious(), false);
  await app.connect(async (path) =>
    path.includes('cursor=') ? new Response(null, { status: 503 }) : firstPage(),
  );
  root.button('Next page').click();
  await waitFor(() => root.text().includes('Usage unavailable'));
  assert.equal(hasPrevious(), false);
  await app.connect(async (path) => {
    if (!path.includes('cursor=')) return firstPage();
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  root.button('Next page').click();
  assert.ok(finish);
  app.clear('expired');
  await app.connect(async () => response([]));
  finish(response());
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(root.text(), /No usage records/);
  assert.equal(hasPrevious(), false);
  assert.doesNotMatch(root.text(), /human/);
  app.dispose();
});

test('refresh refetches the current opaque page and preserves previous navigation', async () => {
  const root = new Element();
  const app = mountManagementUsage(root);
  const seen: URL[] = [];
  await app.connect(async (path) => {
    const url = new URL(path, 'http://localhost');
    seen.push(url);
    const second = url.searchParams.has('cursor');
    return new Response(
      JSON.stringify({
        object: 'list',
        data: [{ ...row, attemptId: second ? 'second' : 'first' }],
        has_more: !second,
        next_cursor: second ? null : cursor,
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  });
  root.button('Next page').click();
  await waitFor(() => root.all().some((node) => node.textContent === 'second'));
  const query = seen.at(-1)?.search;
  root.button('Refresh current page').click();
  assert.doesNotMatch(root.text(), /Inspect attempt/u);
  await waitFor(() => root.all().some((node) => node.textContent === 'second'));
  assert.equal(seen.at(-1)?.search, query);
  root.button('Previous page').click();
  await waitFor(() => root.all().some((node) => node.textContent === 'first'));
  assert.equal(seen.at(-1)?.searchParams.has('cursor'), false);
  app.dispose();
});

test('operator cancellation aborts list and discards late success without disconnecting authority', async () => {
  const root = new Element();
  const app = mountManagementUsage(root);
  let finish: ((response: Response) => void) | undefined;
  let signal: AbortSignal | undefined;
  let calls = 0;
  const connecting = app.connect(async (_path, init) => {
    calls++;
    if (calls > 1) return response();
    signal = init.signal ?? undefined;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  assert.match(root.text(), /Loading usage/u);
  root.button('Cancel request').click();
  assert.equal(signal?.aborted, true);
  assert.match(root.text(), /Request cancelled/u);
  assert.doesNotMatch(root.text(), /Inspect attempt/u);
  assert.ok(finish);
  finish(response());
  await connecting;
  assert.match(root.text(), /Request cancelled/u);
  root.button('Retry / first page').click();
  await waitFor(() => root.text().includes('Inspect attempt'));
  assert.equal(calls, 2);
  app.clear('denied');
  assert.match(root.text(), /Access denied/u);
  assert.equal(
    root.all().some((node) => node.textContent === 'Refresh current page'),
    false,
  );
  app.dispose();
});

test('operator cancellation aborts CSV, removes records and ignores late blob creation', async () => {
  const root = new Element();
  const app = mountManagementUsage(root);
  let finish: ((response: Response) => void) | undefined;
  let signal: AbortSignal | undefined;
  await app.connect(async (path, init) => {
    if (!path.includes('format=csv')) return response();
    signal = init.signal ?? undefined;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  root.button('Export current page CSV').click();
  assert.match(root.text(), /Preparing CSV/u);
  root.button('Cancel request').click();
  assert.equal(signal?.aborted, true);
  assert.match(root.text(), /Request cancelled/u);
  assert.ok(finish);
  finish(
    new Response('private late csv', {
      headers: { 'content-type': 'text/csv', 'x-usage-has-more': 'false' },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    root.all().some((node) => node.tag === 'a' || node.tag === 'details'),
    false,
  );
  assert.doesNotMatch(root.text(), /private late csv|Inspect attempt/u);
  app.clear('expired');
  assert.match(root.text(), /Session expired/u);
  app.dispose();
});

function authorityFixture() {
  const root = new Element();
  let time = 1000;
  const jobs: { delay: number; callback: () => void; cancelled: boolean }[] = [];
  const app = mountManagementUsage(root, {
    now: () => time,
    schedule(delay, callback) {
      const job = { delay, callback, cancelled: false };
      jobs.push(job);
      return () => {
        job.cancelled = true;
      };
    },
  });
  return {
    root,
    app,
    jobs,
    setTime: (value: number) => {
      time = value;
    },
  };
}
test('trusted usage grant automatically expires and clears rows, CSV and filters', async () => {
  const f = authorityFixture();
  let calls = 0;
  await f.app.authorize({
    request: async (_path) => {
      calls++;
      return new URLSearchParams(_path.split('?')[1]).get('format') === 'csv'
        ? new Response('private,csv\r\n', {
            headers: { 'content-type': 'text/csv; charset=utf-8', 'x-usage-has-more': 'false' },
          })
        : response();
    },
    expiresAt: 2000,
  });
  assert.match(f.root.text(), /attempt/);
  f.root.button('Export current page CSV').click();
  await waitFor(() => f.root.text().includes('Download usage.csv'));
  const link = f.root.all().find((node) => node.tag === 'a');
  assert.ok(link);
  const url = link.attrs.href;
  assert.ok(url);
  f.setTime(2000);
  f.jobs[0]?.callback();
  assert.match(f.root.text(), /Session expired/);
  assert.doesNotMatch(f.root.text(), /attempt|Download usage.csv/);
  assert.equal(
    f.root.all().some((node) => node.tag === 'input'),
    false,
  );
  await assert.rejects(fetch(url));
  assert.equal(calls, 2);
  f.app.dispose();
});
test('invalid usage grants replace old authority without network work', async () => {
  for (const expiresAt of [NaN, Infinity, 1000, -1, 1000.5]) {
    const f = authorityFixture();
    await f.app.authorize({ request: async () => response(), expiresAt: 2000 });
    await f.app.authorize({
      request: async () => {
        throw Error('must not request');
      },
      expiresAt,
    });
    assert.match(f.root.text(), /Session expired/);
    assert.doesNotMatch(f.root.text(), /attempt/);
    assert.equal(f.jobs[0]?.cancelled, true);
    f.app.dispose();
  }
});
test('suspended timers cannot admit new requests or late JSON at expiry', async () => {
  const f = authorityFixture();
  let release!: (value: Response) => void;
  let signal: AbortSignal | null | undefined;
  const pending = f.app.authorize({
    request: (_path, init) => {
      signal = init.signal ?? undefined;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    expiresAt: 2000,
  });
  f.setTime(2001);
  release(response());
  await pending;
  assert.match(f.root.text(), /Session expired/);
  assert.doesNotMatch(f.root.text(), /attempt/);
  // The response has finished; expiry withholds it rather than claiming network rollback.
  assert.equal(signal?.aborted, false);
  await f.app.authorize({ request: async () => response(), expiresAt: 3000 });
  const refresh = f.root.button('Refresh current page');
  f.setTime(3000);
  refresh.click();
  assert.match(f.root.text(), /Session expired/);
  f.app.dispose();
});
test('usage authority renewal ignores old timers and disposal is terminal', async () => {
  const f = authorityFixture();
  await f.app.authorize({ request: async () => response(), expiresAt: 2000 });
  await f.app.authorize({ request: async () => response([]), expiresAt: 4000 });
  f.setTime(2000);
  f.jobs[0]?.callback();
  assert.doesNotMatch(f.root.text(), /Session expired/);
  assert.equal(f.jobs[0]?.cancelled, true);
  f.app.dispose();
  assert.equal(f.jobs[1]?.cancelled, true);
  await f.app.authorize({
    request: async () => {
      throw Error('disposed');
    },
    expiresAt: 5000,
  });
  assert.equal(f.root.children.length, 0);
});

test('expiry aborts pending work, rejects late CSV and revokes authority', async () => {
  const f = authorityFixture();
  let finish!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  let calls = 0;
  await f.app.authorize({
    request: async (_path, init) => {
      if (++calls === 1) return response();
      signal = init.signal ?? undefined;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    expiresAt: 2000,
  });
  f.root.button('Export current page CSV').click();
  f.setTime(2000);
  f.jobs[0]?.callback();
  assert.equal(signal?.aborted, true);
  finish(
    new Response('private,csv', {
      headers: { 'content-type': 'text/csv', 'x-usage-has-more': 'false' },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(f.root.text(), /Session expired/);
  assert.doesNotMatch(f.root.text(), /Download usage.csv/);
  f.app.dispose();
});
test('suspended timer cannot publish CSV consumed after deadline', async () => {
  const f = authorityFixture();
  let calls = 0;
  let body!: ReadableStreamDefaultController<Uint8Array>;
  await f.app.authorize({
    request: async () => {
      if (++calls === 1) return response();
      return new Response(
        new ReadableStream({
          start(controller) {
            body = controller;
          },
        }),
        {
          headers: { 'content-type': 'text/csv', 'x-usage-has-more': 'false' },
        },
      );
    },
    expiresAt: 2000,
  });
  f.root.button('Export current page CSV').click();
  await waitFor(() => body !== undefined);
  f.setTime(2000);
  body.enqueue(new TextEncoder().encode('private,csv'));
  body.close();
  await waitFor(() => f.root.text().includes('Session expired'));
  assert.doesNotMatch(f.root.text(), /Download usage.csv/);
  f.app.dispose();
});
test('usage deadlines bound long timers, rearm early callbacks and cancel on denial', async () => {
  const f = authorityFixture();
  await f.app.authorize({ request: async () => response(), expiresAt: Number.MAX_SAFE_INTEGER });
  assert.equal(f.jobs[0]?.delay, 2147483647);
  f.jobs[0]?.callback();
  assert.equal(f.jobs[1]?.delay, 2147483647);
  await f.app.authorize({
    request: async () => new Response(null, { status: 403 }),
    expiresAt: 3000,
  });
  assert.match(f.root.text(), /Access denied/);
  assert.equal(f.jobs[2]?.cancelled, true);
  f.setTime(4000);
  f.jobs[2]?.callback();
  assert.match(f.root.text(), /Access denied/);
  f.app.dispose();
});
test('new usage authority rejects old in-flight response and stale callbacks', async () => {
  const f = authorityFixture();
  let finish!: (response: Response) => void;
  const pending = f.app.authorize({
    request: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    expiresAt: 2000,
  });
  await f.app.authorize({ request: async () => response([]), expiresAt: 4000 });
  finish(response());
  await pending;
  f.setTime(2000);
  f.jobs[0]?.callback();
  assert.doesNotMatch(f.root.text(), /attempt|Session expired/);
  f.app.clear('unauthenticated');
  assert.equal(f.jobs[1]?.cancelled, true);
  f.app.dispose();
});

test('deadline crossing during authorize cannot reconnect after expiry clear', async () => {
  const root = new Element();
  let reads = 0;
  let clockReads = 0;
  const app = mountManagementUsage(root, {
    now: () => (++clockReads === 1 ? 1000 : 2000),
    schedule: () => {
      throw Error('must not schedule expired grant');
    },
  });
  await app.authorize({
    request: async () => {
      reads++;
      return response();
    },
    expiresAt: 2000,
  });
  assert.match(root.text(), /Session expired/);
  assert.equal(reads, 0);
  app.dispose();
});

test('explicit CSV continuation preserves opaque cursor and JSON page, revokes URLs and stops at exhaustion', async () => {
  const root = new Element();
  const app = mountManagementUsage(root);
  const requests: URLSearchParams[] = [];
  const csvCursor = 'opaque_CSV-2';
  const nextCursor = 'opaque_CSV-3';
  try {
    await app.connect(async (path) => {
      const query = new URL(path, 'http://localhost').searchParams;
      requests.push(query);
      if (query.get('format') !== 'csv') return response();
      const current = query.get('cursor');
      return new Response('model\r\npage\r\n', {
        headers: {
          'content-type': 'text/csv',
          'x-usage-has-more': String(current !== nextCursor),
          ...(current === nextCursor
            ? {}
            : { 'x-usage-next-cursor': current === csvCursor ? nextCursor : csvCursor }),
        },
      });
    });
    root.button('Export current page CSV').click();
    await waitFor(() => root.text().includes('Download usage.csv'));
    const old = root.all().find((node) => node.tag === 'a')?.attrs.href;
    assert.ok(old);
    root.button('Export next CSV page').click();
    await waitFor(() => root.text().includes('Download usage.csv'));
    await assert.rejects(fetch(old));
    root.button('Export next CSV page').click();
    await waitFor(() => root.text().includes('Download usage.csv'));
    assert.ok(!root.all().some((n) => n.textContent === 'Export next CSV page'));
    assert.deepEqual(
      requests.filter((q) => q.get('format') === 'csv').map((q) => q.get('cursor')),
      [null, csvCursor, nextCursor],
    );
    assert.equal(requests.filter((q) => q.get('format') === 'json').length, 1);
    root.button('Export current page CSV').click();
    await waitFor(() => root.text().includes('Download usage.csv'));
    assert.equal(requests.at(-1)?.get('cursor'), null);
    root.button('Refresh current page').click();
    await waitFor(
      () =>
        root.text().includes('No usage records') === false &&
        root.text().includes('Export current page CSV'),
    );
    assert.ok(!root.all().some((n) => n.textContent === 'Export next CSV page'));
    assert.ok(!root.text().includes('Download usage.csv'));
  } finally {
    app.dispose();
  }
});

test('CSV continuation denial clears export authority and late cancelled page cannot restore a download', async () => {
  for (const mode of ['denied', 'cancelled'] as const) {
    const root = new Element();
    const app = mountManagementUsage(root);
    let pending: ((response: Response) => void) | undefined;
    let signal: AbortSignal | undefined;
    try {
      await app.connect(async (path, init) => {
        const query = new URL(path, 'http://localhost').searchParams;
        if (query.get('format') !== 'csv') return response();
        if (!query.has('cursor'))
          return new Response('a\r\n', {
            headers: {
              'content-type': 'text/csv',
              'x-usage-has-more': 'true',
              'x-usage-next-cursor': 'exact_opaque',
            },
          });
        if (mode === 'denied') return new Response(null, { status: 403 });
        signal = init.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          pending = resolve;
        });
      });
      root.button('Export current page CSV').click();
      await waitFor(() => root.text().includes('Download usage.csv'));
      root.button('Export next CSV page').click();
      if (mode === 'denied') await waitFor(() => root.text().includes('Access denied'));
      else {
        await waitFor(() => pending !== undefined);
        root.button('Cancel request').click();
        assert.equal(signal?.aborted, true);
        pending?.(
          new Response('late\r\n', {
            headers: { 'content-type': 'text/csv', 'x-usage-has-more': 'false' },
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.match(root.text(), /cancelled/);
      }
      assert.ok(!root.text().includes('Download usage.csv'));
      assert.ok(!root.all().some((n) => n.textContent === 'Export next CSV page'));
    } finally {
      app.dispose();
    }
  }
});

test('loopback HTTP CSV continuation keeps filters; filter changes retire old controls', async () => {
  const seen: URLSearchParams[] = [];
  const server = createSsoUsageHistoryServer({
    newRequestId: () => 'csv-ui-request',
    usage: {
      async read(_token, _id, query) {
        const params = new URLSearchParams(query);
        seen.push(params);
        if (params.get('format') === 'csv')
          return {
            state: 'ready',
            format: 'csv',
            csv: 'model\r\nchat\r\n',
            hasMore: !params.has('cursor'),
            nextCursor: params.has('cursor') ? null : cursor,
          };
        return { state: 'ready', format: 'json', data: [], hasMore: false, nextCursor: null };
      },
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const root = new Element();
  const app = mountManagementUsage(root);
  const change = (label: string, value: string) => {
    const input = root.all().find((n) => n.tag === 'label' && n.textContent === label)?.children[0];
    assert.ok(input);
    input.value = value;
  };
  try {
    await app.connect((path, init) =>
      fetch('http://127.0.0.1:' + address.port + path, {
        ...init,
        headers: { ...init.headers, authorization: 'Bearer isolated-http-port' },
      }),
    );
    change('Model', 'team/a&b');
    change('Principal ID', 'human');
    change('From (UTC)', '1970-01-01T00:00:00.001');
    change('To (UTC, exclusive)', '1970-01-01T00:00:00.099');
    change('Page size (1–100)', '2');
    root.button('Apply filters').click();
    await waitFor(() => root.text().includes('Export current page CSV'));
    root.button('Export current page CSV').click();
    await waitFor(() => root.text().includes('Download usage.csv'));
    root.button('Export next CSV page').click();
    await waitFor(() => root.text().includes('Download usage.csv'));
    const pages = seen.filter((q) => q.get('format') === 'csv');
    assert.equal(pages.length, 2);
    assert.ok(pages[0] && pages[1]);
    assert.equal(pages[0].has('cursor'), false);
    assert.equal(pages[1].get('cursor'), cursor);
    for (const page of pages) {
      assert.equal(page.get('model'), 'team/a&b');
      assert.equal(page.get('principal_id'), 'human');
      assert.equal(page.get('from_ms'), '1');
      assert.equal(page.get('to_ms'), '99');
      assert.equal(page.get('limit'), '2');
    }
    root.button('Export current page CSV').click();
    await waitFor(() => root.text().includes('Download usage.csv'));
    const detached = root.button('Export next CSV page');
    change('Model', 'other');
    root.button('Apply filters').click();
    await waitFor(() => root.text().includes('Export current page CSV'));
    const count = seen.length;
    detached.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(seen.length, count);
    assert.ok(!root.text().includes('Download usage.csv'));
    root.button('Export current page CSV').click();
    await waitFor(() => root.text().includes('Download usage.csv'));
    assert.equal(seen.at(-1)?.get('model'), 'other');
    assert.equal(seen.at(-1)?.has('cursor'), false);
  } finally {
    app.dispose();
    server.close();
    await once(server, 'close');
  }
});

test('UTC range controls reject impossible dates before HTTP and clear old records', async () => {
  const root = new Element();
  const app = mountManagementUsage(root);
  let calls = 0;
  await app.connect(async () => {
    calls++;
    return response();
  });
  const input = root.all().find((node) => node.tag === 'label' && node.textContent === 'From (UTC)')
    ?.children[0];
  assert.ok(input);
  assert.equal(input.attrs.type, 'datetime-local');
  assert.equal(input.attrs.step, '0.001');
  assert.match(root.text(), /1970-01-01T00:00:00.002Z/);
  input.value = '2023-02-29T00:00';
  root.button('Apply filters').click();
  await waitFor(() => root.text().includes('Invalid usage filters'));
  assert.equal(calls, 1);
  assert.doesNotMatch(root.text(), /Inspect attempt|<img/);
  app.dispose();
});
