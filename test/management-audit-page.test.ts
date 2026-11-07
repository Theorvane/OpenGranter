import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import type { AuditClientResult, AuditFilters } from '../src/management/audit-client.ts';
import { mountManagementAudit } from '../src/management/audit-page.ts';
import type { UsageElement } from '../src/management/usage-app.ts';

class Element implements UsageElement {
  textContent: string | null = null;
  value = '';
  children: Element[] = [];
  attrs: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  ownerDocument = { createElement: () => new Element() };
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  append(...n: Element[]) {
    this.children.push(...n);
  }
  replaceChildren(...n: Element[]) {
    this.children = n;
  }
  addEventListener(k: string, fn: () => void) {
    this.listeners[k] = fn;
  }
  focus() {}
  all(): Element[] {
    return [this, ...this.children.flatMap((n) => n.all())];
  }
  text() {
    return this.all()
      .map((n) => n.textContent ?? '')
      .join(' ');
  }
  button(label: string) {
    const n = this.all().find((n) => n.textContent === label);
    assert.ok(n, label);
    return n;
  }
  input(label: string) {
    const n = this.all().find((n) => n.attrs['aria-label'] === label);
    assert.ok(n, label);
    return n;
  }
}
const ready = (nextCursor: string | null = null): AuditClientResult => ({
  state: 'ready',
  data: {
    events: [
      {
        eventId: '9',
        occurredAt: 1,
        kind: 'request-denied',
        requestId: '<img src=x>',
        principalId: 'human',
        credentialId: 'credential',
        policyVersions: [],
        details: { modelAlias: 'm', secret: 'never-render' },
      },
    ],
    nextCursor,
  },
});
const settle = async () => {
  await new Promise((r) => setImmediate(r));
};
test('disconnected, exact filters, safe rows, opaque paging and fresh first page', async () => {
  const root = new Element();
  const app = mountManagementAudit(root);
  const seen: AuditFilters[] = [];
  assert.match(root.text(), /Authentication required/);
  app.connect({
    list: async (f) => {
      seen.push(f ?? {});
      return ready(seen.length === 1 ? '8' : null);
    },
    invalidate() {},
  });
  root.input('Principal ID').value = ' human ';
  root.input('Model').value = 'm';
  root.input('From UTC').value = '2026-11-01T00:00';
  root.button('Apply filters').listeners.click?.();
  await settle();
  assert.equal(seen[0]?.principalId, ' human ');
  assert.equal(seen[0]?.fromMs, 1793491200000);
  assert.match(root.text(), /<img src=x>/);
  assert.doesNotMatch(root.text(), /never-render|credential/);
  const stale = root.button('Next page');
  stale.listeners.click?.();
  await settle();
  assert.equal(seen[1]?.cursor, '8');
  assert.equal(seen[1]?.principalId, ' human ');
  stale.listeners.click?.();
  await settle();
  assert.equal(seen.length, 2);
  root.button('First page').listeners.click?.();
  await settle();
  assert.equal(seen[2]?.cursor, undefined);
  app.dispose();
});
test('invalid UTC, loading, clear and stale completion cannot restore records', async () => {
  const root = new Element();
  const app = mountManagementAudit(root);
  let resolve: ((r: AuditClientResult) => void) | undefined;
  let calls = 0;
  let invalidations = 0;
  app.connect({
    list: () => {
      calls++;
      return new Promise((r) => {
        resolve = r;
      });
    },
    invalidate() {
      invalidations++;
    },
  });
  root.input('From UTC').value = '2026-02-30T00:00';
  root.button('Apply filters').listeners.click?.();
  await settle();
  assert.equal(calls, 0);
  assert.match(root.text(), /Invalid filters/);
  root.input('From UTC').value = '';
  root.button('Apply filters').listeners.click?.();
  assert.match(root.text(), /Loading/);
  app.clear();
  resolve?.(ready());
  await settle();
  assert.match(root.text(), /Authentication required/);
  assert.doesNotMatch(root.text(), /human/);
  assert.ok(invalidations > 0);
  app.dispose();
  app.connect({ list: async () => ready(), invalidate() {} });
  assert.equal(root.text(), '');
});
for (const state of [
  'denied',
  'unavailable',
  'unauthenticated',
  'cancelled',
  'invalid_query',
] as const)
  test('private ' + state, async () => {
    const root = new Element();
    const app = mountManagementAudit(root);
    app.connect({ list: async () => ({ state }), invalidate() {} });
    root.button('Apply filters').listeners.click?.();
    await settle();
    assert.doesNotMatch(root.text(), /human|<img/);
    assert.doesNotMatch(root.text(), /Loading/);
    app.dispose();
  });
test('empty, rejected transport and superseded response', async () => {
  const root = new Element();
  const app = mountManagementAudit(root);
  let first: ((r: AuditClientResult) => void) | undefined;
  let n = 0;
  app.connect({
    list: async () => {
      if (++n === 1)
        return new Promise((r) => {
          first = r;
        });
      if (n === 2) return { state: 'ready', data: { events: [], nextCursor: null } };
      throw Error('private-token');
    },
    invalidate() {},
  });
  root.button('Apply filters').listeners.click?.();
  root.button('Apply filters').listeners.click?.();
  await settle();
  assert.match(root.text(), /No audit events/);
  first?.(ready());
  await settle();
  assert.doesNotMatch(root.text(), /human/);
  root.button('Apply filters').listeners.click?.();
  await settle();
  assert.match(root.text(), /Audit unavailable/);
  assert.doesNotMatch(root.text(), /private-token/);
  app.dispose();
});

test('restricted browser artifact renders and clears audit page', async () => {
  const source = await buildManagementBrowser({
    root: process.cwd(),
    entry: 'src/management/audit-page.ts',
  });
  const module = await import(
    'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
  );
  const root = new Element();
  const app = module.mountManagementAudit(root) as ReturnType<typeof mountManagementAudit>;
  app.connect({ list: async () => ready(), invalidate() {} });
  root.button('Apply filters').listeners.click?.();
  await settle();
  assert.match(root.text(), /Audit events/);
  app.clear();
  assert.match(root.text(), /Authentication required/);
  app.dispose();
});
