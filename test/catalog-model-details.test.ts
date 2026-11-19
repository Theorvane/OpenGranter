import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogModel } from '../src/management/catalog-client.ts';
import { renderCatalogView } from '../src/management/catalog-view.ts';
import { Element, nodes, text } from './catalog-detail-dom-fixture.ts';

const basic: CatalogModel = {
  id: 'team/chat',
  object: 'model',
  created: 42,
  owned_by: 'opengranter',
};
const actions = { list() {}, detail() {} };
function fields(model: CatalogModel) {
  const root = new Element();
  renderCatalogView(root, { state: 'detail', model }, actions);
  const labels = nodes(root).filter((node) => node.tag === 'dt');
  const values = nodes(root).filter((node) => node.tag === 'dd');
  return {
    root,
    pairs: Object.fromEntries(
      labels.map((label, i) => [label.textContent, values[i]?.textContent]),
    ),
  };
}

test('detail shows published metadata exactly as text with honest units and scope', () => {
  const model: CatalogModel = {
    ...basic,
    name: '<img src=x>',
    description: '<script>private markup</script>',
    context_length: 0,
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
    supported_parameters: ['tools', 'temperature'],
    top_provider: { context_length: null, max_completion_tokens: 0 },
    pricing: { prompt: '0.000000000000000001', completion: '1e-9' },
  };
  const { root, pairs } = fields(model);
  assert.equal(pairs.Name, model.name);
  assert.equal(pairs.Description, model.description);
  assert.equal(pairs['Context length (tokens)'], '0');
  assert.equal(pairs['Provider context length (tokens)'], 'Unknown');
  assert.equal(pairs['Provider maximum output (tokens)'], '0');
  assert.equal(pairs['Input modalities'], 'text, image');
  assert.equal(pairs['Output modalities'], 'text');
  assert.equal(pairs['Supported parameters'], 'tools, temperature');
  assert.equal(pairs['Prompt base price (USD/token)'], model.pricing?.prompt);
  assert.equal(pairs['Completion base price (USD/token)'], model.pricing?.completion);
  assert.match(text(root), /not estimated or billed request costs/);
  assert.match(text(root), /not effective routing limits/);
  assert.match(text(root), /or guaranteed capabilities/);
  assert.ok(!nodes(root).some((node) => ['img', 'script', 'a'].includes(node.tag)));
});

test('legacy missing, explicit null, empty collections and zero stay distinct', () => {
  const legacy = fields(basic).pairs;
  for (const label of [
    'Name',
    'Description',
    'Context length (tokens)',
    'Input modalities',
    'Supported parameters',
    'Prompt base price (USD/token)',
    'Provider maximum output (tokens)',
  ])
    assert.equal(legacy[label], 'Not published', label);
  const { pairs } = fields({
    ...basic,
    context_length: null,
    description: '',
    architecture: { input_modalities: [], output_modalities: [] },
    supported_parameters: [],
    top_provider: {},
    pricing: { prompt: '0', completion: '0.000' },
  });
  assert.equal(pairs['Context length (tokens)'], 'Unknown');
  assert.equal(pairs.Description, 'Empty');
  assert.equal(pairs['Input modalities'], 'None published');
  assert.equal(pairs['Supported parameters'], 'None published');
  assert.equal(pairs['Prompt base price (USD/token)'], '0');
  assert.equal(pairs['Completion base price (USD/token)'], '0.000');
});

test('all non-detail snapshots remove the entire publication without transport or new controls', () => {
  const root = new Element();
  for (const state of [
    'loading',
    'empty',
    'missing',
    'unavailable',
    'denied',
    'expired',
    'disposed',
  ] as const) {
    renderCatalogView(
      root,
      { state: 'detail', model: { ...basic, description: 'published-private-detail' } },
      actions,
    );
    assert.match(text(root), /published-private-detail/);
    renderCatalogView(root, state === 'loading' ? { state, view: 'detail' } : { state }, actions);
    assert.doesNotMatch(text(root), /published-private-detail|USD\/token|Supported parameters/);
  }
});

test('explicit model refresh targets the exact selected alias without listing or mutation', () => {
  const root = new Element();
  const aliases: string[] = [];
  let lists = 0;
  renderCatalogView(
    root,
    { state: 'detail', model: basic },
    {
      list() {
        lists++;
      },
      detail(id) {
        aliases.push(id);
      },
    },
  );
  const refresh = nodes(root).find(
    (node) => node.tag === 'button' && node.textContent === 'Refresh model',
  );
  assert.ok(refresh);
  refresh.listeners.click?.();
  assert.deepEqual(aliases, [basic.id]);
  assert.equal(lists, 0);
});
