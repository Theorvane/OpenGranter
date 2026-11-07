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
  'data:text/javascript;base64,' + Buffer.from(javascript).toString('base64')
)) as { mountSsoManagementCatalog: typeof source };
const model = { id: 'team/model', object: 'model', created: 42, owned_by: 'opengranter' };
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
for (const [name, mount] of [
  ['source', source],
  ['built', built.mountSsoManagementCatalog],
] as const) {
  for (const control of ['detail', 'refresh', 'back', 'retry']) {
    for (const transition of ['navigate', 'renew', 'clear', 'expire', 'dispose']) {
      test(
        name + ': stale ' + control + ' after ' + transition + ' cannot consume authority',
        async (t) => {
          const root = new TokenElement();
          let time = 100;
          let reads = 0;
          let unavailable = control === 'retry';
          const app = mount(root, { now: () => time, schedule: () => () => {} });
          t.after(() => app.dispose());
          const grant = {
            expiresAt: 200,
            request: async (path: string) => {
              reads++;
              if (unavailable) return new Response('PRIVATE', { status: 503 });
              return Response.json(path.endsWith('/models') ? { data: [model] } : model);
            },
          };
          await app.authorize(grant);
          if (control === 'back') {
            root.button(model.id).click();
            await settle();
          }
          const stale = root.button(
            control === 'detail'
              ? model.id
              : control === 'refresh'
                ? 'Refresh models'
                : 'Back to models',
          );
          unavailable = false;
          if (transition === 'navigate') {
            stale.click();
            await settle();
          }
          if (transition === 'renew') await app.authorize(grant);
          if (transition === 'clear') app.clear('unauthenticated');
          if (transition === 'expire') time = 200;
          if (transition === 'dispose') app.dispose();
          const before = reads;
          const text = root.text();
          stale.click();
          await settle();
          assert.equal(reads, before, 'detached control must not dispatch a read');
          if (transition === 'expire') assert.match(root.text(), /Session expired/);
          else assert.equal(root.text(), text);
          assert.doesNotMatch(root.text(), /PRIVATE/);
        },
      );
    }
  }
  test(
    name + ': double click does not cancel pending detail; current back still works',
    async (t) => {
      const root = new TokenElement();
      const app = mount(root, { now: () => 100, schedule: () => () => {} });
      t.after(() => app.dispose());
      let reads = 0;
      let complete!: (value: Response) => void;
      let signal: AbortSignal | undefined;
      await app.authorize({
        expiresAt: 200,
        request: async (path, init) => {
          reads++;
          if (path.endsWith('/models')) return Response.json({ data: [model] });
          signal = init.signal ?? undefined;
          return new Promise<Response>((resolve) => {
            complete = resolve;
          });
        },
      });
      const button = root.button(model.id);
      button.click();
      button.click();
      assert.equal(reads, 2);
      assert.equal(signal?.aborted, false);
      complete(Response.json(model));
      await settle();
      assert.match(root.text(), /Published by/);
      root.button('Back to models').click();
      await settle();
      assert.equal(reads, 3);
      assert.ok(root.button(model.id));
    },
  );
}
