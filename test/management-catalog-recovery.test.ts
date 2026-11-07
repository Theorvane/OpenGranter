import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { mountSsoManagementCatalog as source } from '../src/management/sso-catalog-app.ts';
import { TokenElement } from './token-management-dom-fixture.ts';

const javascript = await buildManagementBrowser({
  root: process.cwd(),
  entry: 'src/management/sso-catalog-app.ts',
});
const built = (await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
)) as { mountSsoManagementCatalog: typeof source };
const model = { id: 'team/model', object: 'model', created: 42, owned_by: 'opengranter' };
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
for (const [name, mount] of [
  ['source', source],
  ['built', built.mountSsoManagementCatalog],
] as const) {
  for (const target of ['list', 'detail'] as const) {
    for (const failure of ['transport', 'malformed'] as const) {
      test(`${name}: explicit ${target} retry after ${failure}`, async (t) => {
        const root = new TokenElement();
        const app = mount(root, { now: () => 100, schedule: () => () => {} });
        t.after(() => app.dispose());
        const paths: string[] = [];
        let failed = target === 'list';
        const request = async (path: string) => {
          paths.push(path);
          if (failed) {
            if (failure === 'transport') throw Error('PRIVATE');
            return Response.json({ private: 'PRIVATE' });
          }
          return Response.json(path.endsWith('/models') ? { data: [model] } : model);
        };
        await app.authorize({ request, expiresAt: 200 });
        if (target === 'detail') {
          failed = true;
          root.button(model.id).click();
          await settle();
        }
        assert.match(root.text(), /unavailable/);
        const before = paths.length;
        await settle();
        assert.equal(paths.length, before, 'no automatic retry');
        const retry = root.button('Retry model lookup');
        failed = false;
        retry.click();
        retry.click();
        await settle();
        assert.equal(paths.length, before + 1, 'double click sends one fresh GET');
        assert.equal(
          paths.at(-1),
          target === 'detail' ? '/management/v1/models/team%2Fmodel' : '/management/v1/models',
        );
        assert.match(root.text(), target === 'detail' ? /Published by/ : /models shown/);
        assert.doesNotMatch(root.text(), /PRIVATE/);
      });
    }
  }
  for (const status of [401, 403, 404]) {
    test(`${name}: status ${status} does not offer retry`, async (t) => {
      const root = new TokenElement();
      const app = mount(root, { now: () => 100, schedule: () => () => {} });
      t.after(() => app.dispose());
      await app.authorize(
        { expiresAt: 200, request: async () => new Response(null, { status }) },
        model.id,
      );
      assert.doesNotMatch(root.text(), /Retry model lookup/);
    });
  }
  for (const transition of ['renew', 'clear', 'expire', 'navigate', 'dispose']) {
    test(`${name}: retry cannot dispatch after ${transition}`, async (t) => {
      const root = new TokenElement();
      let time = 100;
      let reads = 0;
      const app = mount(root, { now: () => time, schedule: () => () => {} });
      t.after(() => app.dispose());
      const grant = {
        expiresAt: 200,
        request: async () => {
          reads++;
          return new Response(null, { status: 503 });
        },
      };
      await app.authorize(grant, model.id);
      const retry = root.button('Retry model lookup');
      if (transition === 'renew') await app.authorize(grant);
      if (transition === 'clear') app.clear('unauthenticated');
      if (transition === 'expire') time = 200;
      if (transition === 'navigate') {
        root.button('Back to models').click();
        await settle();
      }
      if (transition === 'dispose') app.dispose();
      const before = reads;
      retry.click();
      await settle();
      assert.equal(reads, before);
    });
  }
}
