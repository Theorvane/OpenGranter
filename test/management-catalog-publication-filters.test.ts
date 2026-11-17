import assert from 'node:assert/strict';
import test from 'node:test';
import { renderCatalogView } from '../src/management/catalog-view.ts';
import { Element, nodes, text } from './catalog-detail-dom-fixture.ts';

const models = [
  {
    id: 'vision',
    object: 'model' as const,
    created: 0,
    owned_by: 'Team',
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
    supported_parameters: ['tools', '<future>'],
  },
  {
    id: 'speech',
    object: 'model' as const,
    created: 0,
    owned_by: 'Team',
    architecture: { input_modalities: ['text'], output_modalities: ['audio'] },
    supported_parameters: ['tools'],
  },
  { id: 'unknown', object: 'model' as const, created: 0, owned_by: 'Team' },
  {
    id: 'empty',
    object: 'model' as const,
    created: 0,
    owned_by: 'Team',
    architecture: { input_modalities: [], output_modalities: [] },
    supported_parameters: [],
  },
];
function setup() {
  const root = new Element();
  const selected: string[] = [];
  const actions = {
    list() {},
    detail(id: string) {
      selected.push(id);
    },
  };
  renderCatalogView(root, { state: 'list', models }, actions);
  const control = (label: string) => {
    const value = nodes(root).find((n) => n.attributes['aria-label'] === label);
    assert.ok(value, label);
    return value;
  };
  const choose = (label: string, value: string) => {
    const select = control(label);
    select.value = value;
    select.listeners.change?.();
  };
  const visible = () =>
    nodes(root)
      .filter((n) => n.tag === 'button' && models.some((m) => m.id === n.textContent))
      .map((n) => n.textContent);
  return { root, actions, selected, control, choose, visible };
}
test('published selectors intersect each other and text search; unknown never matches', () => {
  const f = setup();
  f.choose('Published supported parameter', 'tools');
  assert.deepEqual(f.visible(), ['vision', 'speech']);
  f.choose('Published output modality', 'text');
  assert.deepEqual(f.visible(), ['vision']);
  f.choose('Published input modality', 'text');
  assert.deepEqual(f.visible(), ['vision']);
  const search = nodes(f.root).find((n) => n.tag === 'input');
  assert.ok(search);
  search.value = 'speech';
  search.listeners.input?.();
  assert.deepEqual(f.visible(), []);
  assert.match(text(f.root), /No matching models/);
  search.value = '';
  search.listeners.input?.();
  f.choose('Published output modality', '');
  f.choose('Published input modality', '');
  f.choose('Published supported parameter', '');
  assert.deepEqual(f.visible(), ['vision', 'speech', 'unknown', 'empty']);
});
test('exact future labels are safe and filtering retains authorized detail action', () => {
  const f = setup();
  const options = f.control('Published supported parameter').children;
  assert.deepEqual(
    options.map((n) => n.attributes.value),
    ['', '<future>', 'tools'],
  );
  assert.ok(!nodes(f.root).some((n) => n.tag === 'future'));
  f.choose('Published supported parameter', '<future>');
  assert.deepEqual(f.visible(), ['vision']);
  nodes(f.root)
    .find((n) => n.tag === 'button' && n.textContent === 'vision')
    ?.listeners.click?.();
  assert.deepEqual(f.selected, ['vision']);
  f.choose('Published supported parameter', 'TOOLS');
  assert.deepEqual(f.visible(), []);
});
test('teardown clears and invalidates detached controls and detail buttons', () => {
  const f = setup();
  const control = f.control('Published input modality');
  const search = nodes(f.root).find((n) => n.tag === 'input');
  assert.ok(search);
  const oldButton = nodes(f.root).find((n) => n.tag === 'button' && n.textContent === 'vision');
  assert.ok(oldButton);
  control.value = 'image';
  search.value = 'Team';
  renderCatalogView(f.root, { state: 'denied' }, f.actions);
  assert.equal(control.value, '');
  assert.equal(search.value, '');
  control.listeners.change?.();
  search.listeners.input?.();
  oldButton.listeners.click?.();
  assert.deepEqual(f.selected, []);
  assert.doesNotMatch(text(f.root), /vision|speech|Team/);
});

import type { AddressInfo } from 'node:net';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { createManagementCatalogSession } from '../src/management/catalog-session.ts';
import { discoveryFixture, discoveryModel } from './model-discovery-filters-fixture.ts';

test('loopback authorized publication filters locally; details and refresh reauthorize after Deny', async () => {
  const f = discoveryFixture([
    discoveryModel('visible/vision', {
      inputs: ['text', 'image'],
      outputs: ['text'],
      parameters: ['tools'],
    }),
    discoveryModel('visible/text', { inputs: ['text'], outputs: ['text'], parameters: [] }),
  ]);
  const server = createNodeRequestServer(f.handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const session = createManagementCatalogSession();
  let requests = 0;
  session.authorize((path, init) => {
    requests++;
    return fetch(origin + path, {
      ...init,
      headers: { ...init.headers, authorization: 'Bearer fixture' },
    });
  });
  const root = new Element();
  let pending: Promise<void> | undefined;
  const actions = {
    list() {
      pending = session.list().then(() => renderCatalogView(root, session.snapshot(), actions));
    },
    detail(id: string) {
      pending = session.detail(id).then(() => renderCatalogView(root, session.snapshot(), actions));
    },
  };
  try {
    await session.list();
    renderCatalogView(root, session.snapshot(), actions);
    const select = nodes(root).find(
      (n) => n.attributes['aria-label'] === 'Published input modality',
    );
    assert.ok(select);
    select.value = 'image';
    select.listeners.change?.();
    assert.equal(requests, 1);
    assert.ok(nodes(root).some((n) => n.tag === 'button' && n.textContent === 'visible/vision'));
    assert.ok(!nodes(root).some((n) => n.tag === 'button' && n.textContent === 'visible/text'));
    f.statements.push({ effect: 'Deny', actions: ['*'], resources: ['provider:provider'] });
    nodes(root)
      .find((n) => n.tag === 'button' && n.textContent === 'visible/vision')
      ?.listeners.click?.();
    await pending;
    assert.equal(requests, 2);
    assert.match(text(root), /Model not found/);
    assert.equal(select.value, '');
    actions.list();
    await pending;
    assert.equal(requests, 3);
    assert.match(text(root), /No models available/);
    assert.equal(f.events.length, 3);
    assert.equal(f.reads(), 3);
  } finally {
    session.dispose();
    renderCatalogView(root, session.snapshot(), actions);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
