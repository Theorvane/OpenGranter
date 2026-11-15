import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountBrowserManagementWorkspace } from '../src/management/browser-workspace.ts';
import type { CatalogElement } from '../src/management/catalog-view.ts';

class Element implements CatalogElement {
  textContent: string | null = null;
  value = '';
  attributes: Record<string, string> = {};
  children: Element[] = [];
  listeners: Record<string, () => void> = {};
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
  readonly tag: string;
  constructor(tag = 'div') {
    this.tag = tag;
  }
  setAttribute(key: string, value: string) {
    this.attributes[key] = value;
  }
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
    this.textContent = null;
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
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function click(root: Element, label: string) {
  const button = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(button, label);
  button.listeners.click?.();
  return button;
}

function fixture() {
  const root = new Element();
  const events = new Map<string, () => void>();
  const removed: string[] = [];
  const revoked: string[] = [];
  const blobs: Blob[] = [];
  let clicks = 0;
  let requests = 0;
  const app = mountBrowserManagementWorkspace(
    root,
    {
      lifecycle: {
        addEventListener(type, listener) {
          events.set(type, listener);
        },
        removeEventListener(type, listener) {
          if (events.get(type) === listener) events.delete(type);
          removed.push(type);
        },
      },
      downloads: {
        document: {
          createElement() {
            return {
              setAttribute() {},
              click() {
                clicks++;
              },
              remove() {},
            };
          },
          body: { append() {} },
        },
        urls: {
          createObjectURL(blob) {
            blobs.push(blob);
            return `blob:${blobs.length}`;
          },
          revokeObjectURL(url) {
            revoked.push(url);
          },
        },
        deferCleanup() {
          return () => {};
        },
      },
    },
    { now: () => 1000, schedule: () => () => {} },
  );
  const grant = {
    expiresAt: 2000,
    request: async (path: string) => {
      requests++;
      if (path.includes('format=csv'))
        return new Response('id,name\r\n1,한국어\r\n', {
          headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
        });
      if (path.includes('/models'))
        return Response.json({
          object: 'list',
          data: [{ id: 'team/chat', object: 'model', owned_by: 'team', created: 42 }],
        });
      return Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
    },
  };
  return {
    root,
    app,
    events,
    removed,
    revoked,
    blobs,
    grant,
    requests: () => requests,
    clicks: () => clicks,
  };
}
test('locked start; existing single Models/Operations navigation', async () => {
  const f = fixture();
  assert.equal(f.requests(), 0);
  assert.match(text(f.root), /Sign-in required/);
  f.app.authorize(f.grant);
  await tick();
  assert.equal(
    nodes(f.root).filter((n) => n.textContent === 'Models' && n.tag === 'button').length,
    1,
  );
  click(f.root, 'Operations');
  await tick();
  assert.equal(
    nodes(f.root).filter((n) => n.textContent === 'Models' && n.tag === 'button').length,
    1,
  );
  f.app.dispose();
});
test('CSV dispatch preserves UTF-8 server bytes and navigation releases object URL', async () => {
  const f = fixture();
  f.app.authorize(f.grant);
  await tick();
  click(f.root, 'Operations');
  await tick();
  click(f.root, 'Download current page CSV');
  await tick();
  assert.equal(f.clicks(), 1);
  assert.equal(await f.blobs[0]?.text(), 'id,name\r\n1,한국어\r\n');
  click(f.root, 'Models');
  assert.deepEqual(f.revoked, ['blob:1']);
  f.app.dispose();
});
test('pagehide clears private DOM and fences retained controls and authorization until pageshow', async () => {
  const f = fixture();
  f.app.authorize(f.grant);
  await tick();
  const stale = click(f.root, 'Operations');
  await tick();
  const before = f.requests();
  f.events.get('pagehide')?.();
  assert.match(text(f.root), /Sign-in required/);
  stale.listeners.click?.();
  f.app.authorize(f.grant);
  await tick();
  assert.equal(f.requests(), before);
  f.events.get('pageshow')?.();
  await tick();
  assert.equal(f.requests(), before);
  assert.match(text(f.root), /Sign-in required/);
  f.app.authorize(f.grant);
  await tick();
  assert.ok(f.requests() > before);
  f.app.dispose();
});
test('pagehide releases pending CSV URL; final dispose removes listeners and clears DOM', async () => {
  const f = fixture();
  f.app.authorize(f.grant);
  await tick();
  click(f.root, 'Operations');
  await tick();
  click(f.root, 'Download current page CSV');
  await tick();
  f.events.get('pagehide')?.();
  assert.deepEqual(f.revoked, ['blob:1']);
  f.app.dispose();
  f.app.dispose();
  assert.equal(f.events.size, 0);
  assert.deepEqual(f.removed, ['pagehide', 'pageshow']);
  assert.equal(text(f.root), '');
  const before = f.requests();
  f.app.authorize(f.grant);
  f.app.clear();
  await tick();
  assert.equal(f.requests(), before);
  assert.equal(text(f.root), '');
});
test('pagehide aborts a pending model read and late data cannot restore private DOM', async () => {
  const f = fixture();
  let signal: AbortSignal | undefined;
  let reply!: (response: Response) => void;
  f.app.authorize({
    expiresAt: 2000,
    request: async (_path, init) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>((resolve) => {
        reply = resolve;
      });
    },
  });
  assert.ok(signal);
  f.events.get('pagehide')?.();
  assert.equal(signal.aborted, true);
  reply(
    Response.json({
      object: 'list',
      data: [{ id: 'late-private', object: 'model', created: 1, owned_by: 'owner' }],
    }),
  );
  await tick();
  assert.match(text(f.root), /Sign-in required/);
  assert.doesNotMatch(text(f.root), /late-private/);
  f.app.dispose();
});
test('partial lifecycle registration failure rolls back listeners with generic error', () => {
  const f = fixture();
  f.app.dispose();
  const removed: string[] = [];
  assert.throws(
    () =>
      mountBrowserManagementWorkspace(f.root, {
        lifecycle: {
          addEventListener(type) {
            if (type === 'pageshow') throw new Error('private-port-diagnostic');
          },
          removeEventListener(type) {
            removed.push(type);
          },
        },
        downloads: {
          document: {
            createElement() {
              throw new Error('unused');
            },
            body: { append() {} },
          },
          urls: {
            createObjectURL() {
              throw new Error('unused');
            },
            revokeObjectURL() {},
          },
          deferCleanup() {
            return () => {};
          },
        },
      }),
    { message: 'Management browser lifecycle unavailable' },
  );
  assert.deepEqual(removed, ['pagehide', 'pageshow']);
  assert.equal(text(f.root), '');
});
