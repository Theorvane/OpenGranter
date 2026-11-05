import assert from 'node:assert/strict';
import test from 'node:test';
import { mountSsoManagementCatalogPage } from '../src/management/sso-catalog-page.ts';

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

function fixture() {
  const root = new Element('div');
  const lifecycle = new EventTarget();
  let calls = 0;
  const app = mountSsoManagementCatalogPage(root, lifecycle, {
    now: () => 1000,
    schedule: () => () => {},
  });
  const grant = {
    expiresAt: 2000,
    request: async () => {
      calls++;
      return Response.json({
        data: [{ id: 'private/model', object: 'model', created: 1, owned_by: 'opengranter' }],
      });
    },
  };
  return { root, lifecycle, app, grant, calls: () => calls };
}
test('pagehide erases private DOM; pageshow never reuses prior grant', async () => {
  const f = fixture();
  await f.app.authorize(f.grant);
  assert.ok(f.root.find('private/model'));
  f.lifecycle.dispatchEvent(new Event('pagehide'));
  assert.match(f.root.text(), /Sign-in required/);
  assert.ok(!f.root.text().includes('private'));
  await f.app.authorize(f.grant);
  assert.equal(f.calls(), 1, 'hidden page cannot accept authority');
  f.lifecycle.dispatchEvent(new Event('pageshow'));
  assert.equal(f.calls(), 1, 'bfcache restore must not fetch with old authority');
  assert.match(f.root.text(), /Sign-in required/);
  await f.app.authorize(f.grant);
  assert.ok(f.root.find('private/model'));
  assert.equal(f.calls(), 2);
  f.app.dispose();
});
test('pagehide cancels outstanding HTTP and prevents stale completion after restore', async () => {
  const f = fixture();
  let finish!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  const pending = f.app.authorize({
    expiresAt: 2000,
    request: (_path, init) => {
      signal = init.signal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
  });
  assert.match(f.root.text(), /Loading/);
  f.lifecycle.dispatchEvent(new Event('pagehide'));
  assert.equal(signal?.aborted, true);
  f.lifecycle.dispatchEvent(new Event('pageshow'));
  await f.app.authorize({ ...f.grant, request: async () => Response.json({ data: [] }) });
  finish(
    Response.json({ data: [{ id: 'old/secret', object: 'model', created: 1, owned_by: 'old' }] }),
  );
  await pending;
  assert.match(f.root.text(), /No models available/);
  assert.ok(!f.root.text().includes('secret'));
  f.app.dispose();
});
test('ordinary visibility changes retain state; disposal removes lifecycle listeners', async () => {
  const root = new Element('div');
  const added: string[] = [];
  const removed: string[] = [];
  const target = new EventTarget();
  const lifecycle = {
    addEventListener: (...args: Parameters<EventTarget['addEventListener']>) => {
      added.push(args[0]);
      target.addEventListener(...args);
    },
    removeEventListener: (...args: Parameters<EventTarget['removeEventListener']>) => {
      removed.push(args[0]);
      target.removeEventListener(...args);
    },
  };
  const app = mountSsoManagementCatalogPage(root, lifecycle, {
    now: () => 1000,
    schedule: () => () => {},
  });
  let calls = 0;
  const grant = {
    expiresAt: 2000,
    request: async () => {
      calls++;
      return Response.json({ data: [] });
    },
  };
  await app.authorize(grant);
  target.dispatchEvent(new Event('visibilitychange'));
  assert.match(root.text(), /No models available/);
  app.dispose();
  app.dispose();
  assert.deepEqual(added, ['pagehide', 'pageshow']);
  assert.deepEqual(removed, added);
  target.dispatchEvent(new Event('pagehide'));
  target.dispatchEvent(new Event('pageshow'));
  await app.authorize(grant);
  assert.equal(calls, 1);
  assert.equal(root.children.length, 0);
});
