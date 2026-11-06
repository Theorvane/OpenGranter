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
const settle = () => new Promise((resolve) => setTimeout(resolve, 15));
for (const [label, mount] of [
  ['source', source],
  ['artifact', built.mountSsoUsageWorkspace],
] as const) {
  function fixture(request: CatalogRequest) {
    const root = new TokenElement();
    const lifecycle = new EventTarget();
    let time = 1;
    let broken = false;
    let badCleanup = false;
    const jobs: (() => void)[] = [];
    const paths: string[] = [];
    const app = mount(root, lifecycle, {
      now: () => {
        if (broken) throw Error('private clock failure');
        return time;
      },
      schedule: (_delay, cb) => {
        jobs.push(cb);
        return () => {
          if (badCleanup) throw Error('private timer failure');
        };
      },
    });
    const grant = {
      expiresAt: 100,
      request: async (path: string, init: Parameters<CatalogRequest>[1]) => {
        paths.push(path);
        if (path.includes('/proxy-tokens')) return request(path, init);
        return Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
      },
    };
    function fill() {
      root.named('principalId').value = 'human-owner';
      root.named('expiresAt').value = '9000';
    }
    return {
      root,
      app,
      lifecycle,
      jobs,
      paths,
      grant,
      fill,
      authorize: () => app.authorize(grant),
      expire: () => {
        time = 100;
      },
      breakClock: () => {
        broken = true;
      },
      badCleanup: () => {
        badCleanup = true;
      },
    };
  }
  test(
    label +
      ': existing host reaches issue/revoke forms; navigation removes one-time secret without resetting authority',
    async () => {
      const f = fixture(async (path) =>
        path.endsWith('/revoke')
          ? Response.json({ revoked: true })
          : Response.json({ credentialId: 'c', token: 'one-time' }, { status: 201 }),
      );
      f.root.button('Credentials').click();
      f.fill();
      f.root.named('issue').submit();
      f.root
        .all()
        .find((n) => n.textContent === 'Confirm issuance')
        ?.click();
      await settle();
      assert.equal(f.paths.length, 0);
      await f.authorize();
      f.root.button('Credentials').click();
      f.fill();
      f.root.named('issue').submit();
      f.root
        .all()
        .find((n) => n.textContent === 'Confirm issuance')
        ?.click();
      await settle();
      assert.match(f.root.text(), /one-time/);
      f.root.button('Models').click();
      await settle();
      assert.doesNotMatch(f.root.text(), /one-time/);
      f.root.button('Credentials').click();
      assert.doesNotMatch(f.root.text(), /one-time|Reconciliation required/);
      f.root.named('credentialId').value = 'c';
      f.root.named('revoke').submit();
      f.root.button('Confirm revocation').click();
      await settle();
      assert.match(f.root.text(), /Token revoked/);
      assert.equal(f.paths.filter((path) => path.includes('/proxy-tokens')).length, 2);
      f.app.dispose();
    },
  );
  test(
    label +
      ': interrupted host navigation locks later writes across logout, fresh grant and remount',
    async () => {
      let finish!: (value: Response) => void;
      let signal: AbortSignal | undefined;
      const f = fixture(async (_path, init) => {
        signal = init.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      });
      await f.authorize();
      f.root.button('Credentials').click();
      f.fill();
      const old = f.root.named('issue');
      old.submit();
      f.root.button('Confirm issuance').click();
      assert.match(f.root.text(), /Working/);
      f.root.button('Usage history').click();
      await settle();
      assert.equal(signal?.aborted, true);
      f.app.clear();
      await f.authorize();
      f.root.button('Credentials').click();
      assert.match(f.root.text(), /Reconciliation required/);
      old.submit();
      f.fill();
      f.root.named('issue').submit();
      f.root
        .all()
        .find((n) => n.textContent === 'Confirm issuance')
        ?.click();
      finish(Response.json({ credentialId: 'c', token: 'late-secret' }, { status: 201 }));
      await settle();
      assert.doesNotMatch(f.root.text(), /late-secret/);
      assert.equal(f.paths.filter((path) => path.includes('/proxy-tokens')).length, 1);
      f.app.dispose();
    },
  );
  test(
    label + ': host denial clears all views, whereas stale denial cannot clear renewal',
    async () => {
      for (const stale of [false, true]) {
        let finish!: (value: Response) => void;
        const f = fixture(
          async () =>
            new Promise<Response>((resolve) => {
              finish = resolve;
            }),
        );
        await f.authorize();
        f.root.button('Credentials').click();
        f.fill();
        f.root.named('issue').submit();
        f.root
          .all()
          .find((n) => n.textContent === 'Confirm issuance')
          ?.click();
        if (stale) await f.authorize();
        finish(new Response(null, { status: 403 }));
        await settle();
        if (stale) assert.doesNotMatch(f.root.text(), /Access denied/);
        else {
          assert.match(f.root.text(), /Access denied/);
          const count = f.paths.length;
          f.root.button('Models').click();
          await settle();
          assert.match(f.root.text(), /Access denied/);
          assert.equal(f.paths.length, count);
          await f.authorize();
          f.root.button('Credentials').click();
          assert.doesNotMatch(
            f.root.text(),
            /Reconciliation required/,
            'definite denial is not ambiguity',
          );
        }
        f.app.dispose();
      }
    },
  );
  test(
    label +
      ': clear, expiry, pagehide, clock and cleanup failures remove secret and invalidate detached forms',
    async () => {
      for (const action of ['clear', 'expiry', 'hide', 'dispose', 'clock', 'cleanup']) {
        const f = fixture(async () =>
          Response.json({ credentialId: 'c', token: 'one-time' }, { status: 201 }),
        );
        await f.authorize();
        f.root.button('Credentials').click();
        f.fill();
        f.root.named('issue').submit();
        f.root
          .all()
          .find((n) => n.textContent === 'Confirm issuance')
          ?.click();
        await settle();
        assert.match(f.root.text(), /one-time/);
        const old = f.root.named('issue');
        if (action === 'clear') f.app.clear();
        if (action === 'dispose') f.app.dispose();
        if (action === 'hide') f.lifecycle.dispatchEvent(new Event('pagehide'));
        if (action === 'expiry') {
          f.expire();
          old.submit();
        }
        if (action === 'clock') {
          f.breakClock();
          old.submit();
        }
        if (action === 'cleanup') {
          f.badCleanup();
          f.app.clear();
        }
        assert.doesNotMatch(f.root.text(), /one-time/, action);
        const count = f.paths.length;
        old.submit();
        await settle();
        assert.equal(f.paths.length, count, action);
        if (action === 'hide') {
          f.lifecycle.dispatchEvent(new Event('pageshow'));
          f.root.button('Credentials').click();
          f.fill();
          f.root.named('issue').submit();
          f.root
            .all()
            .find((n) => n.textContent === 'Confirm issuance')
            ?.click();
          await settle();
          assert.equal(f.paths.length, count);
        }
        f.app.dispose();
      }
    },
  );
}
