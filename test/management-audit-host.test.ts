import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import type { CatalogRequest } from '../src/management/catalog-client.ts';
import { mountSsoUsageWorkspace as source } from '../src/management/sso-usage-workspace.ts';
import { TokenElement } from './token-management-dom-fixture.ts';

const js = await buildManagementBrowser({
  root: process.cwd(),
  entry: 'src/management/sso-usage-workspace.ts',
});
const built = (await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
)) as { mountSsoUsageWorkspace: typeof source };
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const empty = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
for (const [label, mount] of [
  ['source', source],
  ['artifact', built.mountSsoUsageWorkspace],
] as const) {
  test(
    label + ': audit shares authority; denial clears credentials and stale controls',
    async () => {
      const root = new TokenElement();
      const lifecycle = new EventTarget();
      const paths: string[] = [];
      let denied = false;
      const request: CatalogRequest = async (path) => {
        paths.push(path);
        return denied ? new Response(null, { status: 403 }) : empty();
      };
      const app = mount(root, lifecycle, { now: () => 1, schedule: () => () => {} });
      try {
        root.button('Audit history').click();
        await settle();
        assert.match(root.text(), /Sign-in required/);
        assert.equal(paths.length, 0);
        await app.authorize({ request, expiresAt: 100 });
        root.button('Audit history').click();
        await settle();
        assert.ok(paths.some((path) => path === '/v1/audit?format=json'));
        const oldRefresh = root.button('Refresh current page');
        denied = true;
        oldRefresh.click();
        await settle();
        assert.match(root.text(), /Access denied/);
        const count = paths.length;
        root.button('Credentials').click();
        root.named('principalId').value = 'owner';
        root.named('expiresAt').value = '9000';
        root.named('issue').submit();
        await settle();
        assert.equal(paths.length, count);
        denied = false;
        await app.authorize({ request, expiresAt: 100 });
        oldRefresh.click();
        assert.equal(paths.length, count + 1);
        root.button('Audit history').click();
        await settle();
        lifecycle.dispatchEvent(new Event('pagehide'));
        assert.match(root.text(), /Sign-in required/);
        const afterHide = paths.length;
        lifecycle.dispatchEvent(new Event('pageshow'));
        root.button('Audit history').click();
        await settle();
        assert.equal(paths.length, afterHide);
      } finally {
        app.dispose();
      }
    },
  );
  test(
    label + ': navigation aborts audit and ignores late results; expiry blocks all views',
    async () => {
      const root = new TokenElement();
      let time = 1;
      let signal: AbortSignal | null | undefined;
      let finish: ((response: Response) => void) | undefined;
      const app = mount(root, new EventTarget(), { now: () => time, schedule: () => () => {} });
      let calls = 0;
      const request: CatalogRequest = async (path, init) => {
        calls++;
        if (!path.startsWith('/v1/audit')) return empty();
        signal = init.signal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      };
      try {
        await app.authorize({ request, expiresAt: 100 });
        root.button('Audit history').click();
        await settle();
        assert.match(root.text(), /Loading audit/);
        root.button('Models').click();
        await settle();
        assert.equal(signal?.aborted, true);
        finish?.(
          Response.json({
            object: 'list',
            data: [{ private: 'late-private' }],
            has_more: false,
            next_cursor: null,
          }),
        );
        await settle();
        assert.doesNotMatch(root.text(), /late-private|Audit unavailable/);
        time = 100;
        const count = calls;
        root.button('Audit history').click();
        await settle();
        assert.match(root.text(), /Session expired/);
        assert.equal(calls, count);
      } finally {
        app.dispose();
      }
    },
  );
  test(
    label + ': audit CSV URL is revoked by navigation, logout and replacement authority',
    async () => {
      const root = new TokenElement();
      const app = mount(root, new EventTarget(), { now: () => 1, schedule: () => () => {} });
      const request: CatalogRequest = async (path) =>
        path.includes('format=csv')
          ? new Response('event_id\n', {
              headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
            })
          : empty();
      try {
        for (const action of ['navigation', 'logout', 'renewal']) {
          await app.authorize({ request, expiresAt: 100 });
          root.button('Audit history').click();
          await settle();
          root.button('Export current page CSV').click();
          await settle();
          const url = root.all().find((node) => node.tag === 'a')?.attrs.href;
          assert.ok(url);
          assert.match(await (await fetch(url)).text(), /event_id/);
          const staleExport = root.button('Export current page CSV');
          if (action === 'navigation') root.button('Models').click();
          else if (action === 'logout') app.clear();
          else await app.authorize({ request, expiresAt: 100 });
          await settle();
          await assert.rejects(fetch(url));
          staleExport.click();
          await settle();
          assert.equal(
            root.all().some((node) => node.tag === 'a'),
            false,
          );
        }
      } finally {
        app.dispose();
      }
    },
  );
}
