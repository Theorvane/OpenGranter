import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createManagementCatalogAuthority,
  createSsoManagementCatalogAuthority,
} from '../src/management/catalog-authority.ts';

const model = { id: 'private/model', object: 'model', created: 0, owned_by: 'opengranter' };
for (const [name, create] of [
  ['proxy', createManagementCatalogAuthority],
  ['SSO', createSsoManagementCatalogAuthority],
] as const) {
  for (const action of ['clear', 'replace', 'dispose'] as const) {
    test(`${name}: throwing timer cleanup cannot interrupt ${action} or publish late data`, async () => {
      let finish!: (response: Response) => void;
      let signal: AbortSignal | null | undefined;
      let calls = 0;
      const states: string[] = [];
      const jobs: (() => void)[] = [];
      const authority = create({
        now: () => 1000,
        onChange: (snapshot) => states.push(snapshot.state),
        schedule: (_delay, callback) => {
          jobs.push(callback);
          return () => {
            throw new Error('private cleanup diagnostics');
          };
        },
      });
      authority.authorize({
        expiresAt: 2000,
        request: (_path, init) => {
          calls++;
          signal = init.signal;
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        },
      });
      const pending = authority.list();
      assert.doesNotThrow(() => {
        if (action === 'clear') authority.clear('unauthenticated');
        else if (action === 'dispose') authority.dispose();
        else
          authority.authorize({
            expiresAt: 3000,
            request: async () => Response.json({ data: [] }),
          });
      });
      assert.equal(signal?.aborted, true);
      jobs[0]?.();
      finish(Response.json({ data: [model] }));
      await pending;
      await authority.list();
      assert.deepEqual(authority.snapshot(), {
        state: action === 'clear' ? 'unauthenticated' : action === 'dispose' ? 'disposed' : 'empty',
      });
      assert.equal(calls, 1);
      assert.ok(!states.includes('list'));
      assert.doesNotThrow(() => authority.dispose());
    });
  }
  for (const status of [401, 403]) {
    test(`${name}: throwing cleanup preserves authentication lock after ${status}`, async () => {
      let calls = 0;
      const authority = create({
        now: () => 1000,
        onChange: () => {},
        schedule: () => () => {
          throw new Error('private timer');
        },
      });
      authority.authorize({
        expiresAt: 2000,
        request: async () => {
          calls++;
          return new Response('private server error', { status });
        },
      });
      await authority.list();
      await authority.list();
      assert.deepEqual(authority.snapshot(), {
        state: status === 401 ? 'unauthenticated' : 'denied',
      });
      assert.equal(calls, 1);
      authority.dispose();
    });
  }
  for (const bad of ['throw', NaN, Infinity, -1] as const) {
    for (const operation of ['snapshot', 'list', 'timer'] as const) {
      test(`${name}: ${String(bad)} trusted clock during ${operation} removes private state`, async () => {
        let broken = false;
        let calls = 0;
        let callback!: () => void;
        const states: string[] = [];
        const authority = create({
          now: () => {
            if (!broken) return 1000;
            if (bad === 'throw') throw new Error('private clock');
            return bad;
          },
          onChange: (snapshot) => states.push(snapshot.state),
          schedule: (_delay, job) => {
            callback = job;
            return () => {};
          },
        });
        authority.authorize({
          expiresAt: 2000,
          request: async () => {
            calls++;
            return Response.json({ data: [model] });
          },
        });
        await authority.list();
        assert.equal(authority.snapshot().state, 'list');
        broken = true;
        if (operation === 'snapshot') assert.doesNotThrow(() => authority.snapshot());
        else if (operation === 'list') await authority.list();
        else assert.doesNotThrow(() => callback());
        assert.deepEqual(authority.snapshot(), { state: 'expired' });
        assert.equal(states.at(-1), 'expired');
        await authority.list();
        assert.equal(calls, 1);
        authority.dispose();
      });
    }
    test(`${name}: ${String(bad)} clock rejects a new grant without scheduling`, async () => {
      const authority = create({
        now: () => {
          if (bad === 'throw') throw new Error('private clock');
          return bad;
        },
        onChange: () => {},
        schedule: () => {
          assert.fail('invalid clock must not schedule');
        },
      });
      assert.doesNotThrow(() =>
        authority.authorize({
          expiresAt: 2000,
          request: async () => {
            assert.fail('invalid clock must not request');
          },
        }),
      );
      assert.deepEqual(authority.snapshot(), { state: 'expired' });
      await authority.list();
      authority.dispose();
    });
  }
  for (const rearm of [false, true]) {
    test(`${name}: scheduler failure on ${rearm ? 'rearm' : 'grant'} revokes request authority`, async () => {
      let callback!: () => void;
      let scheduled = 0;
      let calls = 0;
      const authority = create({
        now: () => 1000,
        onChange: () => {},
        schedule: (_delay, job) => {
          if (scheduled++ > 0 || !rearm) throw new Error('private scheduling diagnostics');
          callback = job;
          return () => {};
        },
      });
      assert.doesNotThrow(() =>
        authority.authorize({
          expiresAt: 2000,
          request: async () => {
            calls++;
            return Response.json({ data: [model] });
          },
        }),
      );
      if (rearm) {
        await authority.list();
        assert.equal(authority.snapshot().state, 'list');
        assert.doesNotThrow(() => callback());
      }
      assert.deepEqual(authority.snapshot(), { state: 'unavailable' });
      await authority.list();
      assert.equal(calls, rearm ? 1 : 0);
      authority.dispose();
    });
  }
}
