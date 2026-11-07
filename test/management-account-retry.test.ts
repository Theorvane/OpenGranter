import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { mountSsoUsageWorkspace as source } from '../src/management/sso-usage-workspace.ts';
import { TokenElement } from './token-management-dom-fixture.ts';

const javascript = await buildManagementBrowser({
  root: process.cwd(),
  entry: 'src/management/sso-usage-workspace.ts',
});
const built = (await import(
  'data:text/javascript;base64,' + Buffer.from(javascript).toString('base64')
)) as { mountSsoUsageWorkspace: typeof source };
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
for (const [name, mount] of [
  ['source', source],
  ['built', built.mountSsoUsageWorkspace],
] as const) {
  test(
    name + ': Account explicitly recovers unavailable with one fresh GET and no automatic retry',
    async (t) => {
      const root = new TokenElement();
      let reads = 0;
      let finish!: (value: Response) => void;
      const app = mount(root, new EventTarget(), { now: () => 100, schedule: () => () => {} });
      t.after(() => app.dispose());
      await app.authorize({
        expiresAt: 200,
        request: async (path, init) => {
          assert.equal(init.method, 'GET');
          if (!path.endsWith('/me')) return Response.json({ object: 'list', data: [] });
          reads++;
          return reads === 1
            ? new Response('PRIVATE', { status: 503 })
            : new Promise<Response>((resolve) => {
                finish = resolve;
              });
        },
      });
      root.button('Account').click();
      await settle();
      assert.equal(reads, 1);
      assert.doesNotMatch(root.text(), /PRIVATE/);
      const retry = root.button('Retry current principal');
      retry.click();
      retry.click();
      assert.equal(reads, 2);
      assert.match(root.text(), /Loading current principal/);
      finish(Response.json({ principalId: 'recovered-human' }));
      await settle();
      assert.match(root.text(), /Current principal: recovered-human/);
      retry.click();
      assert.equal(reads, 2);
    },
  );
  for (const action of ['navigate', 'renew', 'clear', 'hide', 'expire', 'dispose']) {
    test(name + ': detached Account retry cannot dispatch after ' + action, async (t) => {
      const root = new TokenElement();
      const lifecycle = new EventTarget();
      let time = 100;
      let reads = 0;
      const app = mount(root, lifecycle, { now: () => time, schedule: () => () => {} });
      t.after(() => app.dispose());
      const grant = {
        expiresAt: 200,
        request: async (path: string) => {
          if (!path.endsWith('/me')) return Response.json({ object: 'list', data: [] });
          reads++;
          return new Response('PRIVATE', { status: 503 });
        },
      };
      await app.authorize(grant);
      root.button('Account').click();
      await settle();
      const retry = root.button('Retry current principal');
      if (action === 'navigate') root.button('Models').click();
      if (action === 'renew') await app.authorize(grant);
      if (action === 'clear') app.clear();
      if (action === 'hide') lifecycle.dispatchEvent(new Event('pagehide'));
      if (action === 'expire') time = 200;
      if (action === 'dispose') app.dispose();
      retry.click();
      await settle();
      assert.equal(reads, 1);
      assert.doesNotMatch(root.text(), /PRIVATE/);
      if (action === 'expire') assert.match(root.text(), /Session expired/);
    });
  }
  for (const failure of ['malformed', 'network', 'timeout']) {
    test(name + ': explicit retry recovers ' + failure, async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const flush = async () => {
        for (let i = 0; i < 30; i++) await Promise.resolve();
      };
      const root = new TokenElement();
      let reads = 0;
      const app = mount(root, new EventTarget(), { now: () => 100, schedule: () => () => {} });
      t.after(() => app.dispose());
      await app.authorize({
        expiresAt: 200,
        request: async (path) => {
          if (!path.endsWith('/me')) return Response.json({ object: 'list', data: [] });
          reads++;
          if (reads > 1) return Response.json({ principalId: 'recovered' });
          if (failure === 'network') throw Error('PRIVATE');
          if (failure === 'timeout') return new Promise<Response>(() => {});
          return Response.json({ principalId: 'PRIVATE', extra: true });
        },
      });
      root.button('Account').click();
      await flush();
      if (failure === 'timeout') t.mock.timers.tick(30000);
      await flush();
      assert.equal(reads, 1);
      assert.match(root.text(), /Current principal unavailable/);
      assert.doesNotMatch(root.text(), /PRIVATE/);
      root.button('Retry current principal').click();
      await flush();
      assert.equal(reads, 2);
      assert.match(root.text(), /Current principal: recovered/);
    });
  }
  for (const status of [401, 403]) {
    test(name + ': Account denial ' + status + ' has no retry', async (t) => {
      const root = new TokenElement();
      const app = mount(root, new EventTarget(), { now: () => 100, schedule: () => () => {} });
      t.after(() => app.dispose());
      await app.authorize({
        expiresAt: 200,
        request: async (path) =>
          path.endsWith('/me')
            ? new Response(null, { status })
            : Response.json({ object: 'list', data: [] }),
      });
      root.button('Account').click();
      await settle();
      assert.doesNotMatch(root.text(), /Retry current principal/);
    });
  }
}
