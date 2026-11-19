import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountSessionCurrentPrincipal } from '../src/management/current-principal-session.ts';

export class Element implements CatalogElement {
  textContent: string | null = null;
  value = '';
  children: Element[] = [];
  attributes: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  readonly tag: string;
  constructor(tag = 'div') {
    this.tag = tag;
  }
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
    this.textContent = null;
  }
  setAttribute(key: string, value: string) {
    this.attributes[key] = value;
  }
  addEventListener(key: string, listener: () => void) {
    this.listeners[key] = listener;
  }
  focus() {}
}
export const nodes = (root: Element): Element[] => [root, ...root.children.flatMap(nodes)];
export const text = (root: Element) =>
  nodes(root)
    .map((n) => n.textContent ?? '')
    .join(' ');
export const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const reply = (id = '<script>private</script>') => Response.json({ id, kind: 'human' });
function button(root: Element, label: string) {
  const found = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(found);
  return found;
}

test('trusted Account starts locked and expiry removes identity', async () => {
  const root = new Element();
  let now = 100;
  let fire = () => {};
  let calls = 0;
  const app = mountSessionCurrentPrincipal(root, {
    now: () => now,
    schedule: (_delay, callback) => {
      fire = callback;
      return () => {};
    },
  });
  assert.equal(calls, 0);
  app.authorize({
    expiresAt: 200,
    request: async () => {
      calls++;
      return reply('private-human');
    },
  });
  await tick();
  assert.match(text(root), /private-human/);
  now = 200;
  fire();
  assert.doesNotMatch(text(root), /private-human/);
  assert.match(text(root), /expired/i);
  app.dispose();
});
test('logout and replacement abort old response without reviving identity', async () => {
  const root = new Element();
  let finish!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  const app = mountSessionCurrentPrincipal(root);
  app.authorize({
    expiresAt: Date.now() + 60000,
    request: async (_path, init) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
  });
  app.authorize({ expiresAt: Date.now() + 60000, request: async () => reply('new-human') });
  assert.equal(signal?.aborted, true);
  finish(reply('old-human'));
  await tick();
  assert.match(text(root), /new-human/);
  assert.doesNotMatch(text(root), /old-human/);
  const stale = button(root, 'Refresh account');
  app.clear();
  assert.doesNotMatch(text(root), /new-human/);
  stale.listeners.click?.();
  await tick();
  assert.doesNotMatch(text(root), /new-human/);
  app.dispose();
  app.authorize({ expiresAt: Date.now() + 60000, request: async () => reply('revived') });
  assert.equal(text(root), '');
});
test('missed expiry timer during streamed identity read fails closed', async () => {
  const root = new Element();
  let now = 100;
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const app = mountSessionCurrentPrincipal(root, { now: () => now, schedule: () => () => {} });
  app.authorize({
    expiresAt: 200,
    request: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            source = controller;
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  });
  await tick();
  now = 200;
  source.enqueue(new TextEncoder().encode(JSON.stringify({ id: 'late-private', kind: 'human' })));
  await tick();
  assert.doesNotMatch(text(root), /late-private/);
  assert.match(text(root), /expired/i);
  app.dispose();
});
for (const status of [401, 403])
  test(`Account ${status} ends grant`, async () => {
    const root = new Element();
    const app = mountSessionCurrentPrincipal(root);
    app.authorize({
      expiresAt: Date.now() + 60000,
      request: async () => new Response('secret diagnostic', { status }),
    });
    await tick();
    assert.match(text(root), status === 401 ? /sign in/i : /denied/i);
    assert.doesNotMatch(text(root), /secret/);
    assert.equal(nodes(root).filter((node) => node.tag === 'button').length, 0);
    app.dispose();
  });
test('invalid grant and failed scheduling never invoke transport', () => {
  const root = new Element();
  let calls = 0;
  const request = async () => {
    calls++;
    return reply();
  };
  const app = mountSessionCurrentPrincipal(root, {
    now: () => 100,
    schedule: () => {
      throw new Error('private scheduler error');
    },
  });
  app.authorize({ expiresAt: 200, request });
  assert.equal(calls, 0);
  assert.doesNotMatch(text(root), /private/);
  app.authorize({ expiresAt: NaN, request });
  assert.equal(calls, 0);
  app.dispose();
});

test('late headers are discarded after expiry even without timer delivery', async () => {
  const root = new Element();
  let now = 100;
  let cancelled = false;
  let finish!: (response: Response) => void;
  const app = mountSessionCurrentPrincipal(root, { now: () => now, schedule: () => () => {} });
  app.authorize({
    expiresAt: 200,
    request: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  now = 200;
  finish(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    ),
  );
  await tick();
  assert.equal(cancelled, true);
  assert.match(text(root), /expired/i);
  app.dispose();
});
test('expiry between JSON bytes and EOF removes pending identity', async () => {
  const root = new Element();
  let now = 100;
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const app = mountSessionCurrentPrincipal(root, { now: () => now, schedule: () => () => {} });
  app.authorize({
    expiresAt: 200,
    request: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            source = controller;
            controller.enqueue(
              new TextEncoder().encode(JSON.stringify({ id: 'incomplete-private', kind: 'human' })),
            );
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  });
  await tick();
  now = 200;
  source.close();
  await tick();
  assert.doesNotMatch(text(root), /incomplete-private/);
  assert.match(text(root), /expired/i);
  app.dispose();
});
test('uncertain clock at authorization or delivery fails closed', async () => {
  const root = new Element();
  let now = NaN;
  let calls = 0;
  let fire = () => {};
  const app = mountSessionCurrentPrincipal(root, {
    now: () => now,
    schedule: (_delay, callback) => {
      fire = callback;
      return () => {};
    },
  });
  const grant = {
    expiresAt: 200,
    request: async () => {
      calls++;
      return reply('private-human');
    },
  };
  app.authorize(grant);
  assert.equal(calls, 0);
  now = 100;
  app.authorize(grant);
  await tick();
  assert.match(text(root), /private-human/);
  now = NaN;
  fire();
  assert.doesNotMatch(text(root), /private-human/);
  app.dispose();
});
