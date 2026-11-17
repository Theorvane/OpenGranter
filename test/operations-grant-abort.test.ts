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
test('reentrant logout aborts transport before returning to its request port', async () => {
  const f = fixture();
  let abortedInside = false;
  f.app.authorize({
    expiresAt: 2000,
    request: async (_path, init) => {
      f.app.clear();
      abortedInside = init.signal?.aborted === true;
      return empty();
    },
  });
  await tick();
  assert.equal(abortedInside, true);
  assert.match(text(f.root), /Sign-in required/);
  f.app.dispose();
});
for (const terminal of ['logout', 'replace', 'expiry', 'dispose', '401', '403'] as const) {
  test(`grant transport lifetime ends on ${terminal}`, async () => {
    const f = fixture();
    let signal: AbortSignal | undefined;
    f.app.authorize({
      expiresAt: 2000,
      request: async (_path, init) => {
        signal = init.signal ?? undefined;
        return terminal === '401' || terminal === '403'
          ? new Response(null, { status: Number(terminal) })
          : empty();
      },
    });
    await tick();
    assert.ok(signal);
    if (terminal === 'logout') f.app.clear();
    if (terminal === 'replace') f.app.authorize({ expiresAt: 3000, request: async () => empty() });
    if (terminal === 'expiry') {
      f.setTime(2000);
      f.timers[0]?.fire();
    }
    if (terminal === 'dispose') f.app.dispose();
    assert.equal(signal.aborted, true);
    f.app.dispose();
  });
}

test('abort callback may replace authority without cancelling or erasing the replacement', async () => {
  const f = fixture();
  let replacement: AbortSignal | undefined;
  let first: AbortSignal | undefined;
  f.app.authorize({
    expiresAt: 2000,
    request: async (_path, init) => {
      first = init.signal ?? undefined;
      first?.addEventListener(
        'abort',
        () => {
          f.app.authorize({
            expiresAt: 3000,
            request: async (_nextPath, nextInit) => {
              replacement = nextInit.signal ?? undefined;
              return empty();
            },
          });
        },
        { once: true },
      );
      return empty();
    },
  });
  await tick();
  f.app.clear();
  await tick();
  assert.equal(first?.aborted, true);
  assert.ok(replacement);
  assert.equal(replacement.aborted, false);
  assert.match(text(f.root), /No history matches/);
  f.app.dispose();
  assert.equal(replacement.aborted, true);
});
