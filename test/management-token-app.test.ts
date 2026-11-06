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
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
for (const [label, mount] of [
  ['source', source],
  ['artifact', built.mountManagementTokens],
] as const) {
  function setup(
    request: Parameters<
      ReturnType<typeof createManagementTokenWorkspace>['authorize']
    >[0]['request'],
  ) {
    let time = 1;
    let expire = () => {};
    const workspace = createManagementTokenWorkspace({
      now: () => time,
      schedule: (_delay, cb) => {
        expire = cb;
        return () => {};
      },
    });
    const root = new TokenElement();
    const app = mount(root, workspace);
    const authorize = () => workspace.authorize({ request, expiresAt: 100 });
    const fill = () => {
      root.named('principalId').value = 'human';
      root.named('expiresAt').value = '9000';
    };
    return {
      root,
      app,
      workspace,
      authorize,
      fill,
      expire: () => {
        time = 100;
        expire();
      },
    };
  }
  test(
    label +
      ': disconnected controls never dispatch; actual forms issue and revoke, secret is text only',
    async () => {
      const calls: string[] = [];
      const h = setup(async (path, init) => {
        calls.push(path);
        assert.equal(init.method, 'POST');
        if (path.endsWith('/revoke')) {
          assert.deepEqual(JSON.parse(String(init.body)), { credentialId: 'c' });
          return Response.json({ revoked: true });
        }
        assert.deepEqual(JSON.parse(String(init.body)), { principalId: 'human', expiresAt: 9000 });
        return Response.json(
          { credentialId: 'c', token: '<script>one-time</script>' },
          { status: 201 },
        );
      });
      h.fill();
      h.root.named('issue').submit();
      await settle();
      assert.equal(calls.length, 0);
      h.authorize();
      h.fill();
      h.root.named('issue').submit();
      await settle();
      assert.match(h.root.text(), /<script>one-time<\/script>/);
      assert.equal(h.root.all().filter((n) => n.tag === 'script').length, 0);
      h.root.named('credentialId').value = 'c';
      h.root.named('revoke').submit();
      await settle();
      assert.match(h.root.text(), /Token revoked/);
      assert.doesNotMatch(h.root.text(), /one-time/);
      assert.equal(calls.length, 2);
      h.app.dispose();
      h.workspace.logout();
    },
  );
  test(label + ': validation, denial, and empty hide do not fabricate success', async () => {
    let calls = 0;
    const h = setup(async () => {
      calls++;
      return new Response(null, { status: 403 });
    });
    h.authorize();
    h.fill();
    h.root.named('expiresAt').value = '9e3';
    h.root.named('issue').submit();
    await settle();
    assert.equal(calls, 0);
    assert.match(h.root.text(), /Enter a principal/);
    h.fill();
    h.root.named('issue').submit();
    await settle();
    assert.match(h.root.text(), /Access denied/);
    assert.equal(calls, 1);
    assert.equal(h.workspace.snapshot().secret, undefined);
    h.app.dispose();
  });
  test(
    label +
      ': stale forms cannot consume new authority; expiry synchronously clears displayed secret',
    async () => {
      let calls = 0;
      const h = setup(async () => {
        calls++;
        return Response.json({ credentialId: 'c', token: 'one-time' }, { status: 201 });
      });
      h.authorize();
      h.fill();
      const stale = h.root.named('issue');
      h.authorize();
      stale.submit();
      await settle();
      assert.equal(calls, 0);
      h.fill();
      h.root.named('issue').submit();
      await settle();
      assert.match(h.root.text(), /one-time/);
      h.expire();
      assert.doesNotMatch(h.root.text(), /one-time/);
      assert.match(h.root.text(), /expired/);
      h.app.dispose();
    },
  );
  test(
    label +
      ': unmount aborts pending issue, new screen/grant cannot reset uncertainty or show late secret',
    async () => {
      let finish!: (value: Response) => void;
      let calls = 0;
      const h = setup(async () => {
        calls++;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      });
      h.authorize();
      h.fill();
      h.root.named('issue').submit();
      assert.match(h.root.text(), /Working/);
      h.app.dispose();
      assert.equal(h.root.children.length, 0);
      assert.equal(h.workspace.snapshot().reconciliationRequired, true);
      h.authorize();
      const root2 = new TokenElement();
      const app2 = mount(root2, h.workspace);
      assert.match(root2.text(), /Reconciliation required/);
      root2.named('principalId').value = 'human';
      root2.named('expiresAt').value = '9000';
      root2.named('issue').submit();
      finish(Response.json({ credentialId: 'c', token: 'late-secret' }, { status: 201 }));
      await settle();
      assert.doesNotMatch(root2.text(), /late-secret/);
      assert.equal(calls, 1);
      app2.dispose();
      h.workspace.logout();
    },
  );
  test(label + ': one-time hide, logout and subscriber errors cannot retain a secret', async () => {
    const h = setup(async () =>
      Response.json({ credentialId: 'c', token: 'one-time' }, { status: 201 }),
    );
    const unsubscribe = h.workspace.subscribe(() => {
      throw Error('private observer');
    });
    h.authorize();
    h.fill();
    h.root.named('issue').submit();
    await settle();
    h.root.button('Hide secret').click();
    assert.doesNotMatch(h.root.text(), /one-time/);
    h.fill();
    h.root.named('issue').submit();
    await settle();
    h.workspace.logout();
    assert.doesNotMatch(h.root.text(), /one-time/);
    unsubscribe();
    h.app.dispose();
  });
  test(label + ': grant replacement clears drafts and cannot publish an old success', async () => {
    const h = setup(async () =>
      Response.json({ credentialId: 'c', token: 'one-time' }, { status: 201 }),
    );
    h.authorize();
    h.fill();
    h.root.named('credentialId').value = 'old-credential';
    let replaced = false;
    const off = h.workspace.subscribe(() => {
      if (!replaced && h.workspace.snapshot().secret) {
        replaced = true;
        h.authorize();
      }
    });
    h.root.named('issue').submit();
    await settle();
    assert.equal(replaced, true);
    assert.doesNotMatch(h.root.text(), /one-time|Token issued/);
    assert.equal(h.root.named('principalId').value, '');
    assert.equal(h.root.named('credentialId').value, '');
    off();
    h.app.dispose();
    h.workspace.logout();
  });
}
