import assert from 'node:assert/strict';
import { createServer } from 'node:http';
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
for (const outcome of ['logout', 'expiry', 'replacement', 'dispose', 'navigation'] as const) {
  test(`pending source body is cancelled immediately on ${outcome}`, async () => {
    const f = fixture();
    let cancelled = 0;
    const source = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled++;
      },
    });
    f.app.authorize({ expiresAt: 2000, request: async () => new Response(source) });
    await tick();
    if (outcome === 'logout') f.app.clear();
    if (outcome === 'expiry') {
      f.setTime(2000);
      f.timers[0]?.fire();
    }
    if (outcome === 'replacement')
      f.app.authorize({ expiresAt: 4000, request: async () => empty() });
    if (outcome === 'dispose') f.app.dispose();
    if (outcome === 'navigation') click(f.root, 'Proxy tokens');
    await tick();
    assert.equal(cancelled, 1);
    f.app.dispose();
    assert.equal(cancelled, 1);
  });
}
for (const status of [200, 401, 403]) {
  test(`late ${status} headers release unread body without changing replacement identity`, async () => {
    const f = fixture();
    let finish: (response: Response) => void = () => assert.fail('missing request');
    let cancelled = 0;
    f.app.authorize({
      expiresAt: 2000,
      request: async () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    });
    f.app.authorize({ expiresAt: 4000, request: async () => empty() });
    const source = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled++;
      },
    });
    finish(new Response(source, { status }));
    await tick();
    assert.equal(cancelled, 1);
    assert.match(text(f.root), /No history matches/);
    f.app.dispose();
  });
}
for (const status of [401, 403]) {
  test(`fresh denial ${status} releases unread source body`, async () => {
    const f = fixture();
    let cancelled = 0;
    const source = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled++;
      },
    });
    f.app.authorize({ expiresAt: 2000, request: async () => new Response(source, { status }) });
    await tick();
    assert.equal(cancelled, 1);
    assert.match(text(f.root), status === 401 ? /Sign-in required/ : /Access denied/);
    f.app.dispose();
  });
}
for (const outcome of ['logout', 'expiry', 'dispose', 'navigation'] as const) {
  test(`headers after ${outcome} release an abort-ignoring port body`, async () => {
    const f = fixture();
    let finish: (response: Response) => void = () => assert.fail('missing request');
    let cancelled = 0;
    f.app.authorize({
      expiresAt: 2000,
      request: async () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    });
    if (outcome === 'logout') f.app.clear();
    if (outcome === 'expiry') {
      f.setTime(2000);
      f.timers[0]?.fire();
    }
    if (outcome === 'dispose') f.app.dispose();
    if (outcome === 'navigation') click(f.root, 'Proxy tokens');
    finish(
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled++;
          },
        }),
      ),
    );
    await tick();
    assert.equal(cancelled, 1);
    assert.doesNotMatch(text(f.root), /No history matches/);
    f.app.dispose();
  });
}
for (const mode of ['reject', 'hang', 'locked', 'null'] as const) {
  test(`late body cleanup tolerates ${mode} without changing fresh authority`, async () => {
    const f = fixture();
    let finish: (response: Response) => void = () => assert.fail('missing request');
    let cancelled = 0;
    f.app.authorize({
      expiresAt: 2000,
      request: async () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    });
    f.app.authorize({ expiresAt: 4000, request: async () => empty() });
    const source = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled++;
        if (mode === 'reject') return Promise.reject(new Error('private producer diagnostic'));
        return new Promise<void>(() => {});
      },
    });
    const response = new Response(mode === 'null' ? null : source);
    const lock = mode === 'locked' ? source.getReader() : undefined;
    finish(response);
    await tick();
    assert.equal(cancelled, mode === 'locked' || mode === 'null' ? 0 : 1);
    assert.match(text(f.root), /No history matches/);
    assert.doesNotMatch(text(f.root), /private producer diagnostic/);
    lock?.releaseLock();
    f.app.dispose();
  });
}
for (const status of [200, 401, 403]) {
  test(`native HTTP late ${status} body closes upstream connection on logout`, async (t) => {
    const f = fixture();
    let release: () => void = () => assert.fail('request not received');
    let received: () => void = () => {};
    const arrived = new Promise<void>((resolve) => {
      received = resolve;
    });
    let closed: () => void = () => {};
    const disconnected = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const server = createServer((_request, response) => {
      response.on('close', closed);
      release = () => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.flushHeaders();
      };
      received();
    });
    t.after(() => {
      f.app.dispose();
      server.closeAllConnections();
      server.close();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    f.app.authorize({
      expiresAt: 2000,
      request: async () => fetch(`http://127.0.0.1:${address.port}/management/v1/usage`),
    });
    await arrived;
    f.app.clear();
    release();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        disconnected,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Upstream response remained open')), 2000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    assert.match(text(f.root), /Sign-in required/);
    assert.doesNotMatch(text(f.root), /Access denied|No history matches/);
  });
}
