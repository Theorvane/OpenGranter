import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { mountSsoManagementCatalog } from '../src/management/sso-catalog-app.ts';
import { TokenElement } from './token-management-dom-fixture.ts';

const js = await buildManagementBrowser({
  root: process.cwd(),
  entry: 'src/management/sso-catalog-app.ts',
});
const compiled = (await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
)) as { mountSsoManagementCatalog: typeof mountSsoManagementCatalog };
const model = { id: 'team/chat', object: 'model', created: 42, owned_by: 'opengranter' };
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
for (const [label, mount] of [
  ['source', mountSsoManagementCatalog],
  ['compiled', compiled.mountSsoManagementCatalog],
] as const) {
  for (const detail of [false, true]) {
    test(
      label +
        ': retry preserves failed ' +
        (detail ? 'detail' : 'list') +
        ' and rejects duplicate/stale controls',
      async (t) => {
        const root = new TokenElement();
        const paths: string[] = [];
        let fail = !detail;
        let time = 100;
        const app = mount(root, { now: () => time, schedule: () => () => {} });
        t.after(() => app.dispose());
        const grant = {
          expiresAt: 200,
          request: async (path: string) => {
            paths.push(path);
            return fail
              ? new Response(null, { status: 503 })
              : Response.json(path.endsWith('/models') ? { data: [model] } : model);
          },
        };
        await app.authorize(grant);
        if (detail) {
          fail = true;
          root.button(model.id).click();
          await settle();
        }
        assert.match(root.text(), /catalog unavailable/);
        const retry = root.button('Retry');
        const before = paths.length;
        fail = false;
        retry.click();
        retry.click();
        await settle();
        assert.equal(paths.length, before + 1);
        assert.equal(
          paths.at(-1),
          detail ? '/management/v1/models/team%2Fchat' : '/management/v1/models',
        );
        assert.match(root.text(), detail ? /Published by/ : /models shown/);
        await app.authorize(grant);
        retry.click();
        await settle();
        assert.equal(paths.length, before + 2);
        fail = true;
        root.button('Refresh models').click();
        await settle();
        const expiredRetry = root.button('Retry');
        const count = paths.length;
        time = 200;
        expiredRetry.click();
        await settle();
        assert.equal(paths.length, count);
        assert.match(root.text(), /Session expired/);
      },
    );
  }
  test(label + ': missing model offers list navigation, not a retry loop', async (t) => {
    const root = new TokenElement();
    const app = mount(root, { now: () => 100, schedule: () => () => {} });
    t.after(() => app.dispose());
    await app.authorize(
      { expiresAt: 200, request: async () => new Response(null, { status: 404 }) },
      model.id,
    );
    assert.match(root.text(), /Model not found/);
    assert.throws(() => root.button('Retry'));
    assert.ok(root.button('Back to models'));
  });
}
