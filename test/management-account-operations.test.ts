import assert from 'node:assert/strict';
import { test } from 'node:test';
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

test('Account navigation disposes history and returns through fresh GETs', async () => {
  const f = fixture();
  const calls: string[] = [];
  f.app.authorize({
    expiresAt: 2000,
    request: async (path) => {
      calls.push(path);
      return path === '/management/v1/principal'
        ? Response.json({ id: 'human-1', kind: 'human' })
        : empty();
    },
  });
  await tick();
  click(f.root, 'Account');
  await tick();
  assert.match(text(f.root), /human-1/);
  assert.equal(f.disposals(), 1);
  assert.equal(
    nodes(f.root).find((n) => n.textContent === 'Account' && n.tag === 'button')?.attributes[
      'aria-pressed'
    ],
    'true',
  );
  const refresh = nodes(f.root).find((n) => n.textContent === 'Refresh account');
  assert.ok(refresh);
  click(f.root, 'History');
  assert.doesNotMatch(text(f.root), /human-1/);
  refresh.listeners.click?.();
  await tick();
  assert.deepEqual(calls, [
    '/management/v1/usage?format=json',
    '/management/v1/principal',
    '/management/v1/usage?format=json',
  ]);
  f.app.dispose();
});

for (const status of [401, 403])
  test(`Account denial locks all operations navigation: ${status}`, async () => {
    const f = fixture();
    let calls = 0;
    f.app.authorize({
      expiresAt: 2000,
      request: async (path) => {
        calls++;
        return path === '/management/v1/principal' ? new Response('private', { status }) : empty();
      },
    });
    await tick();
    const old = click(f.root, 'Account');
    await tick();
    assert.match(text(f.root), status === 401 ? /Sign-in required/ : /Access denied/);
    assert.doesNotMatch(text(f.root), /private|Management operations/);
    old.listeners.click?.();
    assert.equal(calls, 2);
    f.app.dispose();
  });

test('Account late streamed identity cannot survive expiry with a missed timer', async () => {
  const f = fixture();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  f.app.authorize({
    expiresAt: 2000,
    request: async (path) =>
      path === '/management/v1/principal'
        ? new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                stream = c;
              },
            }),
            { headers: { 'content-type': 'application/json' } },
          )
        : empty(),
  });
  await tick();
  click(f.root, 'Account');
  await tick();
  assert.match(text(f.root), /Loading account/);
  f.setTime(2000);
  stream.enqueue(new TextEncoder().encode(JSON.stringify({ id: 'late-human', kind: 'human' })));
  stream.close();
  await tick();
  await tick();
  assert.match(text(f.root), /Session expired/);
  assert.doesNotMatch(text(f.root), /late-human|Account|Management operations/);
  f.app.dispose();
});

test('Account logout aborts pending read; replacement identity rejects stale completion', async () => {
  const f = fixture();
  let finish!: (r: Response) => void;
  let signal: AbortSignal | undefined;
  f.app.authorize({
    expiresAt: 2000,
    request: async (path, init) => {
      if (path !== '/management/v1/principal') return empty();
      signal = init.signal ?? undefined;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
  });
  await tick();
  click(f.root, 'Account');
  f.app.clear();
  assert.equal(signal?.aborted, true);
  assert.doesNotMatch(text(f.root), /Account|Loading/);
  f.app.authorize({
    expiresAt: 3000,
    request: async (path) =>
      path === '/management/v1/principal'
        ? Response.json({ id: 'replacement-human', kind: 'human' })
        : empty(),
  });
  await tick();
  click(f.root, 'Account');
  await tick();
  finish(Response.json({ id: 'old-human', kind: 'human' }));
  await tick();
  assert.match(text(f.root), /replacement-human/);
  assert.doesNotMatch(text(f.root), /old-human/);
  f.app.dispose();
});
