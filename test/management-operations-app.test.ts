import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountManagementOperations } from '../src/management/operations-app.ts';

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
function enter(root: Element, label: string, value: string) {
  const input = nodes(root).find((n) => n.tag === 'label' && n.textContent === label)?.children[0];
  assert.ok(input, label);
  input.value = value;
}
function reviewIssue(root: Element) {
  enter(root, 'Principal ID', 'person');
  enter(root, 'Expiry (Unix milliseconds, integer)', '2000');
  click(root, 'Review issuance');
}
function reviewRevoke(root: Element) {
  enter(root, 'Credential ID', 'credential');
  click(root, 'Review revocation');
}
const empty = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
function adapter() {
  return {
    disposed: 0,
    save() {
      return 'started' as const;
    },
    dispose() {
      this.disposed++;
    },
  };
}
test('navigation connects history GET and explicit token POST, clearing retained secrets', async () => {
  const root = new Element();
  const calls: string[] = [];
  const adapters: ReturnType<typeof adapter>[] = [];
  const app = mountManagementOperations(
    root,
    async (path, init) => {
      calls.push(path);
      assert.equal(init.cache, 'no-store');
      if (init.method === 'POST') {
        assert.equal(path, '/management/v1/proxy-tokens');
        assert.deepEqual(JSON.parse(String(init.body)), { principalId: 'person', expiresAt: 2000 });
        return Response.json(
          { credentialId: 'credential', token: 'synthetic-secret' },
          { status: 201 },
        );
      }
      return empty();
    },
    () => {
      const value = adapter();
      adapters.push(value);
      return value;
    },
  );
  await tick();
  assert.match(calls[0] ?? '', /usage/);
  const detachedHistory = nodes(root).find((n) => n.textContent === 'History');
  assert.ok(detachedHistory);
  click(root, 'Proxy tokens');
  assert.equal(adapters[0]?.disposed, 1);
  assert.equal(calls.length, 1);
  reviewIssue(root);
  assert.equal(calls.length, 1);
  click(root, 'Confirm issuance');
  await tick();
  assert.equal(calls.length, 2);
  const secret = nodes(root).find((n) => n.textContent === 'synthetic-secret');
  assert.ok(secret);
  detachedHistory.listeners.click?.();
  assert.match(text(root), /synthetic-secret/);
  click(root, 'History');
  await tick();
  assert.equal(secret.textContent, '');
  assert.equal(adapters.length, 2);
  assert.equal(calls.length, 3);
  app.dispose();
  app.dispose();
  assert.equal(adapters[1]?.disposed, 1);
  assert.equal(root.children.length, 0);
});
for (const status of [401, 403]) {
  for (const source of ['history', 'tokens']) {
    test(`current ${source} ${status} terminates navigation and retained controls`, async () => {
      const root = new Element();
      const download = adapter();
      let calls = 0;
      const app = mountManagementOperations(
        root,
        async (_path, init) => {
          calls++;
          return source === 'history' || init.method === 'POST'
            ? new Response(null, { status })
            : empty();
        },
        () => download,
      );
      const retained = nodes(root).filter((n) => n.tag === 'button');
      await tick();
      if (source === 'tokens') {
        click(root, 'Proxy tokens');
        reviewRevoke(root);
        click(root, 'Confirm revocation');
        await tick();
      }
      assert.match(text(root), status === 401 ? /Sign-in required/ : /Access denied/);
      assert.equal(nodes(root).filter((n) => n.tag === 'button').length, 0);
      const before = calls;
      for (const node of retained) node.listeners.click?.();
      await tick();
      assert.equal(calls, before);
      assert.equal(download.disposed, 1);
      app.dispose();
    });
  }
}
test('navigation aborts pending mutation; late denial cannot erase the new history visit', async () => {
  const root = new Element();
  let signal: AbortSignal | null | undefined;
  let finish: (response: Response) => void = () => assert.fail('not pending');
  const app = mountManagementOperations(
    root,
    async (_path, init) => {
      if (init.method !== 'POST') return empty();
      signal = init.signal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
    adapter,
  );
  await tick();
  click(root, 'Proxy tokens');
  reviewRevoke(root);
  click(root, 'Confirm revocation');
  assert.equal(signal?.aborted, false);
  click(root, 'History');
  await tick();
  assert.equal(signal?.aborted, true);
  finish(new Response(null, { status: 403 }));
  await tick();
  assert.match(text(root), /No history matches/);
  assert.doesNotMatch(text(root), /Access denied/);
  app.dispose();
});
test('adapter failure stays generic and permits token navigation without automatic mutation', async () => {
  const root = new Element();
  let calls = 0;
  const app = mountManagementOperations(
    root,
    async () => {
      calls++;
      return empty();
    },
    () => {
      throw new Error('PRIVATE');
    },
  );
  assert.match(text(root), /History unavailable/);
  assert.doesNotMatch(text(root), /PRIVATE/);
  click(root, 'Proxy tokens');
  assert.match(text(root), /Issue proxy token/);
  assert.equal(calls, 0);
  app.dispose();
});
test('operations module builds using canonical browser-only source boundary', async () => {
  const javascript = await buildManagementBrowser({
    root: process.cwd(),
    entry: 'src/management/operations-app.ts',
  });
  assert.match(javascript, /mountManagementOperations/);
  assert.match(javascript, /Confirm revocation/);
  assert.doesNotMatch(javascript, /process\.env|node:|localStorage/);
});

test('reentrant disposal during download construction cannot revive DOM or leak cleanup exceptions', async () => {
  const root = new Element();
  let visits = 0;
  let cleanup = 0;
  const app = mountManagementOperations(
    root,
    async () => empty(),
    () => {
      if (++visits === 1) return adapter();
      app.dispose();
      return {
        save() {
          return 'started' as const;
        },
        dispose() {
          cleanup++;
          throw new Error('PRIVATE');
        },
      };
    },
  );
  await tick();
  click(root, 'Proxy tokens');
  assert.doesNotThrow(() => click(root, 'History'));
  assert.equal(root.children.length, 0);
  assert.equal(cleanup, 1);
});
