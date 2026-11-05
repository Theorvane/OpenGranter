import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createSsoModelCatalogServer } from '../src/gateway/sso-model-catalog-http.ts';
import { mountSsoManagementCatalog } from '../src/management/sso-catalog-app.ts';

class Element {
  textContent: string | null = null;
  value = '';
  children: Element[] = [];
  attributes: Record<string, string> = {};
  events: Record<string, () => void> = {};
  focused = false;
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
  readonly tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
    this.textContent = null;
  }
  addEventListener(name: string, callback: () => void) {
    this.events[name] = callback;
  }
  focus() {
    this.focused = true;
  }
  text(): string {
    return [this.textContent ?? '', ...this.children.map((n) => n.text())].join(' ');
  }
  find(text: string): Element | undefined {
    return this.tag === 'button' && this.textContent === text
      ? this
      : this.children.map((n) => n.find(text)).find(Boolean);
  }
}
const model = {
  id: 'team/模型',
  object: 'model' as const,
  created: 42,
  owned_by: 'opengranter' as const,
};
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 10));
};
function fixture() {
  const root = new Element('div');
  let time = 1000;
  const jobs: (() => void)[] = [];
  const app = mountSsoManagementCatalog(root, {
    now: () => time,
    schedule: (_delay, callback) => {
      jobs.push(callback);
      return () => {};
    },
  });
  return {
    root,
    app,
    expire() {
      time = 2000;
      jobs[0]?.();
    },
  };
}
test('SSO DOM starts signed out, loads, navigates encoded detail, and clears on expiry', async () => {
  const f = fixture();
  const paths: string[] = [];
  assert.match(f.root.text(), /Sign-in required/);
  const pending = f.app.authorize({
    expiresAt: 2000,
    request: async (path) => {
      paths.push(path);
      return Response.json(path.endsWith('/models') ? { data: [model] } : model);
    },
  });
  assert.match(f.root.text(), /Loading models/);
  await pending;
  assert.ok(f.root.find(model.id));
  f.root.find(model.id)?.events.click?.();
  await settle();
  assert.match(f.root.text(), /Published by/);
  assert.equal(f.root.children[0]?.children[0]?.focused, true);
  assert.deepEqual(paths, [
    '/management/v1/models',
    '/management/v1/models/team%2F%E6%A8%A1%E5%9E%8B',
  ]);
  f.expire();
  assert.match(f.root.text(), /Session expired/);
  assert.ok(!f.root.text().includes(model.id));
  f.app.dispose();
  assert.equal(f.root.children.length, 0);
});
test('empty, unavailable retry, and denied states expose no private response text', async () => {
  const f = fixture();
  let response = () => Response.json({ data: [] });
  await f.app.authorize({ expiresAt: 2000, request: async () => response() });
  assert.match(f.root.text(), /No models available/);
  response = () => new Response('PRIVATE ERROR', { status: 503 });
  f.root.find('Refresh models')?.events.click?.();
  await settle();
  assert.match(f.root.text(), /catalog unavailable/);
  response = () => new Response('PRIVATE ERROR', { status: 403 });
  f.root.find('Back to models')?.events.click?.();
  await settle();
  assert.match(f.root.text(), /Access denied/);
  assert.ok(!f.root.text().includes('PRIVATE'));
  f.app.dispose();
});
test('cleared and replaced identities cannot restore stale DOM after late reads', async () => {
  const f = fixture();
  let finish!: (response: Response) => void;
  const pending = f.app.authorize({
    expiresAt: 2000,
    request: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  f.app.clear('unauthenticated');
  assert.match(f.root.text(), /Sign-in required/);
  await f.app.authorize({ expiresAt: 3000, request: async () => Response.json({ data: [] }) });
  finish(Response.json({ data: [model] }));
  await pending;
  assert.match(f.root.text(), /No models available/);
  assert.ok(!f.root.text().includes(model.id));
  f.app.dispose();
  await f.app.authorize({
    expiresAt: 4000,
    request: async () => {
      throw Error('must not call');
    },
  });
  assert.equal(f.root.children.length, 0);
});
test('loopback SSO HTTP handler feeds DOM and detail navigation without proxy paths', async () => {
  const aliases: string[] = [];
  const server = createSsoModelCatalogServer({
    newRequestId: () => 'dom-test',
    catalog: {
      list: async (token) => {
        assert.equal(token, 'fixture');
        return { state: 'ready', data: [model] };
      },
      detail: async (_token, _id, alias) => {
        aliases.push(alias);
        return { state: 'ready', data: model };
      },
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const f = fixture();
  try {
    const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    await f.app.authorize({
      expiresAt: 2000,
      request: (path, init) =>
        fetch(origin + path, {
          ...init,
          headers: { ...init.headers, authorization: 'Bearer fixture' },
        }),
    });
    assert.ok(f.root.find(model.id));
    f.root.find(model.id)?.events.click?.();
    for (let count = 0; count < 100 && !f.root.text().includes('Published by'); count++)
      await settle();
    assert.match(f.root.text(), /Published by/);
    assert.deepEqual(aliases, [model.id]);
  } finally {
    f.app.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
