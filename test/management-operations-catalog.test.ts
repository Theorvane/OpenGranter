import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountManagementOperations } from '../src/management/operations-app.ts';
import { mountSessionManagementOperations } from '../src/management/operations-session.ts';

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
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
  return node;
}

const empty = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
const model = { id: 'team/model', object: 'model', created: 1, owned_by: 'opengranter' };
const download = () => ({ save: () => 'started' as const, dispose() {} });
test('Models connects SSO list/detail and back navigation without proxy fallback', async () => {
  const root = new Element();
  const paths: string[] = [];
  const app = mountManagementOperations(
    root,
    async (path, init) => {
      paths.push(path);
      assert.equal(init.cache, 'no-store');
      assert.equal(init.method, 'GET');
      if (path === '/management/v1/models') return Response.json({ object: 'list', data: [model] });
      if (path === '/management/v1/models/team%2Fmodel') return Response.json(model);
      return empty();
    },
    download,
  );
  await tick();
  click(root, 'Models');
  assert.match(text(root), /Loading models/);
  await tick();
  click(root, 'team/model');
  await tick();
  assert.match(text(root), /Published by/);
  click(root, 'Back to models');
  await tick();
  assert.deepEqual(paths.slice(1), [
    '/management/v1/models',
    '/management/v1/models/team%2Fmodel',
    '/management/v1/models',
  ]);
  app.dispose();
});
for (const status of [401, 403]) {
  test('Models ' + status + ' terminates all navigation', async () => {
    const root = new Element();
    let calls = 0;
    const app = mountManagementOperations(
      root,
      async (path) => {
        calls++;
        return path.includes('models') ? new Response(null, { status }) : empty();
      },
      download,
    );
    await tick();
    const retained = click(root, 'Models');
    await tick();
    assert.match(text(root), status === 401 ? /Sign-in required/ : /Access denied/);
    assert.equal(nodes(root).filter((n) => n.tag === 'button').length, 0);
    retained.listeners.click?.();
    await tick();
    assert.equal(calls, 2);
    app.dispose();
  });
}
test('Models empty and unavailable are retryable', async () => {
  const root = new Element();
  let count = 0;
  const app = mountManagementOperations(
    root,
    async (path) => {
      if (!path.includes('models')) return empty();
      if (++count === 1) return new Response(null, { status: 500 });
      return Response.json({ object: 'list', data: [] });
    },
    download,
  );
  click(root, 'Models');
  await tick();
  assert.match(text(root), /catalog unavailable/);
  click(root, 'Back to models');
  await tick();
  assert.match(text(root), /No models available/);
  app.dispose();
});
test('leaving Models aborts requests and ignores late denial and retained controls', async () => {
  const root = new Element();
  let resolve!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  let calls = 0;
  const app = mountManagementOperations(
    root,
    async (path, init) => {
      calls++;
      if (path.includes('models')) {
        signal = init.signal;
        return new Promise<Response>((done) => {
          resolve = done;
        });
      }
      return empty();
    },
    download,
  );
  click(root, 'Models');
  const retained = nodes(root).filter((n) => n.tag === 'button');
  click(root, 'Proxy tokens');
  assert.equal(signal?.aborted, true);
  resolve(new Response(null, { status: 403 }));
  await tick();
  assert.match(text(root), /Principal ID/);
  const before = calls;
  for (const node of retained) node.listeners.click?.();
  await tick();
  assert.equal(calls, before);
  app.dispose();
});
test('operations with Models builds in the canonical browser closure', async () => {
  const code = await buildManagementBrowser({
    root: process.cwd(),
    entry: 'src/management/operations-app.ts',
  });
  assert.match(code, /Models available to your identity/);
});

test('session logout in Models aborts detail and detached controls cannot revive it', async () => {
  const root = new Element();
  let calls = 0;
  let signal: AbortSignal | null | undefined;
  let finish!: (response: Response) => void;
  const app = mountSessionManagementOperations(root, download, {
    now: () => 1000,
    schedule: () => () => {},
  });
  app.authorize({
    expiresAt: 2000,
    request: async (path, init) => {
      calls++;
      if (path === '/management/v1/models') return Response.json({ data: [model] });
      if (path.includes('models/')) {
        signal = init.signal;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      return empty();
    },
  });
  click(root, 'Models');
  await tick();
  const retained = click(root, 'team/model');
  app.clear();
  assert.equal(signal?.aborted, true);
  finish(Response.json(model));
  await tick();
  assert.match(text(root), /Sign-in required/);
  const before = calls;
  retained.listeners.click?.();
  await tick();
  assert.equal(calls, before);
  app.dispose();
});
test('Models re-entry reloads rather than retaining a previous list', async () => {
  const root = new Element();
  let requests = 0;
  const app = mountManagementOperations(
    root,
    async (path) => {
      if (path.includes('models')) return Response.json({ data: ++requests === 1 ? [model] : [] });
      return empty();
    },
    download,
  );
  click(root, 'Models');
  await tick();
  const refresh = nodes(root).find((n) => n.textContent === 'Refresh models');
  assert.ok(refresh);
  click(root, 'History');
  click(root, 'Models');
  await tick();
  assert.match(text(root), /No models available/);
  assert.equal(requests, 2);
  refresh.listeners.click?.();
  await tick();
  assert.equal(requests, 2);
  app.dispose();
});
test('missing detail returns to a fresh scoped list', async () => {
  const root = new Element();
  const app = mountManagementOperations(
    root,
    async (path) => {
      if (path === '/management/v1/models') return Response.json({ data: [model] });
      if (path.includes('models/')) return new Response(null, { status: 404 });
      return empty();
    },
    download,
  );
  click(root, 'Models');
  await tick();
  click(root, 'team/model');
  await tick();
  assert.match(text(root), /Model not found/);
  click(root, 'Back to models');
  await tick();
  assert.ok(nodes(root).find((n) => n.textContent === 'team/model'));
  app.dispose();
});
