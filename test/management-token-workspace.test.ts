import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { createManagementTokenWorkspace as source } from '../src/management/token-management-workspace.ts';

const js = await buildManagementBrowser({
  root: process.cwd(),
  entry: 'src/management/token-management-workspace.ts',
});
const built = (await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
)) as { createManagementTokenWorkspace: typeof source };
const input = { principalId: 'human', expiresAt: 9000 };
const json = () =>
  new Response(JSON.stringify({ credentialId: 'c', token: 'one-time' }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
for (const [label, create] of [
  ['source', source],
  ['artifact', built.createManagementTokenWorkspace],
] as const) {
  function setup(
    request: Parameters<ReturnType<typeof source>['authorize']>[0]['request'] = async () => json(),
  ) {
    let time = 1;
    let fire = () => {};
    const workspace = create({
      now: () => time,
      schedule: (_delay, callback) => {
        fire = callback;
        return () => {};
      },
    });
    const grant = { request, expiresAt: 100 };
    workspace.authorize(grant);
    return {
      workspace,
      grant,
      fire: () => fire(),
      clock: (value: number) => {
        time = value;
      },
    };
  }
  test(label + ': owns one-time display and clears on navigation/logout', async () => {
    const h = setup();
    assert.deepEqual(await h.workspace.issue(input), { state: 'issued' });
    assert.equal(h.workspace.snapshot().secret?.token, 'one-time');
    h.workspace.hideSecret();
    assert.equal(h.workspace.snapshot().secret, undefined);
    assert.deepEqual(await h.workspace.issue(input), { state: 'issued' });
    h.workspace.logout();
    assert.equal(h.workspace.snapshot().secret, undefined);
    assert.deepEqual(await h.workspace.issue(input), { state: 'disposed' });
  });
  test(label + ': suspended expiry clears already displayed secret on read', async () => {
    const h = setup();
    await h.workspace.issue(input);
    h.clock(100);
    assert.equal(h.workspace.snapshot().secret, undefined);
    assert.deepEqual(await h.workspace.issue(input), { state: 'expired' });
  });
  test(label + ': unknown outcome survives logout, navigation and fresh grants', async () => {
    let calls = 0;
    const h = setup(async () => {
      calls++;
      throw Error('private');
    });
    assert.deepEqual(await h.workspace.issue(input), { state: 'outcome_unknown' });
    h.workspace.hideSecret();
    h.workspace.logout();
    h.workspace.authorize(h.grant);
    assert.equal(h.workspace.snapshot().reconciliationRequired, true);
    assert.deepEqual(await h.workspace.issue(input), { state: 'reconciliation_required' });
    assert.deepEqual(await h.workspace.revoke({ credentialId: 'c' }), {
      state: 'reconciliation_required',
    });
    assert.equal(calls, 1);
    h.workspace.logout();
  });
  test(
    label + ': pending replacement locks synchronously and never publishes late secret',
    async () => {
      let finish!: (response: Response) => void;
      let calls = 0;
      const h = setup(() => {
        calls++;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      });
      const pending = h.workspace.issue(input);
      h.workspace.authorize(h.grant);
      assert.equal(h.workspace.snapshot().reconciliationRequired, true);
      assert.deepEqual(await h.workspace.issue(input), { state: 'reconciliation_required' });
      finish(json());
      assert.deepEqual(await pending, { state: 'outcome_unknown' });
      assert.equal(h.workspace.snapshot().secret, undefined);
      assert.equal(calls, 1);
      h.workspace.logout();
    },
  );
  test(label + ': singleflight and thrown observer cannot break cleanup', async () => {
    let finish!: (response: Response) => void;
    const w = create({
      now: () => 1,
      schedule: () => () => {},
      onChange: () => {
        throw Error('private');
      },
    });
    w.authorize({
      expiresAt: 100,
      request: () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    });
    const pending = w.issue(input);
    assert.deepEqual(await w.revoke({ credentialId: 'c' }), { state: 'busy' });
    finish(json());
    assert.deepEqual(await pending, { state: 'issued' });
    assert.doesNotThrow(() => w.logout());
    assert.equal(w.snapshot().secret, undefined);
  });
  test(
    label + ': successful grant replacement clears old secret without unnecessary lock',
    async () => {
      const h = setup();
      await h.workspace.issue(input);
      h.workspace.authorize(h.grant);
      assert.equal(h.workspace.snapshot().secret, undefined);
      assert.equal(h.workspace.snapshot().reconciliationRequired, false);
      assert.deepEqual(await h.workspace.issue(input), { state: 'issued' });
      h.workspace.logout();
    },
  );
  test(label + ': navigation during issue aborts and locks before returning', async () => {
    const h = setup(() => new Promise<Response>(() => {}));
    const pending = h.workspace.issue(input);
    h.workspace.hideSecret();
    assert.equal(h.workspace.snapshot().reconciliationRequired, true);
    assert.deepEqual(await pending, { state: 'outcome_unknown' });
    assert.equal(h.workspace.snapshot().secret, undefined);
    h.workspace.authorize(h.grant);
    assert.deepEqual(await h.workspace.issue(input), { state: 'reconciliation_required' });
    h.workspace.logout();
  });
  test(
    label + ': explicit denial clears authority but does not invent ambiguous writes',
    async () => {
      const h = setup(async () => new Response(null, { status: 403 }));
      assert.deepEqual(await h.workspace.issue(input), { state: 'denied' });
      assert.equal(h.workspace.snapshot().state, 'disposed');
      assert.equal(h.workspace.snapshot().reconciliationRequired, false);
      h.workspace.authorize({ ...h.grant, request: async () => json() });
      assert.deepEqual(await h.workspace.issue(input), { state: 'issued' });
      h.workspace.logout();
    },
  );

  test(
    label + ': definite denial notifies host after completion without locking fresh authority',
    async () => {
      for (const status of [401, 403]) {
        const states: string[] = [];
        const workspace = create({
          now: () => 1,
          schedule: () => () => {},
          onAuthorityFailure: (state) => {
            states.push(state);
            assert.equal(workspace.snapshot().busy, false);
            workspace.logout();
            throw Error('private observer');
          },
        });
        workspace.authorize({
          expiresAt: 100,
          request: async () => new Response(null, { status }),
        });
        assert.equal(
          (await workspace.issue(input)).state,
          status === 401 ? 'unauthenticated' : 'denied',
        );
        assert.deepEqual(states, [status === 401 ? 'unauthenticated' : 'denied']);
        assert.equal(workspace.snapshot().reconciliationRequired, false);
        workspace.authorize({ expiresAt: 100, request: async () => json() });
        assert.equal((await workspace.issue(input)).state, 'issued');
        workspace.logout();
      }
    },
  );
  test(
    label + ': reentrant renewal during final denial notification suppresses old host invalidation',
    async () => {
      let failures = 0;
      const workspace = create({
        now: () => 1,
        schedule: () => () => {},
        onAuthorityFailure: () => {
          failures++;
        },
      });
      workspace.authorize({
        expiresAt: 100,
        request: async () => new Response(null, { status: 403 }),
      });
      let renewed = false;
      const unsubscribe = workspace.subscribe(() => {
        const state = workspace.snapshot();
        if (!renewed && !state.busy && state.state === 'disposed') {
          renewed = true;
          workspace.authorize({ expiresAt: 100, request: async () => json() });
        }
      });
      await workspace.issue(input);
      assert.equal(renewed, true);
      assert.equal(failures, 0);
      assert.equal((await workspace.issue(input)).state, 'issued');
      unsubscribe();
      workspace.logout();
    },
  );
  test(
    label + ': timer rearm failure clears displayed secret without resetting outcome gates',
    async () => {
      let fire = () => {};
      let schedules = 0;
      let notices = 0;
      const workspace = create({
        now: () => 1,
        schedule: (_delay, callback) => {
          if (++schedules > 1) throw Error('private timer');
          fire = callback;
          return () => {};
        },
        onChange: () => {
          notices++;
        },
      });
      workspace.authorize({ request: async () => json(), expiresAt: 100 });
      assert.deepEqual(await workspace.issue(input), { state: 'issued' });
      assert.equal(workspace.snapshot().secret?.token, 'one-time');
      const previous = notices;
      assert.doesNotThrow(fire);
      assert.equal(notices, previous + 1);
      const snapshot = workspace.snapshot();
      assert.equal(snapshot.secret, undefined);
      assert.equal(snapshot.state, 'expired');
      assert.equal(snapshot.reconciliationRequired, false);
      assert.deepEqual(await workspace.issue(input), { state: 'expired' });
      workspace.logout();
    },
  );
  test(
    label + ': initial scheduling failure cannot retain an earlier one-time secret',
    async () => {
      let schedules = 0;
      const workspace = create({
        now: () => 1,
        schedule: () => {
          if (++schedules > 1) throw Error('private timer');
          return () => {};
        },
      });
      const grant = { request: async () => json(), expiresAt: 100 };
      workspace.authorize(grant);
      await workspace.issue(input);
      assert.equal(workspace.snapshot().secret?.token, 'one-time');
      assert.doesNotThrow(() => workspace.authorize(grant));
      assert.equal(workspace.snapshot().secret, undefined);
      assert.equal(workspace.snapshot().state, 'expired');
      assert.deepEqual(await workspace.revoke({ credentialId: 'c' }), { state: 'expired' });
      workspace.logout();
    },
  );
}
