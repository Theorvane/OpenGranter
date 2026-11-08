import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { mountSsoManagementCatalog } from '../src/management/sso-catalog-app.ts';
import { TokenElement } from './token-management-dom-fixture.ts';

const javascript = await buildManagementBrowser({
  root: process.cwd(),
  entry: 'src/management/sso-catalog-app.ts',
});
const built = (await import(
  'data:text/javascript;base64,' + Buffer.from(javascript).toString('base64')
)) as { mountSsoManagementCatalog: typeof mountSsoManagementCatalog };
const basic = { id: 'team/chat', object: 'model', created: 42, owned_by: 'opengranter' };
for (const [label, mount] of [
  ['source', mountSsoManagementCatalog],
  ['compiled', built.mountSsoManagementCatalog],
] as const) {
  test(`${label}: details expose published metadata as inert text, not effective limits or billing`, async (t) => {
    const root = new TokenElement();
    let requests = 0;
    const app = mount(root, { now: () => 0, schedule: () => () => {} });
    t.after(() => app.dispose());
    await app.authorize(
      {
        expiresAt: 1000,
        request: async () => {
          requests++;
          return Response.json({
            ...basic,
            name: '<img src=x onerror=alert(1)>',
            description: 'Line one\n模型 <script>private()</script>',
            context_length: null,
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
            supported_parameters: ['tools', 'temperature'],
            top_provider: { context_length: 0, max_completion_tokens: 8192 },
            pricing: { prompt: '0.0000001234567890123456789', completion: '0e-9' },
            credential_ref: 'MUST-NOT-RENDER',
            canonical_slug: 'private/canonical',
          });
        },
      },
      basic.id,
    );
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
    assert.doesNotMatch(root.text(), /MUST-NOT-RENDER|private\/canonical/u);
    assert.equal(
      root.all().some((node) => ['img', 'script', 'a'].includes(node.tag)),
      false,
    );
    assert.equal(requests, 1);
    app.clear('unauthenticated');
    assert.doesNotMatch(root.text(), /Line one|8192|0\.0000001234567890123456789/u);
  });
  test(`${label}: legacy metadata absence, unknown bounds, empty publication and zero remain distinct`, async (t) => {
    const root = new TokenElement();
    const app = mount(root, { now: () => 0, schedule: () => () => {} });
    t.after(() => app.dispose());
    const show = async (extra: object) =>
      app.authorize(
        { expiresAt: 1000, request: async () => Response.json({ ...basic, ...extra }) },
        basic.id,
      );
    await show({});
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
    await show({
      description: '',
      context_length: 0,
      architecture: { input_modalities: [], output_modalities: [] },
      supported_parameters: [],
      top_provider: { context_length: null },
      pricing: { prompt: '0', completion: '0.00' },
    });
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
