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
  node.listeners.input?.();
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

for (const kind of ['usage', 'audit'] as const) {
  for (const empty of [false, true]) {
    test(`${kind} refresh preserves applied filters and the exact current-page cursor (${empty ? 'empty' : 'ready'})`, async () => {
      const root = new Element();
      const paths: string[] = [];
      let fail = false;
      const app = mountHistoryWorkspace(
        root,
        async (path) => {
          paths.push(path);
          if (fail) return new Response(null, { status: 503 });
          if (path.includes('cursor=') && empty)
            return Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
          const second = path.includes('cursor=');
          const audit = path.includes('/audit?');
          const data = (await page(audit, !second).json()) as {
            data: { occurredAt: number; eventId?: string; attemptId?: string }[];
            next_cursor: string | null;
          };
          const row = data.data[0];
          assert.ok(row);
          if (second) {
            row.occurredAt = 90;
            if (audit) row.eventId = '1';
            else row.attemptId = 'b';
          } else if (audit) {
            row.eventId = '2';
            data.next_cursor = '2';
          }
          return Response.json(data);
        },
        downloads(),
      );
      await tick();
      if (kind === 'audit') {
        click(root, 'Audit');
        await tick();
      }
      input(root, 'Principal', 'human');
      if (kind === 'usage') input(root, 'Model', '<script>chat</script>');
      input(root, 'From (UTC or Unix ms, inclusive)', '10');
      input(root, 'To (UTC or Unix ms, exclusive)', '200');
      click(root, 'Apply filters');
      await tick();
      click(root, 'Next page');
      await tick();
      const current = paths.at(-1);
      assert.ok(current?.includes('cursor='));
      // An unapplied edit must not silently change the requested scope.
      input(root, 'Model', 'not-applied');
      click(root, 'Refresh current page');
      await tick();
      assert.equal(paths.at(-1), current);
      click(root, 'Previous page');
      await tick();
      assert.ok(!paths.at(-1)?.includes('cursor='));
      click(root, 'Next page');
      await tick();
      assert.equal(paths.at(-1), current);
      fail = true;
      click(root, 'Refresh current page');
      await tick();
      assert.match(text(root), /unavailable/i);
      fail = false;
      click(root, 'Retry');
      await tick();
      assert.equal(paths.at(-1), current);
      app.dispose();
    });
  }
}

test('refresh is unavailable while loading; stale refresh cannot supersede an in-flight read', async () => {
  const root = new Element();
  let calls = 0;
  let complete: ((r: Response) => void) | undefined;
  const app = mountHistoryWorkspace(
    root,
    async () => {
      calls++;
      if (calls === 1) return page();
      return new Promise<Response>((resolve) => {
        complete = resolve;
      });
    },
    downloads(),
  );
  await tick();
  const stale = nodes(root).find((n) => n.textContent === 'Refresh current page');
  assert.ok(stale);
  click(root, 'Refresh current page');
  const loading = nodes(root).find((n) => n.textContent === 'Refresh current page');
  assert.equal(loading?.attributes.disabled, '');
  stale.listeners.click?.();
  assert.equal(calls, 2);
  app.dispose();
  complete?.(page());
  await tick();
  assert.equal(root.children.length, 0);
});

for (const status of [401, 403]) {
  test(`refresh fresh ${status} clears both histories and releases download ownership`, async () => {
    const root = new Element();
    const download = downloads();
    let deny = false;
    const app = mountHistoryWorkspace(
      root,
      async (path) => (deny ? new Response(null, { status }) : page(path.includes('/audit?'))),
      download,
    );
    await tick();
    click(root, 'Audit');
    await tick();
    deny = true;
    click(root, 'Refresh current page');
    await tick();
    assert.doesNotMatch(text(root), /models-listed|human|9007199254740993/);
    assert.equal(download.disposed, 1);
    assert.equal(
      nodes(root).some((n) => n.textContent === 'Refresh current page'),
      false,
    );
    app.dispose();
    assert.equal(download.disposed, 1);
  });
}
