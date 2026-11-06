import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { createManagementTokenAuthority as source } from '../src/management/token-management-authority.ts';

const javascript = await buildManagementBrowser({
  root: process.cwd(),
  entry: 'src/management/token-management-authority.ts',
});
const built = (await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
)) as { createManagementTokenAuthority: typeof source };
for (const [label, create] of [
  ['source', source],
  ['artifact', built.createManagementTokenAuthority],
] as const) {
  const input = { principalId: 'human', expiresAt: 9000 };
  const json = (value: unknown, status = 201) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  function setup(request: Parameters<typeof source>[0]['request'], expiry = 100) {
    let time = 1;
    let timer: (() => void) | undefined;
    let cancellations = 0;
    const grant = { request, expiresAt: expiry };
    const authority = create(grant, {
      now: () => time,
      schedule: (_delay, callback) => {
        timer = callback;
        return () => {
          cancellations++;
        };
      },
    });
    return {
      authority,
      grant,
      clock: (value: number) => {
        time = value;
      },
      fire: () => timer?.(),
      cancellations: () => cancellations,
    };
  }
  test(`${label}: one grant issues and revokes then disposes without storing result secrets`, async () => {
    const paths: string[] = [];
    const h = setup(async (path, init) => {
      paths.push(path);
      assert.equal(init.credentials, 'omit');
      return path.endsWith('/revoke')
        ? json({ revoked: false }, 200)
        : json({ credentialId: 'c', token: 't' });
    });
    assert.deepEqual(await h.authority.issue(input), {
      state: 'issued',
      credentialId: 'c',
      token: 't',
    });
    assert.deepEqual(await h.authority.revoke({ credentialId: 'c' }), {
      state: 'revoked',
      revoked: false,
    });
    assert.equal(paths.length, 2);
    h.authority.dispose();
    assert.deepEqual(await h.authority.issue(input), { state: 'disposed' });
    assert.equal(h.cancellations(), 1);
  });
  test(`${label}: suspended timers and changed input grants cannot extend expiry`, async () => {
    let calls = 0;
    const h = setup(async () => {
      calls++;
      return json({ credentialId: 'c', token: 't' });
    });
    h.grant.expiresAt = 10000;
    h.clock(100);
    assert.deepEqual(await h.authority.issue(input), { state: 'expired' });
    h.clock(1);
    assert.deepEqual(await h.authority.revoke({ credentialId: 'c' }), { state: 'expired' });
    assert.equal(calls, 0);
  });
  test(`${label}: invalid expiry or clock never dispatches`, async () => {
    for (const expiry of [NaN, Infinity, -1, 1, 1.5]) {
      let calls = 0;
      const h = setup(async () => {
        calls++;
        return json({ credentialId: 'c', token: 't' });
      }, expiry);
      assert.deepEqual(await h.authority.issue(input), { state: 'expired' });
      assert.equal(calls, 0);
    }
    const h = setup(async () => {
      throw Error('must not dispatch');
    });
    h.clock(NaN);
    assert.deepEqual(await h.authority.issue(input), { state: 'expired' });
  });
  test(`${label}: expiry at completion suppresses returned one-time secret`, async () => {
    const h = setup(async () => {
      h.clock(100);
      return json({ credentialId: 'c', token: 'never expose' });
    });
    assert.deepEqual(await h.authority.issue(input), { state: 'outcome_unknown' });
    assert.deepEqual(await h.authority.issue(input), { state: 'expired' });
  });
  test(`${label}: explicit logout and timer expiry settle uncooperative dispatch`, async () => {
    for (const logout of [true, false]) {
      let resolve!: (value: Response) => void;
      const h = setup(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      );
      const pending = h.authority.issue(input);
      if (logout) h.authority.dispose();
      else {
        h.clock(100);
        h.fire();
      }
      assert.deepEqual(await pending, { state: 'outcome_unknown' });
      resolve(json({ credentialId: 'c', token: 'late' }));
      await new Promise((done) => setImmediate(done));
      assert.deepEqual(await h.authority.issue(input), { state: logout ? 'disposed' : 'expired' });
    }
  });
  test(`${label}: early timers rearm and unknown outcome cannot be reset`, async () => {
    let calls = 0;
    const h = setup(async () => {
      calls++;
      throw Error('private');
    });
    h.fire();
    assert.deepEqual(await h.authority.issue(input), { state: 'outcome_unknown' });
    assert.deepEqual(await h.authority.revoke({ credentialId: 'c' }), {
      state: 'reconciliation_required',
    });
    assert.equal(calls, 1);
    h.authority.dispose();
  });
  test(`${label}: unauthenticated or denied authority cannot dispatch again`, async () => {
    for (const status of [401, 403]) {
      let calls = 0;
      const h = setup(async () => {
        calls++;
        return json({ private: 'hidden' }, status);
      });
      assert.deepEqual(await h.authority.issue(input), {
        state: status === 401 ? 'unauthenticated' : 'denied',
      });
      assert.deepEqual(await h.authority.revoke({ credentialId: 'c' }), { state: 'disposed' });
      assert.equal(calls, 1);
    }
  });
}

for (const [label, create] of [
  ['source', source],
  ['artifact', built.createManagementTokenAuthority],
] as const) {
  test(`${label}: request is snapshotted and a throwing second clock check fails closed`, async () => {
    let calls = 0;
    let originalCalls = 0;
    const grant = {
      request: async () => {
        originalCalls++;
        return new Response(JSON.stringify({ credentialId: 'c', token: 't' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      },
      expiresAt: 100,
    };
    const authority = create(grant, { now: () => 1, schedule: () => () => {} });
    grant.request = async () => {
      calls++;
      throw Error('replacement');
    };
    assert.equal(
      (await authority.issue({ principalId: 'human', expiresAt: 1000 })).state,
      'issued',
    );
    assert.equal(originalCalls, 1);
    assert.equal(calls, 0);
    authority.dispose();
    let reads = 0;
    const closed = create(grant, {
      now: () => {
        if (++reads === 2) throw Error('private clock');
        return 1;
      },
      schedule: () => {
        throw Error('must not schedule');
      },
    });
    assert.deepEqual(await closed.revoke({ credentialId: 'c' }), { state: 'expired' });
    assert.equal(calls, 0);
  });
}
