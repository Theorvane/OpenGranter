import assert from 'node:assert/strict';
import { test } from 'node:test';
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

const empty = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
const model = { id: 'team/model', object: 'model', created: 1, owned_by: 'opengranter' };
const download = () => ({ save: () => 'started' as const, dispose() {} });

async function openDetail(detail: object, terminalStatus?: number) {
  const root = new Element();
  let lists = 0;
  const app = mountManagementOperations(
    root,
    async (path) => {
      if (path === '/management/v1/models') {
        if (terminalStatus && ++lists > 1) return new Response(null, { status: terminalStatus });
        return Response.json({ data: [model] });
      }
      if (path.includes('models/')) return Response.json(detail);
      return empty();
    },
    download,
  );
  click(root, 'Models');
  await tick();
  click(root, 'team/model');
  await tick();
  return { root, app };
}

test('operations detail shows exact published information without authority or billing claims', async () => {
  const { root, app } = await openDetail({
    ...model,
    name: 'Example <img src=x onerror=alert(1)>',
    description: '<script>untrusted</script>',
    context_length: 128000,
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
    supported_parameters: ['tools', 'temperature'],
    top_provider: { context_length: 64000, max_completion_tokens: 4096 },
    pricing: { prompt: '0.00000100', completion: '2.5e-6' },
    secret_reference: 'must-not-render',
  });
  const content = text(root);
  for (const expected of [
    'Published model information',
    'Example <img src=x onerror=alert(1)>',
    '<script>untrusted</script>',
    '128000',
    'text, image',
    'tools, temperature',
    '64000',
    '4096',
    '0.00000100',
    '2.5e-6',
    'USD/token',
    'not verified capability',
    'not enforced quotas',
    'not billed costs',
  ])
    assert.ok(content.includes(expected), expected);
  assert.doesNotMatch(content, /must-not-render/);
  assert.ok(!nodes(root).some((n) => n.tag === 'script' || n.tag === 'img'));
  click(root, 'Back to models');
  await tick();
  assert.doesNotMatch(text(root), /Published model information|0.00000100/);
  app.dispose();
});

test('published zero, unknown, absent and empty values remain distinct', async () => {
  const { root, app } = await openDetail({
    ...model,
    context_length: 0,
    architecture: { input_modalities: [], output_modalities: [] },
    supported_parameters: [],
    top_provider: { context_length: null, max_completion_tokens: 0 },
    pricing: { prompt: '0', completion: '0.0000' },
  });
  const values = nodes(root)
    .filter((n) => n.tag === 'dd')
    .map((n) => n.textContent);
  assert.ok(values.includes('Unknown'));
  assert.ok(values.includes('None published'));
  assert.ok(values.includes('Not published'));
  assert.ok(values.filter((v) => v === '0').length >= 3);
  assert.ok(values.includes('0.0000'));
  app.dispose();
});

test('legacy basic models show no fabricated descriptive metadata', async () => {
  const { root, app } = await openDetail(model);
  assert.match(text(root), /Published model information/);
  const values = nodes(root)
    .filter((n) => n.tag === 'dd')
    .map((n) => n.textContent);
  assert.equal(values.filter((v) => v === 'Not published').length, 10);
  assert.ok(!values.includes('0'));
  app.dispose();
});

test('malformed published data suppresses the entire detail', async () => {
  const { root, app } = await openDetail({
    ...model,
    description: 'not-to-leak',
    pricing: { prompt: 'bad', completion: '0' },
  });
  assert.match(text(root), /Model catalog unavailable/);
  assert.doesNotMatch(text(root), /Published model information|not-to-leak/);
  app.dispose();
});

for (const status of [401, 403, 503]) {
  test(['published details disappear before next read and on', status].join(' '), async () => {
    const { root, app } = await openDetail(
      { ...model, description: 'old-published-information' },
      status,
    );
    assert.match(text(root), /old-published-information/);
    const retained = click(root, 'Back to models');
    assert.doesNotMatch(text(root), /Published model information|old-published-information/);
    await tick();
    assert.match(
      text(root),
      status === 401
        ? /Sign-in required/
        : status === 403
          ? /Access denied/
          : /Model catalog unavailable/,
    );
    retained.listeners.click?.();
    await tick();
    assert.doesNotMatch(text(root), /old-published-information/);
    app.dispose();
  });
}
test('empty description stays empty rather than being invented', async () => {
  const { root, app } = await openDetail({ ...model, description: '' });
  const values = nodes(root)
    .filter((n) => n.tag === 'dd')
    .map((n) => n.textContent);
  assert.ok(values.includes(''));
  assert.equal(values.filter((v) => v === 'Not published').length, 9);
  app.dispose();
});
