import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountSsoManagementCatalog } from '../src/management/catalog-app.ts';
import type { CatalogElement } from '../src/management/catalog-view.ts';

class Element implements CatalogElement {
  textContent: string | null = null;
  children: Element[] = [];
  listeners: Record<string, () => void> = {};
  focused = false;
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
  readonly tag: string;
  constructor(tag = 'div') {
    this.tag = tag;
  }
  setAttribute(_key: string, _value: string) {}
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
  focus() {
    this.focused = true;
  }
}
function nodes(root: Element): Element[] {
  return [root, ...root.children.flatMap(nodes)];
}
function text(root: Element): string {
  return nodes(root)
    .map((node) => node.textContent ?? '')
    .join(' ');
}
const model = { id: 'team/chat', object: 'model', created: 42, owned_by: 'opengranter' };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('explicit SSO mount stays inert without a trusted grant', () => {
  const root = new Element();
  const app = mountSsoManagementCatalog(root);
  assert.match(text(root), /Sign-in required/);
  app.dispose();
  assert.equal(root.children.length, 0);
});

test('SSO DOM navigation uses only SSO list and encoded detail, including reserved aliases', async () => {
  for (const id of ['team/chat', 'count', 'user']) {
    const row = { ...model, id };
    const root = new Element();
    const app = mountSsoManagementCatalog(root);
    const paths: string[] = [];
    try {
      await app.authorize({
        expiresAt: Date.now() + 60000,
        request: async (path) => {
          paths.push(path);
          return Response.json(
            path === '/management/v1/models' ? { object: 'list', data: [row] } : row,
          );
        },
      });
      assert.ok(text(root).includes(id));
      const button = nodes(root).find((node) => node.tag === 'button' && node.textContent === id);
      assert.ok(button);
      assert.ok(button.listeners.click);
      button.listeners.click();
      assert.match(text(root), /Loading models/);
      await tick();
      assert.match(text(root), /Published by/);
      assert.ok(nodes(root).some((node) => node.tag === 'h1' && node.focused));
      const back = nodes(root).find((node) => node.textContent === 'Back to models');
      assert.ok(back);
      assert.ok(back.listeners.click);
      back.listeners.click();
      await tick();
      assert.deepEqual(paths, [
        '/management/v1/models',
        '/management/v1/models/' + encodeURIComponent(id),
        '/management/v1/models',
      ]);
      app.clear('denied');
      assert.match(text(root), /Access denied/);
      assert.ok(!text(root).includes(id));
    } finally {
      app.dispose();
    }
  }
});

test('SSO mount removes private catalog on empty, error and rejected authentication', async () => {
  const root = new Element();
  const app = mountSsoManagementCatalog(root);
  try {
    for (const response of [
      Response.json({ object: 'list', data: [] }),
      new Response('private diagnostic', { status: 503 }),
      new Response('private diagnostic', { status: 401 }),
    ]) {
      await app.authorize({
        expiresAt: Date.now() + 60000,
        request: async () => Response.json({ object: 'list', data: [model] }),
      });
      assert.match(text(root), /team\/chat/);
      await app.authorize({ expiresAt: Date.now() + 60000, request: async () => response });
      assert.doesNotMatch(text(root), /team\/chat|private diagnostic/);
      assert.match(
        text(root),
        response.status === 401
          ? /Sign-in required/
          : response.status === 503
            ? /Model catalog unavailable/
            : /No models available/,
      );
    }
  } finally {
    app.dispose();
  }
});

test('SSO clear and dispose suppress late private results and abort the request', async () => {
  for (const dispose of [false, true]) {
    const root = new Element();
    const app = mountSsoManagementCatalog(root);
    let finish!: (response: Response) => void;
    let signal: AbortSignal | null | undefined;
    const pending = app.authorize({
      expiresAt: Date.now() + 60000,
      request: async (_path, init) => {
        signal = init.signal;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      },
    });
    assert.match(text(root), /Loading models/);
    if (dispose) app.dispose();
    else app.clear('unauthenticated');
    assert.equal(signal?.aborted, true);
    finish(Response.json({ object: 'list', data: [model] }));
    await pending;
    assert.doesNotMatch(text(root), /team\/chat/);
    if (dispose) assert.equal(root.children.length, 0);
    else assert.match(text(root), /Sign-in required/);
    app.dispose();
  }
});
