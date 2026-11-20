import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountSessionManagementOperations } from '../src/management/operations-session.ts';
import { Element, nodes, text, tick } from './account-token-dom-fixture.ts';

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
  leave(persisted = true) {
    const event = new Event('pagehide');
    Object.assign(event, { persisted });
    this.dispatchEvent(event);
  }
}
function button(root: Element, label: string) {
  const found = nodes(root).find((node) => node.tag === 'button' && node.textContent === label);
  assert.ok(found, label);
  return found;
}
function setup(page: Page | null = new Page()) {
  const root = new Element();
  Object.assign(root.ownerDocument, { defaultView: page });
  const timers: { cancelled: boolean; fire(): void }[] = [];
  let downloadsDisposed = 0;
  const app = mountSessionManagementOperations(
    root,
    () => ({
      save: () => 'started' as const,
      dispose: () => {
        downloadsDisposed++;
      },
    }),
    {
      now: () => 1000,
      schedule: (_delay, fire) => {
        const timer = { cancelled: false, fire };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    },
  );
  return { root, app, page, timers, downloadsDisposed: () => downloadsDisposed };
}
const empty = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });

for (const persisted of [false, true]) {
  test(`pagehide persisted=${persisted} terminally clears history, authority and timer`, async () => {
    const f = setup();
    let calls = 0;
    const grant = {
      expiresAt: 2000,
      request: async () => {
        calls++;
        return empty();
      },
    };
    f.app.authorize(grant);
    await tick();
    assert.match(text(f.root), /No history matches/u);
    const account = button(f.root, 'Account');
    f.page?.leave(persisted);
    assert.equal(f.root.children.length, 0);
    assert.equal(f.downloadsDisposed(), 1);
    assert.ok(f.timers.every((timer) => timer.cancelled));
    assert.equal(f.page?.observers, 0);
    account.listeners.click?.();
    f.page?.dispatchEvent(new Event('pageshow'));
    f.app.authorize(grant);
    f.app.clear();
    for (const timer of f.timers) timer.fire();
    await tick();
    assert.equal(calls, 1);
    assert.equal(f.root.children.length, 0);
    f.app.dispose();
  });
}

test('exit aborts account read, cancels an ignored-abort late body and cannot republish', async () => {
  const f = setup();
  let signal: AbortSignal | null | undefined;
  let finish!: (response: Response) => void;
  let cancelled = 0;
  let calls = 0;
  f.app.authorize({
    expiresAt: 2000,
    request: async (path, init) => {
      calls++;
      if (new URL(path, 'https://synthetic.invalid').pathname === '/management/v1/usage')
        return empty();
      signal = init.signal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
  });
  await tick();
  button(f.root, 'Account').listeners.click?.();
  assert.match(text(f.root), /Loading account/u);
  assert.equal(signal?.aborted, false);
  f.page?.leave();
  assert.equal(signal?.aborted, true);
  finish(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled++;
        },
      }),
    ),
  );
  await tick();
  assert.equal(cancelled, 1);
  assert.equal(calls, 2);
  assert.equal(f.root.children.length, 0);
  f.app.dispose();
});

test('ready account refresh and navigation cannot reuse the grant after exit', async () => {
  const f = setup();
  let calls = 0;
  f.app.authorize({
    expiresAt: 2000,
    request: async (path) => {
      calls++;
      return new URL(path, 'https://synthetic.invalid').pathname === '/management/v1/usage'
        ? empty()
        : Response.json({ id: 'synthetic-human', kind: 'human' });
    },
  });
  await tick();
  button(f.root, 'Account').listeners.click?.();
  await tick();
  assert.match(text(f.root), /synthetic-human/u);
  const refresh = button(f.root, 'Refresh account');
  f.page?.leave();
  assert.equal(f.root.children.length, 0);
  refresh.listeners.click?.();
  await tick();
  assert.equal(calls, 2);
  f.app.dispose();
});

test('replacement grants retain one observer and exit aborts only their own lifetime', async () => {
  const page = new Page();
  const a = setup(page);
  const b = setup(page);
  const signals: AbortSignal[] = [];
  const grant = {
    expiresAt: 2000,
    request: async (_path: string, init: RequestInit) => {
      if (init.signal) signals.push(init.signal);
      return empty();
    },
  };
  a.app.authorize(grant);
  b.app.authorize(grant);
  await tick();
  a.app.clear();
  a.app.authorize(grant);
  await tick();
  assert.equal(page.observers, 2);
  assert.equal(signals[0]?.aborted, true);
  assert.equal(signals[1]?.aborted, false);
  a.app.dispose();
  assert.equal(page.observers, 1);
  assert.equal(signals[2]?.aborted, true);
  assert.equal(signals[1]?.aborted, false);
  page.leave();
  assert.equal(page.observers, 0);
  assert.equal(signals[1]?.aborted, true);
  assert.equal(b.root.children.length, 0);
  b.app.dispose();
});

test('locked adapters also stop on exit; non-browser roots retain explicit disposal', () => {
  const f = setup();
  assert.equal(f.page?.observers, 1);
  f.page?.leave();
  assert.equal(f.root.children.length, 0);
  f.app.authorize({ expiresAt: 2000, request: async () => empty() });
  assert.equal(f.root.children.length, 0);
  const server = setup(null);
  assert.match(text(server.root), /Sign-in required/u);
  server.app.dispose();
  assert.equal(server.root.children.length, 0);
});

test('pending issuance loses authority at page exit without replay or invented rollback', async () => {
  const f = setup();
  let signal: AbortSignal | null | undefined;
  let finish!: (response: Response) => void;
  let mutations = 0;
  f.app.authorize({
    expiresAt: 2000,
    request: async (path, init) => {
      if (new URL(path, 'https://synthetic.invalid').pathname === '/management/v1/usage')
        return empty();
      mutations++;
      signal = init.signal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
  });
  await tick();
  button(f.root, 'Proxy tokens').listeners.click?.();
  const inputs = nodes(f.root).filter((node) => node.tag === 'input');
  assert.ok(inputs[0] && inputs[1]);
  inputs[0].value = 'synthetic-human';
  inputs[1].value = '2000000000000';
  button(f.root, 'Review issuance').listeners.click?.();
  const confirm = button(f.root, 'Confirm issuance');
  confirm.listeners.click?.();
  assert.equal(mutations, 1);
  assert.equal(signal?.aborted, false);
  f.page?.leave();
  assert.equal(signal?.aborted, true);
  assert.equal(f.root.children.length, 0);
  finish(
    Response.json({ credentialId: 'synthetic-id', token: 'synthetic-secret' }, { status: 201 }),
  );
  await tick();
  confirm.listeners.click?.();
  assert.equal(mutations, 1);
  assert.equal(f.root.children.length, 0);
  assert.equal(f.page?.observers, 0);
  f.app.dispose();
});
