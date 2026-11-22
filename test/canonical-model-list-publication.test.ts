import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogModel } from '../src/management/catalog-client.ts';
import { renderCatalogView } from '../src/management/catalog-view.ts';
import { Element, nodes, text } from './canonical-catalog-dom-fixture.ts';

const legacy: CatalogModel = {
  id: 'legacy/chat',
  object: 'model',
  created: 0,
  owned_by: 'company',
};
const published: CatalogModel = {
  ...legacy,
  id: 'team/chat',
  name: '<img src=x>',
  description: '한국어 Research [fast].',
};
function setup() {
  const root = new Element();
  const selected: string[] = [];
  let lists = 0;
  const actions = {
    list() {
      lists++;
    },
    detail(id: string) {
      selected.push(id);
    },
  };
  renderCatalogView(root, { state: 'list', models: [legacy, published] }, actions);
  const search = nodes(root).find((node) => node.tag === 'input');
  assert.ok(search);
  return {
    root,
    selected,
    actions,
    lists: () => lists,
    search(query: string) {
      search.value = query;
      search.listeners.input?.();
    },
  };
}
test('published list shows literal names and descriptions while legacy entries remain navigable', () => {
  const view = setup();
  assert.match(text(view.root), /<img src=x>/);
  assert.match(text(view.root), /한국어 Research/);
  assert.ok(!nodes(view.root).some((node) => node.tag === 'img'));
  assert.equal(nodes(view.root).filter((node) => node.tag === 'li').length, 2);
  nodes(view.root)
    .find((node) => node.textContent === published.id)
    ?.listeners.click?.();
  assert.deepEqual(view.selected, [published.id]);
  assert.equal(view.lists(), 0);
});
test('search matches name and description literally without network or alias rewriting', () => {
  const view = setup();
  for (const query of ['<IMG', 'reSEARCH', '한국어', '[fast].', ' team/chat ']) {
    view.search(query);
    assert.match(text(view.root), /1 models shown/);
    assert.equal(nodes(view.root).filter((node) => node.tag === 'li').length, 1);
    assert.doesNotMatch(text(view.root), /legacy\/chat/);
  }
  view.search('.*');
  assert.match(text(view.root), /No matching models/);
  assert.doesNotMatch(text(view.root), /한국어|<img/);
  view.search('  ');
  assert.match(text(view.root), /2 models shown/);
  assert.deepEqual(
    nodes(view.root)
      .filter((node) => node.tag === 'li')
      .map((node) => node.children[0]?.textContent),
    [legacy.id, published.id],
  );
  assert.equal(view.lists(), 0);
});
test('state replacement removes previously published list text and search state', () => {
  for (const state of ['loading', 'empty', 'denied', 'disposed'] as const) {
    const view = setup();
    renderCatalogView(
      view.root,
      state === 'loading' ? { state, view: 'list' } : { state },
      view.actions,
    );
    assert.doesNotMatch(text(view.root), /한국어|<img|Research/);
    assert.ok(!nodes(view.root).some((node) => node.tag === 'input'));
  }
});
