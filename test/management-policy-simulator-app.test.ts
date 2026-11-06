import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  mountManagementPolicySimulator,
  type PolicySimulationReader,
} from '../src/management/policy-simulator-app.ts';
import { createPostgresPolicySimulator } from '../src/policy/postgres-policy-simulator.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { TokenElement } from './token-management-dom-fixture.ts';

const allowed = {
  effect: 'Allow',
  reason: 'allowed',
  policyVersions: [{ id: 'team-policy', version: 'v1' }],
} as const;
const flush = async () => {
  for (let i = 0; i < 10; ++i) await new Promise<void>((resolve) => setImmediate(resolve));
};
function fixture() {
  const root = new TokenElement();
  let time = 100;
  let expiry: (() => void) | undefined;
  const app = mountManagementPolicySimulator(root, {
    now: () => time,
    schedule: (_delay, callback) => {
      expiry = callback;
      return () => {
        expiry = undefined;
      };
    },
  });
  const submit = (principalId = 'user', action = 'llm:InvokeModel', resource = 'model:chat') => {
    root.named('principalId').value = principalId;
    root.named('action').value = action;
    root.named('resource').value = resource;
    root
      .all()
      .find((n) => n.tag === 'form')
      ?.submit();
  };
  return {
    root,
    app,
    submit,
    expire: () => {
      time = 1000;
      expiry?.();
    },
  };
}

test('screen uses actual current persisted inherited IAM, never grants execution', async () => {
  const db = new PGlite();
  const f = fixture();
  try {
    for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
    await db.exec(
      "INSERT INTO iam_principals VALUES ('user', 'human', true), ('inactive', 'service', false); INSERT INTO iam_roles VALUES ('team'); INSERT INTO iam_principal_roles VALUES ('user', 'team'); INSERT INTO iam_policies VALUES ('team-policy', 'v1', '[]'); INSERT INTO iam_role_policies VALUES ('team', 'team-policy');",
    );
    await db.query('UPDATE iam_policies SET statements = $1::jsonb', [
      JSON.stringify([{ effect: 'Allow', actions: ['llm:*'], resources: ['model:*'] }]),
    ]);
    const simulate = createPostgresPolicySimulator({
      query: (sql, params) => db.query(sql, [...params]),
    });
    const reader: PolicySimulationReader = async (input) => {
      const decision = await simulate(input);
      return decision ? { state: 'ready', decision } : { state: 'missing' };
    };
    assert.match(f.root.text(), /Sign-in required/);
    f.app.connect({ read: reader, expiresAt: 1000 });
    f.submit();
    assert.match(f.root.text(), /Evaluating/);
    await flush();
    assert.match(f.root.text(), /Allow.*allowed.*team-policy.*v1/);
    assert.match(f.root.text(), /not permission to execute/);
    await db.query("UPDATE iam_policies SET version = 'v2', statements = $1::jsonb", [
      JSON.stringify([{ effect: 'Deny', actions: ['llm:*'], resources: ['*'] }]),
    ]);
    f.submit();
    await flush();
    assert.match(f.root.text(), /Deny.*explicit-deny.*v2/);
    f.submit('missing');
    await flush();
    assert.match(f.root.text(), /Principal not found/);
    assert.doesNotMatch(f.root.text(), /team-policy/);
    f.submit('inactive');
    await flush();
    assert.match(f.root.text(), /Deny.*inactive/);
    await db.exec('DROP TABLE iam_role_policies');
    f.submit();
    await flush();
    assert.match(f.root.text(), /Simulation unavailable/);
    assert.doesNotMatch(f.root.text(), /SQL|iam_role|team-policy/);
  } finally {
    f.app.dispose();
    await db.close();
  }
});

test('invalid fields never dispatch; exact text is preserved and projected output is bounded', async () => {
  const f = fixture();
  let calls = 0;
  f.app.connect({
    read: async (input) => {
      ++calls;
      assert.equal(input.principalId, '<img src=x>');
      return {
        state: 'ready',
        decision: {
          ...allowed,
          policyVersions: [{ id: '<script>policy</script>', version: 'v1' }],
        },
      };
    },
    expiresAt: 1000,
  });
  f.submit('');
  await flush();
  assert.equal(calls, 0);
  assert.match(f.root.text(), /Invalid simulation input/);
  f.submit('a'.repeat(257));
  await flush();
  assert.equal(calls, 0);
  f.submit('user', 'a'.repeat(513));
  await flush();
  assert.equal(calls, 0);
  f.submit('user', 'llm:InvokeModel', '');
  await flush();
  assert.equal(calls, 0);
  f.submit('<img src=x>');
  await flush();
  assert.equal(calls, 1);
  assert.match(f.root.text(), /<script>policy<\/script>/);
  assert.equal(f.root.all().filter((n) => n.tag === 'script' || n.tag === 'img').length, 0);
  for (const decision of [
    { ...allowed, reason: 'explicit-deny' },
    { ...allowed, policyVersions: Array(1025).fill({ id: 'x', version: 'v' }) },
    { ...allowed, policyVersions: [{ id: 'x', version: '' }] },
  ]) {
    f.app.connect({ read: async () => ({ state: 'ready', decision }) as never, expiresAt: 1000 });
    f.submit();
    await flush();
    assert.match(f.root.text(), /Simulation unavailable/);
    assert.doesNotMatch(f.root.text(), /team-policy/);
  }
  f.app.dispose();
});

test('generation replacement, cancel, logout and detached controls cannot publish or dispatch stale work', async () => {
  const f = fixture();
  let resolve!: (value: unknown) => void;
  let signal: AbortSignal | undefined;
  let calls = 0;
  f.app.connect({
    read: (_input, options) => {
      ++calls;
      signal = options.signal;
      return new Promise((r) => {
        resolve = r;
      }) as never;
    },
    expiresAt: 1000,
  });
  const oldForm = f.root.all().find((n) => n.tag === 'form');
  f.submit();
  oldForm?.submit();
  assert.equal(calls, 1);
  f.root.button('Cancel').click();
  assert.equal(signal?.aborted, true);
  resolve({ state: 'ready', decision: allowed });
  await flush();
  assert.doesNotMatch(f.root.text(), /team-policy/);
  f.submit();
  const obsolete = resolve;
  f.app.connect({ read: async () => ({ state: 'missing' }), expiresAt: 1000 });
  obsolete({ state: 'ready', decision: allowed });
  await flush();
  assert.doesNotMatch(f.root.text(), /team-policy/);
  oldForm?.submit();
  assert.equal(calls, 2);
  f.submit();
  await flush();
  assert.match(f.root.text(), /Principal not found/);
  f.app.clear();
  assert.match(f.root.text(), /Sign-in required/);
  assert.doesNotMatch(f.root.text(), /Principal not found/);
  f.app.dispose();
  assert.equal(f.root.text(), '');
});

test('expiry and terminal denial discard inputs/results and require fresh trusted reader', async () => {
  for (const state of ['denied', 'unauthenticated'] as const) {
    const f = fixture();
    let calls = 0;
    f.app.connect({
      read: async () => {
        ++calls;
        return { state };
      },
      expiresAt: 1000,
    });
    f.submit();
    await flush();
    assert.match(f.root.text(), state === 'denied' ? /Access denied/ : /Sign-in required/);
    assert.equal(f.root.all().filter((n) => n.tag === 'input').length, 0);
    assert.equal(calls, 1);
    f.app.connect({ read: async () => ({ state: 'ready', decision: allowed }), expiresAt: 1000 });
    f.submit();
    await flush();
    assert.match(f.root.text(), /team-policy/);
    f.expire();
    assert.match(f.root.text(), /Session expired/);
    assert.doesNotMatch(f.root.text(), /team-policy/);
    f.app.dispose();
  }
});

test('deadline aborts pending work and stale expiry callbacks cannot clear a replacement reader', async () => {
  const root = new TokenElement();
  let time = 100;
  const timers: (() => void)[] = [];
  let finish!: (value: unknown) => void;
  let signal: AbortSignal | undefined;
  const app = mountManagementPolicySimulator(root, {
    now: () => time,
    schedule: (_delay, callback) => {
      timers.push(callback);
      return () => {};
    },
  });
  app.connect({
    read: (_input, options) => {
      signal = options.signal;
      return new Promise((resolve) => {
        finish = resolve;
      }) as never;
    },
    expiresAt: 200,
  });
  root.named('principalId').value = 'private-old-principal';
  root.named('action').value = 'llm:InvokeModel';
  root.named('resource').value = 'model:chat';
  root
    .all()
    .find((n) => n.tag === 'form')
    ?.submit();
  time = 200;
  timers[0]?.();
  assert.equal(signal?.aborted, true);
  assert.match(root.text(), /Session expired/);
  finish({ state: 'ready', decision: allowed });
  await flush();
  assert.doesNotMatch(root.text(), /team-policy|private-old-principal/);
  app.connect({ read: async () => ({ state: 'missing' }), expiresAt: 1000 });
  timers[0]?.();
  assert.match(root.text(), /Enter the exact/);
  root.named('principalId').value = 'new';
  root.named('action').value = 'llm:InvokeModel';
  root.named('resource').value = 'model:chat';
  root
    .all()
    .find((n) => n.tag === 'form')
    ?.submit();
  await flush();
  assert.match(root.text(), /Principal not found/);
  app.dispose();
  for (const timer of timers) timer();
  assert.equal(root.text(), '');
});

test('broken clocks, scheduling and cleanup fail closed without preserving diagnostic data', async () => {
  for (const mode of ['clock', 'schedule', 'cleanup', 'rearm'] as const) {
    const root = new TokenElement();
    let broken = false;
    let calls = 0;
    let callback: (() => void) | undefined;
    const app = mountManagementPolicySimulator(root, {
      now: () => {
        if (broken && mode === 'clock') throw new Error('private clock');
        return 100;
      },
      schedule: (_delay, next) => {
        ++calls;
        if (mode === 'schedule' || (mode === 'rearm' && calls > 1))
          throw new Error('private scheduler');
        callback = next;
        return () => {
          if (mode === 'cleanup') throw new Error('private cleanup');
        };
      },
    });
    app.connect({ read: async () => ({ state: 'ready', decision: allowed }), expiresAt: 1000 });
    if (mode === 'schedule') {
      assert.match(root.text(), /Session expired/);
      app.dispose();
      continue;
    }
    root.named('principalId').value = 'user';
    root.named('action').value = 'llm:InvokeModel';
    root.named('resource').value = 'model:chat';
    root
      .all()
      .find((n) => n.tag === 'form')
      ?.submit();
    await flush();
    assert.match(root.text(), /team-policy/);
    if (mode === 'cleanup') app.clear();
    else {
      broken = true;
      callback?.();
    }
    assert.doesNotMatch(root.text(), /team-policy|private clock|private scheduler|private cleanup/);
    assert.equal(root.all().filter((n) => n.tag === 'input').length, 0);
    app.dispose();
  }
});

test('supported browser artifact runs the disconnected screen without server dependencies', async () => {
  const { resolve } = await import('node:path');
  const { buildManagementBrowser } = await import('../scripts/build-management-browser.ts');
  const code = await buildManagementBrowser({
    root: resolve('.'),
    entry: 'src/management/policy-simulator-app.ts',
  });
  assert.doesNotMatch(code, /node:|process\.env|SELECT |INSERT INTO|PGlite|sourceMappingURL/);
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  );
  const root = new TokenElement();
  const app = module.mountManagementPolicySimulator(root, {
    now: () => 100,
    schedule: () => () => {},
  });
  assert.match(root.text(), /Sign-in required/);
  app.connect({ read: async () => ({ state: 'ready', decision: allowed }), expiresAt: 1000 });
  root.named('principalId').value = 'browser-principal';
  root.named('action').value = 'llm:InvokeModel';
  root.named('resource').value = 'model:chat';
  root
    .all()
    .find((n) => n.tag === 'form')
    ?.submit();
  await flush();
  assert.match(
    root.text(),
    /Principal: browser-principal; Action: llm:InvokeModel; Resource: model:chat/,
  );
  assert.match(root.text(), /Allow.*allowed.*team-policy.*v1/);
  app.dispose();
});
