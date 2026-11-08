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
const model = { id: 'team/model', object: 'model', created: 42, owned_by: 'opengranter' };
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

for (const [label, mount] of [
  ['source', mountSsoManagementCatalog],
  ['compiled', built.mountSsoManagementCatalog],
] as const) {
  for (const control of ['detail', 'refresh', 'back', 'retry'] as const) {
    test(`${label}: detached ${control} cannot use a renewed identity`, async (t) => {
      const root = new TokenElement();
      let count = 0;
      let fail = control === 'retry';
      const app = mount(root, { now: () => 100, schedule: () => () => {} });
      t.after(() => app.dispose());
      const grant = {
        expiresAt: 200,
        request: async (path: string) => {
          count++;
          if (fail) return new Response(null, { status: 503 });
          return Response.json(path.endsWith('/models') ? { data: [model] } : model);
        },
      };
      await app.authorize(grant);
      if (control === 'back') {
        root.button(model.id).click();
        await settle();
      }
      const old = root.button(
        control === 'detail'
          ? model.id
          : control === 'refresh'
            ? 'Refresh models'
            : 'Back to models',
      );
      fail = false;
      await app.authorize(grant);
      const before = count;
      old.click();
      await settle();
      assert.equal(count, before, 'detached control dispatched using the replacement grant');
      assert.ok(root.button(model.id));
    });
  }
  test(`${label}: duplicate model activation cannot abort or duplicate the current detail request`, async (t) => {
    const root = new TokenElement();
    const app = mount(root, { now: () => 100, schedule: () => () => {} });
    t.after(() => app.dispose());
    let details = 0;
    let signal: AbortSignal | undefined;
    let complete!: (response: Response) => void;
    await app.authorize({
      expiresAt: 200,
      request: async (path, init) => {
        if (path.endsWith('/models')) return Response.json({ data: [model] });
        details++;
        signal = init.signal ?? undefined;
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
    });
    const old = root.button(model.id);
    old.click();
    old.click();
    assert.equal(details, 1);
    assert.equal(signal?.aborted, false);
    complete(Response.json(model));
    await settle();
    assert.match(root.text(), /Published by/);
    const back = root.button('Back to models');
    back.click();
    await settle();
    assert.ok(root.button(model.id));
    back.click();
    old.click();
    await settle();
    assert.equal(details, 1);
  });
  test(`${label}: active refresh, retry and expiry remain functional with suspended timers`, async (t) => {
    const root = new TokenElement();
    let time = 100;
    let count = 0;
    const app = mount(root, { now: () => time, schedule: () => () => {} });
    t.after(() => app.dispose());
    await app.authorize({
      expiresAt: 200,
      request: async () => {
        count++;
        return count === 2 ? new Response(null, { status: 503 }) : Response.json({ data: [model] });
      },
    });
    root.button('Refresh models').click();
    await settle();
    assert.match(root.text(), /catalog unavailable/);
    root.button('Back to models').click();
    await settle();
    assert.equal(count, 3);
    time = 200;
    root.button(model.id).click();
    await settle();
    assert.equal(count, 3);
    assert.match(root.text(), /Session expired/);
  });
}
