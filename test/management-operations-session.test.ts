import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountSessionManagementOperations } from '../src/management/operations-session.ts';

class Element implements CatalogElement {
  textContent: string | null = null;
  value = '';
  attributes: Record<string, string> = {};
  children: Element[] = [];
  listeners: Record<string, () => void> = {};
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
  readonly tag: string;
  constructor(tag = 'div') {
    this.tag = tag;
  }
  setAttribute(key: string, value: string) {
    this.attributes[key] = value;
  }
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
    this.textContent = null;
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners[type] = listener;
  }
  focus() {}
}
const nodes = (root: Element): Element[] => [root, ...root.children.flatMap(nodes)];
const text = (root: Element) =>
  nodes(root)
    .map((n) => n.textContent ?? '')
    .join(' ');
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function click(root: Element, label: string) {
  const button = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(button, label);
  button.listeners.click?.();
  return button;
}
function enter(root: Element, label: string, value: string) {
  const input = nodes(root).find((n) => n.tag === 'label' && n.textContent === label)?.children[0];
  assert.ok(input, label);
  input.value = value;
}
const empty = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
function fixture() {
  const root = new Element();
  let time = 1000;
  let disposals = 0;
  const timers: { delay: number; fire(): void; cancelled: boolean }[] = [];
  const options = {
    now: () => time,
    schedule(delay: number, callback: () => void) {
      const timer = { delay, fire: callback, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  };
  const download = () => ({
    save: () => 'started' as const,
    dispose() {
      disposals++;
    },
  });
  const app = mountSessionManagementOperations(root, download, options);
  return {
    root,
    app,
    timers,
    download,
    options,
    setTime(value: number) {
      time = value;
    },
    disposals: () => disposals,
  };
}
test('starts locked; trusted authorization performs history GET and logout aborts/clears', async () => {
  const f = fixture();
  assert.match(text(f.root), /Sign-in required/);
  let calls = 0;
  f.app.authorize({
    expiresAt: 2000,
    request: async () => {
      calls++;
      return empty();
    },
  });
  await tick();
  assert.equal(calls, 1);
  assert.match(text(f.root), /No history matches/);
  assert.equal(f.timers[0]?.delay, 1000);
  f.app.clear();
  assert.match(text(f.root), /Sign-in required/);
  assert.equal(f.disposals(), 1);
  assert.equal(f.timers[0]?.cancelled, true);
  f.app.dispose();
});
test('known expiry erases a retained issued token node and disables detached controls', async () => {
  const f = fixture();
  let calls = 0;
  f.app.authorize({
    expiresAt: 2000,
    request: async (_path, init) => {
      calls++;
      return init.method === 'POST'
        ? Response.json({ credentialId: 'credential', token: 'synthetic-secret' }, { status: 201 })
        : empty();
    },
  });
  await tick();
  click(f.root, 'Proxy tokens');
  enter(f.root, 'Principal ID', 'person');
  enter(f.root, 'Expiry (Unix milliseconds, integer)', '3000');
  click(f.root, 'Review issuance');
  click(f.root, 'Confirm issuance');
  await tick();
  const secret = nodes(f.root).find((n) => n.textContent === 'synthetic-secret');
  assert.ok(secret);
  const retained = nodes(f.root);
  f.setTime(2000);
  f.timers[0]?.fire();
  assert.equal(secret.textContent, '');
  assert.match(text(f.root), /Session expired/);
  for (const node of retained) node.listeners.click?.();
  await tick();
  assert.equal(calls, 2);
  f.app.dispose();
});
test('a missed timer cannot authorize a mutation after the known deadline', async () => {
  const f = fixture();
  let calls = 0;
  f.app.authorize({
    expiresAt: 2000,
    request: async () => {
      calls++;
      return empty();
    },
  });
  await tick();
  click(f.root, 'Proxy tokens');
  enter(f.root, 'Credential ID', 'credential');
  click(f.root, 'Review revocation');
  f.setTime(2000);
  click(f.root, 'Confirm revocation');
  await tick();
  assert.equal(calls, 1);
  assert.match(text(f.root), /Session expired/);
  f.app.dispose();
});
test('identity replacement aborts the old request; late denial and stale timer cannot erase new grant', async () => {
  const f = fixture();
  let signal: AbortSignal | null | undefined;
  let finish: (response: Response) => void = () => assert.fail('not pending');
  f.app.authorize({
    expiresAt: 2000,
    request: async (_path, init) => {
      signal = init.signal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
  });
  f.app.authorize({ expiresAt: 4000, request: async () => empty() });
  await tick();
  assert.equal(signal?.aborted, true);
  f.setTime(2000);
  f.timers[0]?.fire();
  finish(new Response(null, { status: 403 }));
  await tick();
  assert.match(text(f.root), /No history matches/);
  assert.doesNotMatch(text(f.root), /Access denied|Session expired/);
  f.app.dispose();
});
test('late successful completion after deadline is hidden even without timer delivery', async () => {
  const f = fixture();
  let finish: (response: Response) => void = () => assert.fail('not pending');
  f.app.authorize({
    expiresAt: 2000,
    request: async () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  });
  f.setTime(2000);
  finish(empty());
  await tick();
  assert.match(text(f.root), /Session expired/);
  assert.equal(f.disposals(), 1);
  f.app.dispose();
});
for (const status of [401, 403]) {
  test(`server ${status} clears child and cancels grant timer`, async () => {
    const f = fixture();
    f.app.authorize({ expiresAt: 2000, request: async () => new Response(null, { status }) });
    await tick();
    assert.match(text(f.root), status === 401 ? /Sign-in required/ : /Access denied/);
    assert.equal(f.disposals(), 1);
    assert.equal(f.timers[0]?.cancelled, true);
    f.app.dispose();
  });
}
test('invalid grants and clock uncertainty never start requests', () => {
  for (const expiry of [0, 1000, NaN, Infinity, 1000.5]) {
    const f = fixture();
    let calls = 0;
    f.app.authorize({
      expiresAt: expiry,
      request: async () => {
        calls++;
        return empty();
      },
    });
    assert.match(text(f.root), /Session expired/);
    assert.equal(calls, 0);
    f.app.dispose();
  }
  const root = new Element();
  const app = mountSessionManagementOperations(
    root,
    () => ({ save: () => 'started', dispose() {} }),
    {
      now() {
        throw new Error('PRIVATE');
      },
    },
  );
  app.authorize({ expiresAt: 2000, request: async () => assert.fail('unauthorized') });
  assert.match(text(root), /Session expired/);
  assert.doesNotMatch(text(root), /PRIVATE/);
  app.dispose();
});
test('scheduler failure locks before transport; cleanup exceptions cannot preserve content', async () => {
  const root = new Element();
  let calls = 0;
  let time = 1000;
  const app = mountSessionManagementOperations(
    root,
    () => ({ save: () => 'started', dispose() {} }),
    {
      now: () => time,
      schedule() {
        throw new Error('PRIVATE');
      },
    },
  );
  app.authorize({
    expiresAt: 2000,
    request: async () => {
      calls++;
      return empty();
    },
  });
  assert.equal(calls, 0);
  assert.match(text(root), /Management unavailable/);
  assert.doesNotMatch(text(root), /PRIVATE/);
  app.dispose();
  const second = mountSessionManagementOperations(
    root,
    () => ({ save: () => 'started', dispose() {} }),
    {
      now: () => time,
      schedule() {
        return () => {
          throw new Error('PRIVATE');
        };
      },
    },
  );
  second.authorize({ expiresAt: 2000, request: async () => empty() });
  await tick();
  time = 2000;
  assert.doesNotThrow(() => second.clear());
  assert.match(text(root), /Sign-in required/);
  second.dispose();
});
test('early timer re-arms, long deadlines are capped, and dispose is terminal', async () => {
  const f = fixture();
  let calls = 0;
  f.app.authorize({
    expiresAt: 5000000000,
    request: async () => {
      calls++;
      return empty();
    },
  });
  await tick();
  assert.equal(f.timers[0]?.delay, 2147483647);
  f.timers[0]?.fire();
  assert.equal(f.timers.length, 2);
  f.app.dispose();
  f.app.dispose();
  f.timers[1]?.fire();
  f.app.authorize({
    expiresAt: 6000000000,
    request: async () => {
      calls++;
      return empty();
    },
  });
  f.app.clear();
  assert.equal(calls, 1);
  assert.equal(f.root.children.length, 0);
});
test('session operations builds within the canonical browser-only boundary', async () => {
  const javascript = await buildManagementBrowser({
    root: process.cwd(),
    entry: 'src/management/operations-session.ts',
  });
  assert.match(javascript, /mountSessionManagementOperations/);
  assert.doesNotMatch(javascript, /process\.env|node:|localStorage/);
});

test('logout aborts pending transport and ignores its successful late completion', async () => {
  const f = fixture();
  let signal: AbortSignal | null | undefined;
  let finish: (response: Response) => void = () => assert.fail('not pending');
  f.app.authorize({
    expiresAt: 2000,
    request: async (_path, init) => {
      signal = init.signal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
  });
  f.app.clear();
  assert.equal(signal?.aborted, true);
  finish(empty());
  await tick();
  assert.match(text(f.root), /Sign-in required/);
  f.app.dispose();
});
test('aborted prior-screen denial cannot terminate the current grant', async () => {
  const f = fixture();
  let finish: (response: Response) => void = () => assert.fail('not pending');
  f.app.authorize({
    expiresAt: 2000,
    request: async (_path, init) => {
      if (init.method !== 'POST') return empty();
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
  });
  await tick();
  click(f.root, 'Proxy tokens');
  enter(f.root, 'Credential ID', 'credential');
  click(f.root, 'Review revocation');
  click(f.root, 'Confirm revocation');
  click(f.root, 'History');
  finish(new Response(null, { status: 403 }));
  await tick();
  assert.match(text(f.root), /No history matches/);
  assert.equal(f.timers[0]?.cancelled, false);
  f.app.dispose();
});
test('clock failure after initial validation does not schedule a nonfinite delay', () => {
  const root = new Element();
  let reads = 0;
  let timers = 0;
  let calls = 0;
  const app = mountSessionManagementOperations(
    root,
    () => ({ save: () => 'started', dispose() {} }),
    {
      now() {
        return ++reads < 3 ? 1000 : NaN;
      },
      schedule(delay) {
        timers++;
        assert.ok(Number.isFinite(delay));
        return () => {};
      },
    },
  );
  app.authorize({
    expiresAt: 2000,
    request: async () => {
      calls++;
      return empty();
    },
  });
  assert.equal(timers, 0);
  assert.equal(calls, 0);
  assert.match(text(root), /Session expired/);
  app.dispose();
});
test('reentrant grant replacement during download construction cannot clear the new child', async () => {
  const root = new Element();
  let visits = 0;
  let cleanups = 0;
  const request = async () => empty();
  const app = mountSessionManagementOperations(
    root,
    () => {
      if (++visits === 1) app.authorize({ expiresAt: 3000, request });
      return {
        save: () => 'started',
        dispose() {
          cleanups++;
        },
      };
    },
    { now: () => 1000, schedule: () => () => {} },
  );
  app.authorize({ expiresAt: 2000, request });
  await tick();
  assert.match(text(root), /No history matches/);
  assert.equal(cleanups, 1);
  app.dispose();
  assert.equal(cleanups, 2);
  assert.equal(root.children.length, 0);
});

for (const late of ['bytes', 'eof'] as const) {
  test(`streamed issuance rejects late ${late} after expiry without timer delivery`, async () => {
    const f = fixture();
    let source: ReadableStreamDefaultController<Uint8Array> | undefined;
    let cancelled = 0;
    f.app.authorize({
      expiresAt: 2000,
      request: async (_path, init) =>
        init.method !== 'POST'
          ? empty()
          : new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  source = controller;
                },
                cancel() {
                  cancelled++;
                },
              }),
              { status: 201, headers: { 'content-type': 'application/json' } },
            ),
    });
    await tick();
    click(f.root, 'Proxy tokens');
    enter(f.root, 'Principal ID', 'person');
    enter(f.root, 'Expiry (Unix milliseconds, integer)', '3000');
    click(f.root, 'Review issuance');
    click(f.root, 'Confirm issuance');
    await tick();
    assert.ok(source);
    const bytes = new TextEncoder().encode(
      JSON.stringify({ credentialId: 'credential', token: 'synthetic-secret' }),
    );
    if (late === 'eof') {
      source.enqueue(bytes);
      await tick();
    }
    f.setTime(2000);
    if (late === 'bytes') source.enqueue(bytes);
    else source.close();
    await tick();
    assert.match(text(f.root), /Session expired/);
    assert.doesNotMatch(text(f.root), /synthetic-secret/);
    if (late === 'bytes') assert.equal(cancelled, 1);
    f.app.dispose();
  });
}

for (const outcome of ['success', 'logout', 'replace', 'navigate', 'failure'] as const) {
  test(`streamed issuance handles ${outcome} without stale publication or private diagnostics`, async () => {
    const f = fixture();
    let source: ReadableStreamDefaultController<Uint8Array> | undefined;
    let cancelled = 0;
    f.app.authorize({
      expiresAt: 2000,
      request: async (_path, init) =>
        init.method !== 'POST'
          ? empty()
          : new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  source = controller;
                },
                cancel() {
                  cancelled++;
                },
              }),
              { status: 201, headers: { 'content-type': 'application/json' } },
            ),
    });
    await tick();
    click(f.root, 'Proxy tokens');
    enter(f.root, 'Principal ID', 'person');
    enter(f.root, 'Expiry (Unix milliseconds, integer)', '3000');
    click(f.root, 'Review issuance');
    click(f.root, 'Confirm issuance');
    await tick();
    assert.ok(source);
    const bytes = new TextEncoder().encode(
      JSON.stringify({ credentialId: 'credential', token: 'synthetic-secret' }),
    );
    source.enqueue(bytes.subarray(0, 20));
    await tick();
    if (outcome === 'success') {
      source.enqueue(bytes.subarray(20));
      source.close();
      await tick();
      assert.match(text(f.root), /synthetic-secret/);
    } else if (outcome === 'failure') {
      source.error(new Error('private-source-diagnostic'));
      await tick();
      assert.doesNotMatch(text(f.root), /synthetic-secret|private-source-diagnostic/);
      assert.match(text(f.root), /outcome is unknown/i);
    } else {
      if (outcome === 'logout') f.app.clear();
      if (outcome === 'replace') f.app.authorize({ expiresAt: 4000, request: async () => empty() });
      if (outcome === 'navigate') click(f.root, 'History');
      await tick();
      assert.equal(cancelled, 1);
      assert.doesNotMatch(text(f.root), /synthetic-secret/);
      f.setTime(2000);
      f.timers[0]?.fire();
      assert.match(
        text(f.root),
        outcome === 'logout'
          ? /Sign-in required/
          : outcome === 'replace'
            ? /No history matches/
            : /Session expired/,
      );
    }
    f.app.dispose();
  });
}
