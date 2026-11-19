import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { createSsoManagementCatalogClient } from '../src/management/catalog-client.ts';
import { type CatalogElement, renderCatalogView } from '../src/management/catalog-view.ts';

class Element implements CatalogElement {
  textContent: string | null = null;
  children: Element[] = [];
  attributes: Record<string, string> = {};
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
  addEventListener() {}
  focus() {}
  all(): Element[] {
    return [this, ...this.children.flatMap((node) => node.all())];
  }
  text() {
    return this.all()
      .map((node) => node.textContent ?? '')
      .join(' ');
  }
}

const javascript = await buildManagementBrowser({
  root: process.cwd(),
  entry: 'src/management/catalog-view.ts',
});
const built = (await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
)) as { renderCatalogView: typeof renderCatalogView };
const basic = { id: 'team/chat', object: 'model', created: 42, owned_by: 'opengranter' };
const actions = { list() {}, detail() {} };
for (const [label, render] of [
  ['source', renderCatalogView],
  ['compiled', built.renderCatalogView],
] as const) {
  test(`${label}: decoded detail metadata is inert text and clears on auth loss`, async () => {
    const root = new Element();
    const client = createSsoManagementCatalogClient(async () =>
      Response.json({
        ...basic,
        name: '<img src=x onerror=alert(1)>',
        description: 'Line one\n模型 <script>private()</script>',
        context_length: null,
        architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
        supported_parameters: ['tools', 'temperature'],
        top_provider: { context_length: 0, max_completion_tokens: 8192 },
        pricing: { prompt: '0.0000001234567890123456789', completion: '0e-9' },
        credential_ref: 'MUST-NOT-RENDER',
      }),
    );
    const result = await client.detail(basic.id);
    assert.equal(result.state, 'ready');
    if (result.state !== 'ready') return;
    render(root, { state: 'detail', model: result.data }, actions);
    for (const text of [
      '<img src=x onerror=alert(1)>',
      'Line one\n模型 <script>private()</script>',
      'Context length (tokens) Unknown',
      'Provider context length (tokens) 0',
      'Provider maximum output (tokens) 8192',
      'Input modalities text, image',
      'Output modalities text',
      'Supported parameters tools, temperature',
      'Prompt base price (USD/token) 0.0000001234567890123456789',
      'Completion base price (USD/token) 0e-9',
      'Published metadata only; not effective routing limits or guaranteed capabilities.',
      'Published base prices only; not estimated or billed request costs.',
    ])
      assert.ok(root.text().includes(text), text);
    assert.doesNotMatch(root.text(), /MUST-NOT-RENDER/u);
    assert.equal(
      root.all().some((node) => ['img', 'script', 'a'].includes(node.tag)),
      false,
    );
    render(root, { state: 'unauthenticated' }, actions);
    assert.doesNotMatch(root.text(), /Line one|8192|0\.0000001234567890123456789/u);
  });
  test(`${label}: missing, null, empty and zero remain distinct`, () => {
    const root = new Element();
    render(root, { state: 'detail', model: { ...basic, object: 'model' } }, actions);
    for (const key of [
      'Name',
      'Description',
      'Context length (tokens)',
      'Input modalities',
      'Output modalities',
      'Supported parameters',
      'Provider context length (tokens)',
      'Provider maximum output (tokens)',
      'Prompt base price (USD/token)',
      'Completion base price (USD/token)',
    ])
      assert.ok(root.text().includes(`${key} Not published`), key);
    render(
      root,
      {
        state: 'detail',
        model: {
          ...basic,
          object: 'model',
          description: '',
          context_length: 0,
          architecture: { input_modalities: [], output_modalities: [] },
          supported_parameters: [],
          top_provider: { context_length: null },
          pricing: { prompt: '0', completion: '0.00' },
        },
      },
      actions,
    );
    for (const text of [
      'Description Empty',
      'Context length (tokens) 0',
      'Input modalities None published',
      'Output modalities None published',
      'Supported parameters None published',
      'Provider context length (tokens) Unknown',
      'Provider maximum output (tokens) Not published',
      'Prompt base price (USD/token) 0',
      'Completion base price (USD/token) 0.00',
    ])
      assert.ok(root.text().includes(text), text);
  });
}
