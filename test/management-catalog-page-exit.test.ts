import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mountManagementCatalog,
  mountSsoManagementCatalog,
} from '../src/management/catalog-app.ts';
import { Element, nodes, text } from './canonical-catalog-dom-fixture.ts';

class Page extends EventTarget {
  observers = 0;
  override addEventListener(...args: Parameters<EventTarget['addEventListener']>) {
    if (args[0] === 'pagehide') this.observers++;
    super.addEventListener(...args);
  }
  override removeEventListener(...args: Parameters<EventTarget['removeEventListener']>) {
    if (args[0] === 'pagehide') this.observers--;
    super.removeEventListener(...args);
  }
  leave(persisted: boolean) {
    const event = new Event('pagehide');
    Object.assign(event, { persisted });
    this.dispatchEvent(event);
  }
}
const model = { id: 'private-model', object: 'model', created: 0, owned_by: 'opengranter' };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
for (const [kind, mount] of [
  ['proxy', mountManagementCatalog],
  ['sso', mountSsoManagementCatalog],
] as const) {
  for (const persisted of [false, true]) {
    test(`${kind} pagehide persisted=${persisted} retires publication and grant terminally`, async () => {
      const root = new Element();
      const page = new Page();
      Object.assign(root.ownerDocument, { defaultView: page });
      const app = mount(root);
      let calls = 0;
      const grant = {
        expiresAt: Date.now() + 60_000,
        request: async () => {
          calls++;
          return Response.json({ data: [model] });
        },
      };
      try {
        await app.authorize(grant);
        assert.match(text(root), /private-model/);
        const search = nodes(root).find((node) => node.tag === 'input');
        assert.ok(search);
        search.value = 'private search';
        const retained = nodes(root).filter((node) => node.tag === 'button');
        page.leave(persisted);
        assert.doesNotMatch(text(root), /private-model/);
        assert.equal(search.value, '');
        assert.equal(page.observers, 0);
        for (const button of retained) button.listeners.click?.();
        page.dispatchEvent(new Event('pageshow'));
        await app.authorize(grant);
        app.clear('denied');
        await tick();
        assert.equal(calls, 1);
        assert.doesNotMatch(text(root), /private-model/);
      } finally {
        app.dispose();
      }
    });
  }
  test(`${kind} exit aborts pending read and discards late ignored-abort publication`, async () => {
    const root = new Element();
    const page = new Page();
    Object.assign(root.ownerDocument, { defaultView: page });
    const app = mount(root);
    let signal: AbortSignal | null | undefined;
    let finish!: (response: Response) => void;
    let cancelled = 0;
    const pending = app.authorize({
      expiresAt: Date.now() + 60_000,
      request: async (_path, init) => {
        signal = init.signal;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      },
    });
    try {
      assert.equal(signal?.aborted, false);
      page.leave(true);
      assert.equal(signal?.aborted, true);
    } finally {
      app.dispose();
      finish(
        new Response(
          new ReadableStream({
            cancel() {
              cancelled++;
            },
          }),
        ),
      );
      await pending;
      await tick();
    }
    assert.equal(cancelled, 1);
    assert.doesNotMatch(text(root), /private-model|Loading models/);
    assert.equal(page.observers, 0);
  });
  test(`${kind} explicit disposal removes its page observer exactly once`, () => {
    const root = new Element();
    const page = new Page();
    Object.assign(root.ownerDocument, { defaultView: page });
    const app = mount(root);
    try {
      assert.equal(page.observers, 1);
    } finally {
      app.dispose();
    }
    app.dispose();
    page.leave(true);
    assert.equal(page.observers, 0);
  });
  test(`${kind} a structural host without a window still supports explicit teardown`, async () => {
    const root = new Element();
    const app = mount(root);
    try {
      await app.authorize({
        expiresAt: Date.now() + 60_000,
        request: async () => Response.json({ data: [model] }),
      });
      assert.match(text(root), /private-model/);
    } finally {
      app.dispose();
    }
    assert.doesNotMatch(text(root), /private-model/);
  });
}

for (const mount of [mountManagementCatalog, mountSsoManagementCatalog]) {
  test(`${mount.name} only a fresh mount can accept a fresh post-exit grant`, async () => {
    const root = new Element();
    const page = new Page();
    Object.assign(root.ownerDocument, { defaultView: page });
    const old = mount(root);
    let calls = 0;
    const grant = {
      expiresAt: Date.now() + 60_000,
      request: async () => {
        calls++;
        return Response.json({ data: [model] });
      },
    };
    await old.authorize(grant);
    page.leave(true);
    const fresh = mount(root);
    try {
      await old.authorize(grant);
      assert.equal(calls, 1);
      await fresh.authorize(grant);
      assert.equal(calls, 2);
      assert.match(text(root), /private-model/);
      old.dispose();
      assert.match(text(root), /private-model/);
      assert.equal(page.observers, 1);
      page.leave(false);
      assert.doesNotMatch(text(root), /private-model/);
      assert.equal(page.observers, 0);
    } finally {
      old.dispose();
      fresh.dispose();
    }
  });
}
