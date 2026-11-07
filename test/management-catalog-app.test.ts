import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountManagementCatalog } from '../src/management/catalog-app.ts';
import type { CatalogElement } from '../src/management/catalog-view.ts';

class Element implements CatalogElement {
  readonly tag: string;
  textContent: string | null = null;
  attributes: Record<string, string> = {};
  children: Element[] = [];
  listeners: Record<string, () => void> = {};
  focused = false;
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
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

const model = { id: 'demo', object: 'model', created: 1, owned_by: '<img src=x>' };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('ungranted app mounts sign-in and can dispose', () => {
  const root = new Element();
  const app = mountManagementCatalog(root);
  assert.match(text(root), /Sign-in required/);
  app.dispose();
  assert.equal(root.children.length, 0);
});

test('trusted grant drives list/detail buttons and clear', async () => {
  const root = new Element();
  const app = mountManagementCatalog(root);
  const paths: string[] = [];
  await app.authorize({
    expiresAt: Date.now() + 60000,
    request: async (path) => {
      paths.push(path);
      return Response.json(path.endsWith('/demo') ? model : { data: [model] });
    },
  });
  assert.match(text(root), /demo/);
  nodes(root)
    .find((n) => n.tag === 'button' && n.textContent === 'demo')
    ?.listeners.click?.();
  assert.match(text(root), /Loading models/);
  await tick();
  assert.match(text(root), /Published by/);
  assert.match(text(root), /<img src=x>/);
  assert.ok(nodes(root).some((n) => n.tag === 'h1' && n.focused));
  nodes(root)
    .find((n) => n.textContent === 'Back to models')
    ?.listeners.click?.();
  await tick();
  assert.equal(paths.length, 3);
  app.clear('denied');
  assert.match(text(root), /Access denied/);
  assert.ok(!text(root).includes('demo'));
  app.dispose();
});

test('expiry removes DOM without a second UI timer', async () => {
  const root = new Element();
  const app = mountManagementCatalog(root);
  await app.authorize({
    expiresAt: Date.now() + 100,
    request: async () => Response.json({ data: [model] }),
  });
  assert.match(text(root), /demo/);
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.match(text(root), /Session expired/);
  assert.ok(!text(root).includes('demo'));
  app.dispose();
});

test('logout clear and disposal suppress pending results', async () => {
  for (const dispose of [false, true]) {
    const root = new Element();
    const app = mountManagementCatalog(root);
    let finish: (response: Response) => void = () => {};
    const pending = app.authorize({
      expiresAt: Date.now() + 60000,
      request: () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    });
    assert.match(text(root), /Loading models/);
    if (dispose) app.dispose();
    else app.clear('unauthenticated');
    finish(Response.json({ data: [model] }));
    await pending;
    assert.ok(!text(root).includes('demo'));
    if (!dispose) assert.match(text(root), /Sign-in required/);
    app.dispose();
  }
});

for (const status of [401, 403, 404, 500]) {
  test(`HTTP ${status} maps to safe UI`, async () => {
    const root = new Element();
    const app = mountManagementCatalog(root);
    await app.authorize({
      expiresAt: Date.now() + 60000,
      request: async () => new Response('secret-error', { status }),
    });
    assert.match(
      text(root),
      status === 401
        ? /Sign-in required/
        : status === 403
          ? /Access denied/
          : status === 404
            ? /Model not found/
            : /unavailable/,
    );
    assert.ok(!text(root).includes('secret-error'));
    app.dispose();
  });
}
