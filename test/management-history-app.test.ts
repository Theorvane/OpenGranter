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
        modelAlias: '<script>chat</script>',
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
test('history mount connects actual clients to filters, tabs and exact usage metadata', async () => {
  const root = new Element();
  const paths: string[] = [];
  const download = downloads();
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      return page(path.includes('/audit?'));
    },
    download,
  );
  assert.match(text(root), /Loading/);
  await tick();
  assert.match(text(root), /9007199254740993.0000000001 USD/);
  assert.match(text(root), /Reported cost: Unknown/);
  assert.match(text(root), /Possible duplicate/);
  assert.match(text(root), /Usage: missing/);
  assert.equal(
    nodes(root).some((n) => n.tag === 'script'),
    false,
  );
  input(root, 'Principal', 'alice');
  input(root, 'Model', 'chat');
  input(root, 'From (Unix ms, inclusive)', '10');
  input(root, 'To (Unix ms, exclusive)', '20');
  click(root, 'Apply filters');
  await tick();
  const url = new URL(paths.at(-1) ?? '', 'https://local.invalid');
  assert.equal(url.searchParams.get('principal_id'), 'alice');
  assert.equal(url.searchParams.get('model'), 'chat');
  assert.equal(url.searchParams.get('from_ms'), '10');
  assert.equal(url.searchParams.get('to_ms'), '20');
  click(root, 'Audit');
  await tick();
  assert.match(text(root), /models-listed/);
  assert.doesNotMatch(text(root), /PRIVATE/);
  input(root, 'Request ID', 'req');
  click(root, 'Apply filters');
  await tick();
  assert.match(paths.at(-1) ?? '', /request_id=req/);
  app.dispose();
  assert.equal(root.children.length, 0);
  assert.equal(download.disposed, 1);
});
test('next/previous and one-page CSV use existing authorized boundaries', async () => {
  const root = new Element();
  const paths: string[] = [];
  const download = downloads();
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      return path.includes('format=csv')
        ? new Response('header\nrow\n', {
            headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
          })
        : path.includes('cursor=')
          ? Response.json({ object: 'list', data: [], has_more: false, next_cursor: null })
          : page(false, true);
    },
    download,
  );
  await tick();
  click(root, 'Next page');
  await tick();
  assert.match(paths.at(-1) ?? '', /cursor=/);
  click(root, 'Previous page');
  await tick();
  assert.doesNotMatch(paths.at(-1) ?? '', /cursor=/);
  click(root, 'Download current page CSV');
  await tick();
  assert.deepEqual(download.saved, [['usage', 'header\nrow\n']]);
  app.dispose();
});
test('invalid time filters never issue a request; fresh search recovers', async () => {
  const root = new Element();
  let calls = 0;
  const app = mountHistoryWorkspace(
    root,
    async () => {
      calls++;
      return page();
    },
    downloads(),
  );
  await tick();
  input(root, 'From (Unix ms, inclusive)', '1e2');
  click(root, 'Apply filters');
  await tick();
  assert.equal(calls, 1);
  assert.match(text(root), /Invalid filters/);
  assert.equal(
    nodes(root).find((n) => n.attributes['aria-label'] === 'From (Unix ms, inclusive)')?.value,
    '1e2',
  );
  input(root, 'From (Unix ms, inclusive)', '10');
  click(root, 'Apply filters');
  await tick();
  assert.equal(calls, 2);
  app.dispose();
});
for (const status of [401, 403])
  test(`${status} clears rows, download leases and retained DOM controls`, async () => {
    const root = new Element();
    let calls = 0;
    let denied = false;
    const download = downloads();
    const app = mountHistoryWorkspace(
      root,
      async () => {
        calls++;
        return denied ? new Response('PRIVATE', { status }) : page();
      },
      download,
    );
    await tick();
    const stale = nodes(root).find((n) => n.textContent === 'Apply filters')?.listeners.click;
    denied = true;
    click(root, 'Audit');
    await tick();
    assert.match(text(root), status === 401 ? /Sign-in required/ : /Access denied/);
    assert.doesNotMatch(text(root), /9007199254740993|PRIVATE|chat/);
    stale?.();
    await tick();
    assert.equal(calls, 2);
    assert.equal(download.disposed, 1);
    app.dispose();
    assert.equal(download.disposed, 1);
  });
test('dispose before late CSV response prevents save and retained handlers', async () => {
  const root = new Element();
  const download = downloads();
  let finish!: (r: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      calls++;
      return path.includes('format=csv') ? pending : page();
    },
    download,
  );
  await tick();
  const stale = nodes(root).find((n) => n.textContent === 'Audit')?.listeners.click;
  click(root, 'Download current page CSV');
  app.dispose();
  stale?.();
  finish(new Response('header\nrow\n', { headers: { 'content-type': 'text/csv' } }));
  await tick();
  assert.equal(calls, 2);
  assert.equal(download.saved.length, 0);
  assert.equal(root.children.length, 0);
});

test('empty, unavailable and retry are visible and native paging stays disabled', async () => {
  const root = new Element();
  let calls = 0;
  const app = mountHistoryWorkspace(
    root,
    async () => {
      calls++;
      return calls === 1
        ? new Response(null, { status: 503 })
        : Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
    },
    downloads(),
  );
  await tick();
  assert.match(text(root), /History unavailable/);
  click(root, 'Next page');
  await tick();
  assert.equal(calls, 1);
  click(root, 'Retry');
  await tick();
  assert.equal(calls, 2);
  assert.match(text(root), /No history matches/);
  app.dispose();
});
test('CSV failure remains recoverable without rendering private server diagnostics', async () => {
  const root = new Element();
  const download = downloads();
  const app = mountHistoryWorkspace(
    root,
    async (path) =>
      path.includes('format=csv') ? new Response('PRIVATE', { status: 503 }) : page(),
    download,
  );
  await tick();
  click(root, 'Download current page CSV');
  await tick();
  assert.match(text(root), /CSV unavailable/);
  assert.doesNotMatch(text(root), /PRIVATE/);
  assert.equal(download.saved.length, 0);
  assert.equal(download.disposed, 0);
  app.dispose();
});
test('denial during pending usage export revokes both tabs and cannot save late bytes', async () => {
  const root = new Element();
  const download = downloads();
  let finish!: (r: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      if (path.includes('/audit?')) return new Response(null, { status: 403 });
      return path.includes('format=csv') ? pending : page();
    },
    download,
  );
  await tick();
  click(root, 'Download current page CSV');
  click(root, 'Audit');
  await tick();
  finish(
    new Response('PRIVATE', { headers: { 'content-type': 'text/csv', 'x-has-more': 'false' } }),
  );
  await tick();
  assert.match(text(root), /Access denied/);
  assert.equal(download.saved.length, 0);
  assert.equal(download.disposed, 1);
  app.dispose();
});
test('retained handlers from a replaced screen cannot issue stale filter requests', async () => {
  const root = new Element();
  let calls = 0;
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      calls++;
      return page(path.includes('/audit?'));
    },
    downloads(),
  );
  await tick();
  const stale = nodes(root).find((n) => n.textContent === 'Apply filters')?.listeners.click;
  click(root, 'Audit');
  await tick();
  stale?.();
  await tick();
  assert.equal(calls, 2);
  app.dispose();
});

for (const failure of ['unavailable', 'invalid', 'disposed', 'throw'] as const)
  test(`browser CSV ${failure} is generic, tab-scoped and retryable`, async () => {
    const root = new Element();
    let attempts = 0;
    const app = mountHistoryWorkspace(
      root,
      async (path) =>
        path.includes('format=csv')
          ? new Response('header\nrow\n', {
              headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
            })
          : page(path.includes('/audit?')),
      {
        save() {
          if (++attempts > 1) return 'started' as const;
          if (failure === 'throw') throw new Error('PRIVATE browser diagnostic');
          return failure;
        },
        dispose() {},
      },
    );
    await tick();
    click(root, 'Download current page CSV');
    await tick();
    assert.match(text(root), /CSV unavailable/);
    assert.ok(
      nodes(root).some(
        (n) => n.attributes.role === 'alert' && n.textContent?.includes('CSV unavailable'),
      ),
    );
    assert.doesNotMatch(text(root), /PRIVATE|browser diagnostic/);
    click(root, 'Audit');
    await tick();
    assert.doesNotMatch(text(root), /CSV unavailable/);
    click(root, 'Usage');
    assert.match(text(root), /CSV unavailable/);
    click(root, 'Download current page CSV');
    assert.doesNotMatch(text(root), /CSV unavailable/);
    await tick();
    assert.equal(attempts, 2);
    assert.doesNotMatch(text(root), /CSV unavailable/);
    app.dispose();
  });

test('reentrant download disposal cannot restore private DOM or error', async () => {
  const root = new Element();
  const app = mountHistoryWorkspace(
    root,
    async (path) =>
      path.includes('format=csv')
        ? new Response('header\nrow\n', {
            headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
          })
        : page(),
    {
      save() {
        app.dispose();
        throw new Error('PRIVATE');
      },
      dispose() {},
    },
  );
  await tick();
  click(root, 'Download current page CSV');
  await tick();
  assert.equal(root.children.length, 0);
});

for (const route of ['managed', 'delegated'] as const)
  test(`usage attempt details show exact ${route} attribution without interpreting HTML`, async () => {
    const root = new Element();
    let calls = 0;
    const app = mountHistoryWorkspace(
      root,
      async () => {
        calls++;
        const body = (await page().json()) as { data: Record<string, unknown>[] };
        const first = body.data[0];
        assert.ok(first);
        Object.assign(first, {
          routeKind: route,
          attemptId: 'attempt-002',
          upstreamModelId: '<img src=x onerror=alert(1)>',
          selectedCandidateId: 'candidate-not-provider',
          actualInferenceProviderId: 'reported-provider',
          latencyMs: 0,
          outcome: 'failed',
          credentialId: 'PRIVATE-CREDENTIAL-ID',
          prompt: 'PRIVATE-PROMPT',
          usage: {
            status: 'partial',
            promptTokens: 0,
            completionTokens: null,
            totalTokens: null,
          },
        });
        return Response.json(body);
      },
      downloads(),
    );
    await tick();
    const details = nodes(root).find((n) => n.tag === 'details');
    assert.ok(details);
    assert.equal(details.attributes.open, undefined);
    assert.equal(details.children[0]?.tag, 'summary');
    assert.equal(details.children[0]?.textContent, 'Inspect attempt');
    const fields = new Map(
      details.children[1]?.children.map((n, i, all) =>
        n.tag === 'dt' ? [n.textContent, all[i + 1]?.textContent] : [null, null],
      ),
    );
    assert.equal(fields.get('Request ID'), 'req');
    assert.equal(fields.get('Attempt ID'), 'attempt-002');
    assert.equal(fields.get('Estimated price version'), 'v1');
    assert.equal(fields.get('Reported billing source'), 'Unknown');
    assert.equal(fields.get('Route kind'), route);
    assert.equal(fields.get('Upstream model'), '<img src=x onerror=alert(1)>');
    assert.equal(fields.get('Selected candidate'), 'candidate-not-provider');
    assert.equal(fields.get('Actual inference provider'), 'reported-provider');
    assert.equal(fields.get('Outcome'), 'failed');
    assert.equal(fields.get('Latency (ms)'), '0');
    assert.equal(fields.get('Prompt tokens'), '0');
    assert.equal(fields.get('Completion tokens'), 'Unknown');
    assert.doesNotMatch(text(root), /PRIVATE-CREDENTIAL-ID|PRIVATE-PROMPT/);
    assert.equal(
      nodes(root).some((n) => ['img', 'script'].includes(n.tag)),
      false,
    );
    assert.equal(calls, 1);
    app.dispose();
    assert.equal(root.children.length, 0);
  });

test('usage details unknown provider is not inferred and disappears with loading, tabs and denial', async () => {
  const root = new Element();
  let deny = false;
  const app = mountHistoryWorkspace(
    root,
    async (path) => (deny ? new Response(null, { status: 403 }) : page(path.includes('/audit?'))),
    downloads(),
  );
  await tick();
  const details = () => nodes(root).filter((n) => n.tag === 'details');
  assert.equal(details().length, 1);
  const current = details()[0];
  assert.ok(current);
  assert.match(text(current), /Actual inference provider Unknown/);
  assert.match(text(current), /Selected candidate candidate/);
  click(root, 'Audit');
  assert.equal(details().length, 0);
  await tick();
  click(root, 'Usage');
  assert.equal(details().length, 1);
  deny = true;
  click(root, 'Apply filters');
  assert.equal(details().length, 0);
  await tick();
  assert.match(text(root), /Access denied/);
  assert.equal(details().length, 0);
  app.dispose();
});
