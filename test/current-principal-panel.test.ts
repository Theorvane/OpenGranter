import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountCurrentPrincipalPanel } from '../src/management/current-principal-panel.ts';

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

test('Account loads exact identity as text, refresh clears synchronously, disposal erases', async () => {
  const root = new Element();
  let calls = 0;
  let finish!: (response: Response) => void;
  const panel = mountCurrentPrincipalPanel(root, async (path, init) => {
    assert.equal(path, '/management/v1/principal');
    assert.equal(init.cache, 'no-store');
    calls++;
    return calls === 1
      ? reply()
      : new Promise((resolve) => {
          finish = resolve;
        });
  });
  assert.match(text(root), /Loading account/);
  assert.equal(root.children[0]?.attributes['aria-busy'], 'true');
  await tick();
  assert.match(text(root), /<script>private<\/script>/);
  assert.equal(root.children[0]?.attributes['aria-busy'], 'false');
  assert.equal(nodes(root).filter((n) => n.tag === 'script').length, 0);
  const refresh = button(root, 'Refresh account');
  refresh.listeners.click?.();
  assert.doesNotMatch(text(root), /private/);
  panel.dispose();
  finish(reply('late identity'));
  await tick();
  assert.equal(text(root), '');
  refresh.listeners.click?.();
  assert.equal(calls, 2);
});

test('Account sanitized unavailable is retryable; fresh success replaces it', async () => {
  const root = new Element();
  let calls = 0;
  const panel = mountCurrentPrincipalPanel(root, async () =>
    ++calls === 1 ? Response.json({ secret: 'raw diagnostics' }) : reply('human-2'),
  );
  await tick();
  assert.match(text(root), /Account unavailable/);
  assert.doesNotMatch(text(root), /secret|diagnostics/);
  button(root, 'Retry account').listeners.click?.();
  await tick();
  assert.match(text(root), /human-2/);
  panel.dispose();
});

for (const status of [401, 403])
  test(`Account ${status} clears identity and is terminal`, async () => {
    const root = new Element();
    let calls = 0;
    const panel = mountCurrentPrincipalPanel(root, async () =>
      ++calls === 1 ? reply('old identity') : new Response('private', { status }),
    );
    await tick();
    const refresh = button(root, 'Refresh account');
    refresh.listeners.click?.();
    await tick();
    assert.doesNotMatch(text(root), /old identity|private/);
    assert.match(text(root), status === 401 ? /Sign in required/ : /Access denied/);
    refresh.listeners.click?.();
    await tick();
    assert.equal(calls, 2);
    assert.equal(nodes(root).filter((n) => n.tag === 'button').length, 0);
    panel.dispose();
  });

test('detached retry cannot supersede an active request', async () => {
  const root = new Element();
  let calls = 0;
  let finish!: (response: Response) => void;
  const panel = mountCurrentPrincipalPanel(root, async () =>
    ++calls === 1
      ? new Response(null, { status: 503 })
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  await tick();
  const retry = button(root, 'Retry account');
  retry.listeners.click?.();
  retry.listeners.click?.();
  assert.equal(calls, 2);
  finish(reply('latest'));
  await tick();
  assert.match(text(root), /latest/);
  panel.dispose();
});

test('disposal aborts an ignored transport and never restores loading identity', async () => {
  const root = new Element();
  let signal: AbortSignal | undefined;
  let calls = 0;
  const panel = mountCurrentPrincipalPanel(root, async (_path, init) => {
    calls++;
    signal = init.signal ?? undefined;
    return new Promise<Response>(() => {});
  });
  assert.match(text(root), /Loading account/);
  panel.dispose();
  assert.equal(signal?.aborted, true);
  await tick();
  assert.equal(text(root), '');
  panel.dispose();
  assert.equal(calls, 1);
});
