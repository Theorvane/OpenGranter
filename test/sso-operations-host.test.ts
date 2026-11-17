import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogRequestInit } from '../src/management/catalog-client.ts';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountSsoManagementOperations } from '../src/management/sso-operations-host.ts';

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

function fixture() {
  const root = new Element();
  let time = 100;
  const timers: { fire(): void; cancelled: boolean }[] = [];
  const calls: { path: string; init: CatalogRequestInit }[] = [];
  let status = 200;
  const host = mountSsoManagementOperations(
    root,
    () => ({
      dispose() {},
      save() {
        return 'unavailable' as const;
      },
    }),
    {
      now: () => time,
      schedule: (_delay: number, fire: () => void) => {
        const timer = { fire, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    },
  );
  const grant = (accessToken = 'synthetic.first') => ({
    accessToken,
    expiresAt: 200,
    request: async (path: string, init: CatalogRequestInit) => {
      calls.push({ path, init });
      return status === 200
        ? Response.json({ id: 'admin', kind: 'human' })
        : new Response(null, { status });
    },
  });
  return {
    root,
    host,
    timers,
    calls,
    grant,
    time: (value: number) => {
      time = value;
    },
    status: (value: number) => {
      status = value;
    },
  };
}

test('approved SSO grant mounts Account; logout aborts bearer and clears retained UI', async () => {
  const f = fixture();
  assert.match(text(f.root), /Sign-in required/);
  f.host.authorize(f.grant());
  click(f.root, 'Account');
  await tick();
  assert.match(text(f.root), /Principal ID.*admin/);
  assert.equal(
    new Headers(f.calls[0]?.init.headers).get('authorization'),
    'Bearer synthetic.first',
  );
  const count = f.calls.length;
  const refresh = nodes(f.root).find((n) => n.textContent === 'Refresh account');
  f.host.clear();
  assert.equal(f.calls[0]?.init.signal?.aborted, true);
  assert.match(text(f.root), /Sign-in required/);
  refresh?.listeners.click?.();
  await tick();
  assert.equal(f.calls.length, count);
  f.host.dispose();
});

test('replacement aborts previous token and stale expiry cannot clear replacement', async () => {
  const f = fixture();
  f.host.authorize(f.grant());
  click(f.root, 'Account');
  await tick();
  const oldTimers = [...f.timers];
  f.host.authorize(f.grant('synthetic.second'));
  assert.equal(f.calls[0]?.init.signal?.aborted, true);
  for (const timer of oldTimers) timer.fire();
  click(f.root, 'Account');
  await tick();
  assert.equal(
    new Headers(f.calls.at(-1)?.init.headers).get('authorization'),
    'Bearer synthetic.second',
  );
  assert.match(text(f.root), /admin/);
  f.host.dispose();
  assert.equal(f.calls.at(-1)?.init.signal?.aborted, true);
  assert.equal(f.root.children.length, 0);
});

test('known expiry clears Account and aborts the token lifetime without another request', async () => {
  const f = fixture();
  f.host.authorize(f.grant());
  click(f.root, 'Account');
  await tick();
  f.time(200);
  for (const timer of [...f.timers]) timer.fire();
  assert.match(text(f.root), /Session expired/);
  assert.doesNotMatch(text(f.root), /admin/);
  assert.equal(f.calls[0]?.init.signal?.aborted, true);
  f.host.dispose();
});

test('fresh 401 and 403 clear private operations and abort bearer lifetime', async () => {
  for (const status of [401, 403]) {
    const f = fixture();
    f.status(status);
    f.host.authorize(f.grant());
    click(f.root, 'Account');
    await tick();
    assert.match(text(f.root), status === 401 ? /Sign-in required/ : /Access denied/);
    assert.equal(f.calls[0]?.init.signal?.aborted, true);
    f.host.dispose();
  }
});

test('invalid credentials replace old authority with generic unavailable boundary', async () => {
  const f = fixture();
  f.host.authorize(f.grant());
  click(f.root, 'Account');
  await tick();
  f.host.authorize(f.grant('invalid secret'));
  assert.equal(f.calls[0]?.init.signal?.aborted, true);
  assert.match(text(f.root), /Management unavailable/);
  assert.doesNotMatch(text(f.root), /invalid secret|admin/);
  f.host.dispose();
});

test('ordinary server outage keeps session available for retry; disposal prevents reauthorization', async () => {
  const f = fixture();
  f.status(503);
  f.host.authorize(f.grant());
  click(f.root, 'Account');
  await tick();
  assert.equal(f.calls.at(-1)?.init.signal?.aborted, false);
  assert.doesNotMatch(text(f.root), /Sign-in required|Access denied/);
  f.host.dispose();
  f.host.authorize(f.grant());
  assert.equal(f.root.children.length, 0);
});

test('expiry scheduler and child scheduler failure fail closed without a request', () => {
  for (const failOn of [1, 2]) {
    const root = new Element();
    let scheduled = 0;
    let calls = 0;
    const host = mountSsoManagementOperations(
      root,
      () => ({
        dispose() {},
        save() {
          return 'unavailable';
        },
      }),
      {
        now: () => 100,
        schedule: () => {
          if (++scheduled === failOn) throw new Error('private scheduler');
          return () => {};
        },
      },
    );
    host.authorize({
      accessToken: 'synthetic.token',
      expiresAt: 200,
      request: async () => {
        ++calls;
        return new Response();
      },
    });
    assert.match(text(root), /Management unavailable/);
    assert.doesNotMatch(text(root), /private scheduler|synthetic.token/);
    assert.equal(calls, 0);
    host.dispose();
  }
});

test('reentrant timer cleanup cannot clear a replacement approved identity', async () => {
  const root = new Element();
  let replace = false;
  const calls: string[] = [];
  const grant = (accessToken: string) => ({
    accessToken,
    expiresAt: 200,
    request: async () => {
      calls.push(accessToken);
      return Response.json({ id: accessToken, kind: 'human' });
    },
  });
  const host = mountSsoManagementOperations(
    root,
    () => ({
      dispose() {},
      save() {
        return 'unavailable';
      },
    }),
    {
      now: () => 100,
      schedule: () => () => {
        if (replace) {
          replace = false;
          host.authorize(grant('synthetic.replacement'));
        }
      },
    },
  );
  host.authorize(grant('synthetic.original'));
  replace = true;
  host.clear();
  click(root, 'Account');
  await tick();
  assert.match(text(root), /synthetic.replacement/);
  host.dispose();
});
