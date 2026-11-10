import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createManagementCatalogSession } from '../src/management/catalog-session.ts';
import { type CatalogElement, renderCatalogView } from '../src/management/catalog-view.ts';

class Element implements CatalogElement {
  readonly tag: string;
  textContent: string | null = null;
  value = '';
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

const actions = { list() {}, detail(_id: string) {} };
for (const state of [
  'idle',
  'empty',
  'missing',
  'unauthenticated',
  'expired',
  'denied',
  'unavailable',
  'disposed',
] as const) {
  test('snapshot ' + state + ' replaces protected data', () => {
    const root = new Element();
    root.textContent = 'old-secret';
    renderCatalogView(root, { state }, actions);
    assert.ok(!text(root).includes('old-secret'));
    if (state === 'disposed') assert.equal(root.children.length, 0);
  });
}
test('canonical session snapshots render safe native buttons', async () => {
  const session = createManagementCatalogSession();
  const model = { id: 'demo', object: 'model', created: 1, owned_by: '<img src=x>' };
  session.authorize(async (path) =>
    Response.json(path.endsWith('/demo') ? model : { data: [model] }),
  );
  const root = new Element();
  const reads = session.list();
  renderCatalogView(root, session.snapshot(), actions);
  assert.match(text(root), /Loading models/);
  await reads;
  renderCatalogView(root, session.snapshot(), actions);
  assert.ok(nodes(root).some((n) => n.tag === 'button' && n.textContent === 'demo'));
  await session.detail('demo');
  renderCatalogView(root, session.snapshot(), actions, true);
  assert.match(text(root), /<img src=x>/);
  assert.ok(!nodes(root).some((n) => n.tag === 'img'));
  assert.ok(nodes(root).some((n) => n.tag === 'h1' && n.focused));
  session.clear('expired');
  renderCatalogView(root, session.snapshot(), actions);
  assert.match(text(root), /Session expired/);
});

test('search filters model IDs and publishers without replacing the input', () => {
  const root = new Element();
  let selected = '';
  renderCatalogView(
    root,
    {
      state: 'list',
      models: [
        { id: 'demo/alpha', object: 'model', created: 0, owned_by: 'Acme' },
        { id: 'demo/beta', object: 'model', created: 0, owned_by: 'Other' },
      ],
    },
    {
      list() {},
      detail(id) {
        selected = id;
      },
    },
  );
  const input = nodes(root).find((node) => node.tag === 'input');
  assert.ok(input);
  input.value = ' ACME ';
  input.listeners.input?.();
  assert.match(text(root), /demo\/alpha/);
  assert.doesNotMatch(text(root), /demo\/beta/);
  nodes(root)
    .find((node) => node.textContent === 'demo/alpha')
    ?.listeners.click?.();
  assert.equal(selected, 'demo/alpha');
  input.value = 'no matches';
  input.listeners.input?.();
  assert.match(text(root), /No matching models/);
  assert.equal(
    nodes(root).find((node) => node.tag === 'input'),
    input,
  );
  input.value = 'BETA';
  input.listeners.input?.();
  assert.match(text(root), /demo\/beta/);
});
