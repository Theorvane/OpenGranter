import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import type { ManagementCatalogSnapshot } from '../src/management/catalog-session.ts';
import { renderCatalogView } from '../src/management/catalog-view.ts';
import { TokenElement } from './token-management-dom-fixture.ts';

const model = {
  id: 'team/chat',
  object: 'model' as const,
  created: 42,
  owned_by: 'opengranter' as const,
};
const states: readonly ManagementCatalogSnapshot[] = [
  { state: 'idle' },
  { state: 'loading', view: 'list' },
  { state: 'loading', view: 'detail' },
  { state: 'empty' },
  { state: 'list', models: [model] },
  { state: 'detail', model },
  { state: 'missing' },
  { state: 'unavailable' },
];
const javascript = await buildManagementBrowser({
  root: process.cwd(),
  entry: 'src/management/catalog-view.ts',
});
const built = (await import(
  'data:text/javascript;base64,' + Buffer.from(javascript).toString('base64')
)) as { renderCatalogView: typeof renderCatalogView };
for (const [label, render] of [
  ['source', renderCatalogView],
  ['built browser module', built.renderCatalogView],
] as const) {
  test(
    label + ': catalog remains a labelled region inside the owner main in every data state',
    () => {
      const root = new TokenElement('main');
      for (const state of states) {
        render(root, state, { list() {}, detail() {} });
        assert.equal(root.all().filter((node) => node.tag === 'main').length, 1, state.state);
        assert.equal(root.children[0]?.tag, 'section', state.state);
        assert.equal(root.children[0]?.attrs['aria-label'], 'Model catalog', state.state);
        assert.equal(root.all().filter((node) => node.tag === 'h1').length, 1, state.state);
      }
    },
  );
}
