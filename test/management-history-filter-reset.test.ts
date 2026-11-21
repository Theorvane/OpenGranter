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
test('explicit reset clears invalid drafts and all applied filters with a fresh protected read', async () => {
  const root = new Element();
  const paths: string[] = [];
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      return page();
    },
    downloads(),
    'account-target',
  );
  await tick();
  assert.ok(paths[0]);
  assert.match(paths[0], /principal_id=account-target/);
  input(root, 'Model', 'chat');
  input(root, 'Request ID', 'req');
  input(root, 'From (Unix ms, inclusive)', 'bad');
  click(root, 'Apply filters');
  await tick();
  assert.match(text(root), /Invalid filters/);
  assert.equal(paths.length, 1);
  click(root, 'Clear filters');
  assert.match(text(root), /Loading/);
  assert.doesNotMatch(text(root), /Possible duplicate/);
  await tick();
  assert.equal(new URL(paths.at(-1) ?? '', 'https://local.invalid').search, '?format=json');
  for (const name of [
    'Principal',
    'Model',
    'Request ID',
    'From (Unix ms, inclusive)',
    'To (Unix ms, exclusive)',
  ]) {
    assert.equal(nodes(root).find((n) => n.attributes['aria-label'] === name)?.value, '');
  }
  app.dispose();
});

test('reset removes page cursor and cannot reuse detached controls', async () => {
  const root = new Element();
  const paths: string[] = [];
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      return page(false, true);
    },
    downloads(),
  );
  await tick();
  click(root, 'Next page');
  await tick();
  assert.match(paths.at(-1) ?? '', /cursor=/);
  const stale = nodes(root).find((n) => n.textContent === 'Clear filters');
  assert.ok(stale);
  const next = nodes(root).find((n) => n.textContent === 'Next page');
  assert.ok(next);
  click(root, 'Clear filters');
  await tick();
  assert.equal(new URL(paths.at(-1) ?? '', 'https://local.invalid').search, '?format=json');
  const count = paths.length;
  stale.listeners.click?.();
  next.listeners.click?.();
  await tick();
  assert.equal(paths.length, count);
  assert.ok(
    nodes(root).find((n) => n.textContent === 'Previous page')?.attributes.disabled !== undefined,
  );
  app.dispose();
});

test('active tab reset preserves inactive tab applied filters', async () => {
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
  input(root, 'Model', 'chat');
  click(root, 'Apply filters');
  await tick();
  click(root, 'Audit');
  await tick();
  input(root, 'Principal', 'alice');
  click(root, 'Apply filters');
  await tick();
  click(root, 'Clear filters');
  await tick();
  assert.match(paths.at(-1) ?? '', /audit\?format=json$/);
  click(root, 'Usage');
  await tick();
  assert.equal(
    new URL(paths.at(-1) ?? '', 'https://local.invalid').searchParams.get('model'),
    'chat',
  );
  assert.equal(nodes(root).find((n) => n.attributes['aria-label'] === 'Model')?.value, 'chat');
  app.dispose();
});

test('reset cancels pending CSV without delivering old page', async () => {
  const root = new Element();
  const paths: string[] = [];
  let finish!: (response: Response) => void;
  let csvSignal: AbortSignal | undefined;
  const download = downloads();
  const app = mountHistoryWorkspace(
    root,
    async (path, init) => {
      paths.push(path);
      if (path.includes('format=csv')) {
        csvSignal = init.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      return page();
    },
    download,
  );
  await tick();
  click(root, 'Download current page CSV');
  await tick();
  click(root, 'Clear filters');
  await tick();
  assert.equal(csvSignal?.aborted, true);
  finish(new Response('old-private-csv', { headers: { 'content-type': 'text/csv' } }));
  await tick();
  assert.deepEqual(download.saved, []);
  assert.doesNotMatch(text(root), /Preparing CSV|CSV unavailable/);
  app.dispose();
});

test('reset aborts pending read and ignores a late previous result', async () => {
  const root = new Element();
  let finish!: (response: Response) => void;
  let firstSignal: AbortSignal | undefined;
  let calls = 0;
  const app = mountHistoryWorkspace(
    root,
    async (_path, init) => {
      if (++calls === 1) {
        firstSignal = init.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      return Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
    },
    downloads(),
  );
  click(root, 'Clear filters');
  await tick();
  assert.equal(firstSignal?.aborted, true);
  finish(page());
  await tick();
  assert.match(text(root), /No history matches/);
  assert.doesNotMatch(text(root), /Possible duplicate/);
  app.dispose();
});

test('retained reset cannot issue requests after denial or disposal', async () => {
  for (const terminal of ['denied', 'unauthenticated', 'dispose'] as const) {
    const root = new Element();
    let calls = 0;
    const download = downloads();
    const app = mountHistoryWorkspace(
      root,
      async () => {
        ++calls;
        return calls > 1
          ? new Response(null, { status: terminal === 'unauthenticated' ? 401 : 403 })
          : page();
      },
      download,
    );
    await tick();
    const reset = nodes(root).find((n) => n.textContent === 'Clear filters');
    assert.ok(reset);
    if (terminal === 'dispose') app.dispose();
    else {
      click(root, 'Refresh current page');
      await tick();
      assert.match(
        text(root),
        terminal === 'unauthenticated' ? /Sign-in required/ : /Access denied/,
      );
    }
    const count = calls;
    reset.listeners.click?.();
    await tick();
    assert.equal(calls, count);
    assert.equal(download.disposed, 1);
    app.dispose();
  }
});

test('reset clears failed CSV delivery and repeated reset remains a fresh read', async () => {
  const root = new Element();
  const paths: string[] = [];
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      return path.includes('format=csv')
        ? new Response('csv', { headers: { 'content-type': 'text/csv' } })
        : page();
    },
    {
      save() {
        return 'unavailable';
      },
      dispose() {},
    },
  );
  await tick();
  click(root, 'Download current page CSV');
  await tick();
  assert.match(text(root), /CSV unavailable/);
  click(root, 'Clear filters');
  await tick();
  assert.doesNotMatch(text(root), /CSV unavailable/);
  const count = paths.length;
  click(root, 'Clear filters');
  await tick();
  assert.equal(paths.length, count + 1);
  assert.equal(new URL(paths.at(-1) ?? '', 'https://local.invalid').search, '?format=json');
  app.dispose();
});
