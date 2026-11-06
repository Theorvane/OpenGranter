import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import type { CatalogRequest } from '../src/management/catalog-client.ts';
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

const model = { id: 'team/model', object: 'model', created: 42, owned_by: 'opengranter' };
const settle = async () => {
  await new Promise((done) => setTimeout(done, 0));
};
for (const artifact of [false, true]) {
  const name = artifact ? 'bundle' : 'source';
  async function fixture() {
    const mount: typeof mountSsoManagementCatalog = artifact
      ? (
          await import(
            'data:text/javascript;base64,' +
              Buffer.from(
                await buildManagementBrowser({
                  root: process.cwd(),
                  entry: 'src/management/sso-catalog-app.ts',
                }),
              ).toString('base64')
          )
        ).mountSsoManagementCatalog
      : mountSsoManagementCatalog;
    const root = new Element('div');
    let time = 1000;
    const app = mount(root, { now: () => time, schedule: () => () => {} });
    const click = (label: string) => {
      const control = root.find(label);
      assert.ok(control, label);
      control.events.click?.();
      return control;
    };
    return {
      root,
      app,
      click,
      expire: () => {
        time = 2000;
      },
    };
  }
  test(name + ': cancel hanging list, suppress late data, and explicitly retry', async () => {
    const f = await fixture();
    let finish!: (r: Response) => void;
    let signal!: AbortSignal;
    let calls = 0;
    const request: CatalogRequest = (_path, init) => {
      calls++;
      assert.ok(init.signal);
      signal = init.signal;
      if (calls === 1)
        return new Promise((done) => {
          finish = done;
        });
      return Promise.resolve(Response.json({ data: [model] }));
    };
    const pending = f.app.authorize({ request, expiresAt: 2000 });
    f.click('Cancel catalog request');
    assert.equal(signal.aborted, true);
    assert.match(f.root.text(), /Catalog request cancelled/);
    assert.doesNotMatch(f.root.text(), /Loading models/);
    await pending;
    finish(Response.json({ data: [model] }));
    await settle();
    assert.doesNotMatch(f.root.text(), /team\/model/);
    f.click('Back to models');
    await settle();
    assert.ok(f.root.find(model.id));
    assert.equal(calls, 2);
    f.app.dispose();
  });
  test(
    name + ': cancelled detail does not restore private detail and server Deny stays final',
    async () => {
      const f = await fixture();
      let calls = 0;
      let signal!: AbortSignal;
      await f.app.authorize({
        expiresAt: 2000,
        request: async (_path, init) => {
          calls++;
          if (calls === 1) return Response.json({ data: [model] });
          if (calls === 2) {
            assert.ok(init.signal);
            signal = init.signal;
            return new Promise<Response>(() => {});
          }
          return new Response('PRIVATE', { status: 403 });
        },
      });
      f.click(model.id);
      f.click('Cancel catalog request');
      assert.equal(signal.aborted, true);
      assert.doesNotMatch(f.root.text(), /Published by/);
      f.click('Back to models');
      await settle();
      assert.match(f.root.text(), /Access denied/);
      assert.doesNotMatch(f.root.text(), /PRIVATE/);
      assert.equal(calls, 3);
      f.app.dispose();
    },
  );
  test(name + ': detached cancel cannot interrupt a renewed grant', async () => {
    const f = await fixture();
    const old = f.app.authorize({
      expiresAt: 2000,
      request: () => new Promise<Response>(() => {}),
    });
    const cancel = f.root.find('Cancel catalog request');
    assert.ok(cancel);
    let finish!: (r: Response) => void;
    let signal!: AbortSignal;
    const pending = f.app.authorize({
      expiresAt: 3000,
      request: (_path, init) => {
        assert.ok(init.signal);
        signal = init.signal;
        return new Promise((done) => {
          finish = done;
        });
      },
    });
    cancel.events.click?.();
    assert.equal(signal.aborted, false);
    finish(Response.json({ data: [model] }));
    await Promise.all([old, pending]);
    assert.ok(f.root.find(model.id));
    f.app.dispose();
  });
  test(name + ': detached list and detail cannot replace a newer read', async () => {
    const f = await fixture();
    let calls = 0;
    let signal!: AbortSignal;
    await f.app.authorize({
      expiresAt: 2000,
      request: async (_path, init) => {
        calls++;
        if (calls === 1) return Response.json({ data: [model] });
        assert.ok(init.signal);
        signal = init.signal;
        return new Promise<Response>(() => {});
      },
    });
    const refresh = f.root.find('Refresh models');
    const detail = f.root.find(model.id);
    assert.ok(refresh);
    assert.ok(detail);
    detail.events.click?.();
    refresh.events.click?.();
    detail.events.click?.();
    assert.equal(calls, 2);
    assert.equal(signal.aborted, false);
    f.click('Cancel catalog request');
    f.app.dispose();
  });
  test(name + ': cancellation does not extend grant expiry', async () => {
    const f = await fixture();
    let calls = 0;
    let signal!: AbortSignal;
    const pending = f.app.authorize({
      expiresAt: 2000,
      request: (_path, init) => {
        calls++;
        assert.ok(init.signal);
        signal = init.signal;
        return new Promise<Response>(() => {});
      },
    });
    f.click('Cancel catalog request');
    await pending;
    const retry = f.root.find('Back to models');
    assert.ok(retry);
    f.expire();
    retry.events.click?.();
    assert.match(f.root.text(), /Session expired/);
    assert.equal(calls, 1);
    assert.equal(signal.aborted, true);
    f.app.dispose();
  });
  test(name + ': detached cancellation is inert after logout or disposal', async () => {
    const f = await fixture();
    const pending = f.app.authorize({
      expiresAt: 2000,
      request: () => new Promise<Response>(() => {}),
    });
    const cancel = f.root.find('Cancel catalog request');
    assert.ok(cancel);
    f.app.clear('unauthenticated');
    cancel.events.click?.();
    await pending;
    assert.match(f.root.text(), /Sign-in required/);
    f.app.dispose();
    cancel.events.click?.();
    assert.equal(f.root.children.length, 0);
  });
  test(name + ': detached cancel cannot stop a same-grant retry', async () => {
    const f = await fixture();
    let calls = 0;
    let signal!: AbortSignal;
    const pending = f.app.authorize({
      expiresAt: 2000,
      request: (_path, init) => {
        calls++;
        assert.ok(init.signal);
        signal = init.signal;
        return new Promise<Response>(() => {});
      },
    });
    const oldCancel = f.root.find('Cancel catalog request');
    assert.ok(oldCancel);
    oldCancel.events.click?.();
    await pending;
    f.click('Back to models');
    oldCancel.events.click?.();
    assert.equal(calls, 2);
    assert.equal(signal.aborted, false);
    assert.match(f.root.text(), /Loading models/);
    f.click('Cancel catalog request');
    f.app.dispose();
  });
  test(name + ': cancellation interrupts response body consumption', async () => {
    const f = await fixture();
    let started!: () => void;
    let cancelled = 0;
    const reading = new Promise<void>((done) => {
      started = done;
    });
    const pending = f.app.authorize({
      expiresAt: 2000,
      request: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull() {
              started();
            },
            cancel() {
              cancelled++;
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    });
    await reading;
    f.click('Cancel catalog request');
    await pending;
    assert.equal(cancelled, 1);
    assert.match(f.root.text(), /Catalog request cancelled/);
    f.app.dispose();
  });
}
