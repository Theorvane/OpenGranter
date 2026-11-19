import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountSsoAuditReview, mountSsoUsageReview } from '../src/management/review-app.ts';

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
function nodes(root: Element): Element[] {
  return [root, ...root.children.flatMap(nodes)];
}
function text(root: Element): string {
  return nodes(root)
    .map((node) => node.textContent ?? '')
    .join(' ');
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
for (const mount of [mountSsoUsageReview, mountSsoAuditReview]) {
  test(`${mount.name} renders loading/empty/error and blocks after fresh denial`, async () => {
    const root = new Element();
    let respond!: (response: Response) => void;
    let calls = 0;
    const app = mount(root, async () => {
      calls++;
      return new Promise<Response>((done) => {
        respond = done;
      });
    });
    assert.equal(calls, 0);
    const loading = app.load({});
    assert.match(text(root), /Loading history/);
    respond(Response.json({ object: 'list', data: [], has_more: false, next_cursor: null }));
    await loading;
    assert.match(text(root), /No history found/);
    const retry = app.retry();
    respond(new Response('PRIVATE', { status: 503 }));
    await retry;
    assert.match(text(root), /History unavailable/);
    assert.doesNotMatch(text(root), /PRIVATE/);
    const deny = app.retry();
    respond(new Response('PRIVATE', { status: 403 }));
    await deny;
    assert.match(text(root), /Access denied/);
    await app.load({});
    assert.equal(calls, 3);
    app.dispose();
    assert.equal(root.children.length, 0);
  });
  test(`${mount.name} loads button model filter; disposal prevents late render`, async () => {
    const root = new Element();
    let path = '';
    let respond!: (response: Response) => void;
    const app = mount(root, async (url) => {
      path = url;
      return new Promise<Response>((done) => {
        respond = done;
      });
    });
    const input = nodes(root).find((node) => node.tag === 'input');
    const click = nodes(root).find((node) => node.textContent === 'Load history')?.listeners.click;
    assert.ok(input);
    assert.ok(click);
    input.value = 'chat';
    click();
    assert.equal(new URL(path, 'https://local.invalid').searchParams.get('model'), 'chat');
    app.dispose();
    respond(Response.json({ object: 'list', data: [], has_more: false, next_cursor: null }));
    await tick();
    assert.equal(root.children.length, 0);
  });
}
