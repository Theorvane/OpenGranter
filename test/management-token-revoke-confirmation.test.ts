import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { mountManagementTokens as source } from '../src/management/token-management-app.ts';
import { createManagementTokenWorkspace } from '../src/management/token-management-workspace.ts';
import { TokenElement } from './token-management-dom-fixture.ts';

const js = await buildManagementBrowser({
  root: process.cwd(),
  entry: 'src/management/token-management-app.ts',
});
const built = (await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
)) as { mountManagementTokens: typeof source };
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
for (const [label, mount] of [
  ['source', source],
  ['artifact', built.mountManagementTokens],
] as const) {
  function setup() {
    let time = 1;
    const calls: { path: string; body: unknown }[] = [];
    let finish: ((value: Response) => void) | undefined;
    const workspace = createManagementTokenWorkspace({ now: () => time, schedule: () => () => {} });
    const root = new TokenElement();
    const app = mount(root, workspace);
    const authorize = () =>
      workspace.authorize({
        expiresAt: 100,
        request: async (path, init) => {
          calls.push({ path, body: JSON.parse(String(init.body)) });
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        },
      });
    authorize();
    function review(id = 'exact-credential') {
      root.named('credentialId').value = id;
      root.named('revoke').submit();
    }
    return {
      workspace,
      root,
      app,
      calls,
      authorize,
      review,
      expire: () => {
        time = 100;
        workspace.snapshot();
      },
      finish: () => finish?.(Response.json({ revoked: true })),
      close: () => {
        app.dispose();
        workspace.logout();
      },
    };
  }
  test(
    label + ': review and cancel are zero-dispatch; confirm uses captured ID exactly once',
    async () => {
      const f = setup();
      try {
        const id = '<script>credential/α</script>';
        f.review(id);
        assert.equal(f.calls.length, 0);
        const region = f.root
          .all()
          .find((n) => n.attrs['aria-label'] === 'Confirm token revocation');
        assert.ok(region);
        assert.ok(region.text().includes(id));
        assert.equal(region.all().filter((n) => n.tag === 'script').length, 0);
        const cancelled = f.root.button('Confirm revocation');
        f.root.button('Cancel revocation').click();
        cancelled.click();
        assert.equal(f.calls.length, 0);
        f.review(id);
        f.root.named('credentialId').value = 'edited-not-the-confirmed-target';
        const confirm = f.root.button('Confirm revocation');
        confirm.click();
        confirm.click();
        assert.deepEqual(f.calls, [
          { path: '/management/v1/proxy-tokens/revoke', body: { credentialId: id } },
        ]);
        f.finish();
        await settle();
        assert.match(f.root.text(), /Token revoked/);
        assert.equal(f.root.all().filter((n) => n.textContent === 'Confirm revocation').length, 0);
      } finally {
        f.close();
      }
    },
  );
  test(label + ': blank target cannot open review; new review invalidates old controls', () => {
    const f = setup();
    try {
      f.review('');
      assert.equal(f.calls.length, 0);
      assert.equal(f.root.all().filter((n) => n.textContent === 'Confirm revocation').length, 0);
      f.review('first');
      const stale = f.root.button('Confirm revocation');
      const staleCancel = f.root.button('Cancel revocation');
      f.review('second');
      stale.click();
      staleCancel.click();
      assert.equal(f.calls.length, 0);
      f.root.button('Confirm revocation').click();
      assert.deepEqual(f.calls[0]?.body, { credentialId: 'second' });
      f.finish();
    } finally {
      f.close();
    }
  });
  for (const transition of ['renew', 'logout', 'expiry', 'hide', 'dispose', 'issue'] as const) {
    test(
      label + ': ' + transition + ' invalidates pending review and detached confirmation',
      () => {
        const f = setup();
        try {
          f.review();
          const stale = f.root.button('Confirm revocation');
          if (transition === 'renew') f.authorize();
          if (transition === 'logout') f.workspace.logout();
          if (transition === 'expiry') f.expire();
          if (transition === 'hide') f.workspace.hideSecret();
          if (transition === 'dispose') f.app.dispose();
          if (transition === 'issue') f.root.named('issue').submit(); // even invalid issue cancels review
          stale.click();
          assert.equal(f.calls.length, 0);
          assert.equal(
            f.root.all().filter((n) => n.textContent === 'Confirm revocation').length,
            0,
          );
        } finally {
          f.close();
        }
      },
    );
  }
}
