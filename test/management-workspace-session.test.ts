import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountSessionManagementWorkspace } from '../src/management/workspace-session.ts';

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
const model = {
  id: 'approved-model',
  object: 'model',
  created: 1,
  owned_by: 'opengranter',
} as const;
const list = () => Response.json({ object: 'list', data: [model] });
const empty = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
function fixture() {
  const root = new Element();
  let time = 1000;
  let disposedDownloads = 0;
  const timers: { fire(): void; cancelled: boolean }[] = [];
  const app = mountSessionManagementWorkspace(
    root,
    () => ({
      save: () => 'started',
      dispose() {
        disposedDownloads++;
      },
    }),
    {
      now: () => time,
      schedule(_delay, fire) {
        const timer = { fire, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    },
  );
  return {
    root,
    app,
    timers,
    setTime(value: number) {
      time = value;
    },
    downloads: () => disposedDownloads,
  };
}
test('locked start; Models list/detail and Operations use the existing SSO request port', async () => {
  const f = fixture();
  assert.match(text(f.root), /Sign-in required/);
  const paths: string[] = [];
  f.app.authorize({
    expiresAt: 2000,
    request: async (path, init) => {
      assert.equal(init.cache, 'no-store');
      paths.push(path);
      return path.endsWith('/approved-model')
        ? Response.json(model)
        : path.includes('/models')
          ? list()
          : empty();
    },
  });
  assert.match(text(f.root), /Loading models/);
  await tick();
  assert.match(text(f.root), /approved-model/);
  const detail = nodes(f.root).find(
    (n) => n.tag === 'button' && n.textContent?.includes('approved-model'),
  );
  assert.ok(detail);
  detail.listeners.click?.();
  await tick();
  assert.ok(paths.some((p) => p.endsWith('/models/approved-model')));
  click(f.root, 'Operations');
  await tick();
  assert.match(text(f.root), /No history matches/);
  click(f.root, 'Models');
  await tick();
  assert.match(text(f.root), /approved-model/);
  assert.ok(paths.every((p) => p.startsWith('/management/')));
  f.app.dispose();
  assert.equal(text(f.root).trim(), '');
});
for (const status of [401, 403])
  test(`active ${status} clears the entire workspace`, async () => {
    const f = fixture();
    f.app.authorize({ expiresAt: 2000, request: async () => new Response(null, { status }) });
    await tick();
    assert.match(text(f.root), status === 401 ? /Sign-in required/ : /Access denied/);
    assert.equal(nodes(f.root).filter((n) => n.tag === 'nav').length, 0);
    f.app.dispose();
  });
test('navigation disposes issued token output and old native events cannot navigate', async () => {
  const f = fixture();
  let posts = 0;
  f.app.authorize({
    expiresAt: 2000,
    request: async (_path, init) => {
      if (init.method === 'POST') {
        posts++;
        return Response.json(
          { credentialId: 'credential', token: 'synthetic-once' },
          { status: 201 },
        );
      }
      return empty();
    },
  });
  await tick();
  const old = click(f.root, 'Operations');
  await tick();
  click(f.root, 'Proxy tokens');
  enter(f.root, 'Principal ID', 'person');
  enter(f.root, 'Expiry (Unix milliseconds, integer)', '3000');
  click(f.root, 'Review issuance');
  click(f.root, 'Confirm issuance');
  await tick();
  assert.equal(posts, 1);
  assert.match(text(f.root), /synthetic-once/);
  click(f.root, 'Models');
  await tick();
  assert.doesNotMatch(text(f.root), /synthetic-once/);
  old.listeners.click?.();
  assert.doesNotMatch(text(f.root), /Management operations/);
  f.app.dispose();
});
test('missed expiry timer prevents navigation; logout and replacement fence late responses', async () => {
  const f = fixture();
  let resolve!: (r: Response) => void;
  f.app.authorize({
    expiresAt: 2000,
    request: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const old = nodes(f.root).find((n) => n.textContent === 'Operations');
  assert.ok(old);
  f.app.authorize({ expiresAt: 3000, request: async () => list() });
  await tick();
  resolve(new Response(null, { status: 403 }));
  await tick();
  assert.match(text(f.root), /approved-model/);
  old.listeners.click?.();
  assert.match(text(f.root), /approved-model/);
  f.setTime(3000);
  click(f.root, 'Operations');
  assert.match(text(f.root), /Session expired/);
  f.app.clear();
  assert.match(text(f.root), /Sign-in required/);
  f.app.dispose();
});
test('expiry timer clears whole workspace; cancelled old timers cannot clear a replacement', async () => {
  const f = fixture();
  f.app.authorize({ expiresAt: 2000, request: async () => list() });
  await tick();
  const old = [...f.timers];
  f.app.authorize({ expiresAt: 4000, request: async () => list() });
  await tick();
  f.setTime(2000);
  for (const t of old) t.fire();
  assert.match(text(f.root), /approved-model/);
  f.setTime(4000);
  for (const t of [...f.timers]) t.fire();
  assert.match(text(f.root), /Session expired/);
  assert.equal(nodes(f.root).filter((n) => n.tag === 'nav').length, 0);
  f.app.dispose();
});
for (const kind of ['empty', 'error'] as const)
  test(`Models retains ${kind} state inside workspace`, async () => {
    const f = fixture();
    f.app.authorize({
      expiresAt: 2000,
      request: async () => (kind === 'empty' ? empty() : new Response(null, { status: 500 })),
    });
    await tick();
    assert.match(text(f.root), kind === 'empty' ? /No models/ : /catalog unavailable/);
    click(f.root, 'Operations');
    await tick();
    assert.ok(nodes(f.root).some((n) => n.tag === 'nav'));
    f.app.dispose();
  });

test('real local HTTP catalog handler serves list/detail to workspace; navigation fetches history', async () => {
  const { createSsoModelCatalogServer } = await import('../src/gateway/sso-model-catalog-http.ts');
  const calls: string[] = [];
  const server = createSsoModelCatalogServer({
    newRequestId: () => 'workspace-local',
    catalog: {
      async list(...args) {
        calls.push('list');
        assert.equal(args[0], 'synthetic-sso');
        return { state: 'ready', data: [model] };
      },
      async detail(...args) {
        calls.push('detail');
        assert.equal(args[0], 'synthetic-sso');
        return { state: 'ready', data: model };
      },
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const f = fixture();
  try {
    f.app.authorize({
      expiresAt: 2000,
      request: (path, init) =>
        fetch(`http://127.0.0.1:${address.port}${path}`, {
          ...init,
          headers: { authorization: 'Bearer synthetic-sso' },
        }),
    });
    for (let i = 0; i < 100 && !text(f.root).includes('approved-model'); i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.match(text(f.root), /approved-model/);
    const button = nodes(f.root).find(
      (n) => n.tag === 'button' && n.textContent?.includes('approved-model'),
    );
    assert.ok(button);
    button.listeners.click?.();
    for (let i = 0; i < 100 && calls.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(calls, ['list', 'detail']);
    for (let i = 0; i < 100 && text(f.root).includes('Loading'); i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.match(text(f.root), /approved-model/);
  } finally {
    f.app.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
for (const operation of ['models', 'operations'] as const)
  for (const status of [401, 403])
    test(`${operation} current denial prevents reuse of the other screen`, async () => {
      const f = fixture();
      let denied = false;
      f.app.authorize({
        expiresAt: 2000,
        request: async () => (denied ? new Response(null, { status }) : empty()),
      });
      await tick();
      if (operation === 'operations') {
        denied = true;
        click(f.root, 'Operations');
      } else {
        click(f.root, 'Operations');
        await tick();
        denied = true;
        click(f.root, 'Models');
      }
      await tick();
      assert.match(text(f.root), status === 401 ? /Sign-in required/ : /Access denied/);
      assert.equal(nodes(f.root).filter((n) => n.tag === 'nav').length, 0);
      f.app.dispose();
    });
test('navigation aborts an in-flight list and late denial cannot lock Operations', async () => {
  const f = fixture();
  let resolve!: (r: Response) => void;
  let signal: AbortSignal | undefined;
  f.app.authorize({
    expiresAt: 2000,
    request: (path, init) => {
      if (path.endsWith('/models')) {
        signal = init.signal ?? undefined;
        return new Promise((r) => {
          resolve = r;
        });
      }
      return Promise.resolve(empty());
    },
  });
  click(f.root, 'Operations');
  await tick();
  assert.equal(signal?.aborted, true);
  resolve(new Response(null, { status: 403 }));
  await tick();
  assert.match(text(f.root), /No history matches/);
  f.app.dispose();
});
for (const kind of ['clock', 'schedule', 'grant'] as const)
  test(`${kind} uncertainty never dispatches or exposes diagnostics`, () => {
    const root = new Element();
    let calls = 0;
    const app = mountSessionManagementWorkspace(
      root,
      () => ({ save: () => 'started', dispose() {} }),
      {
        now: () => {
          if (kind === 'clock') throw new Error('private-clock');
          return 1000;
        },
        schedule() {
          throw new Error('private-schedule');
        },
      },
    );
    app.authorize({
      expiresAt: kind === 'grant' ? NaN : 2000,
      request: async () => {
        calls++;
        return list();
      },
    });
    assert.equal(calls, 0);
    assert.doesNotMatch(text(root), /private-/);
    assert.match(text(root), /Session expired|Management unavailable/);
    app.dispose();
  });
