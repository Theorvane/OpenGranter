import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import {
  type AuditClientResult,
  type AuditFilters,
  createManagementAuditClient,
} from '../src/management/audit-client.ts';
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
for (const artifact of [false, true]) {
  const mount = async () =>
    artifact
      ? ((
          await import(
            'data:text/javascript;base64,' +
              Buffer.from(
                await buildManagementBrowser({
                  root: process.cwd(),
                  entry: 'src/management/audit-page.ts',
                }),
              ).toString('base64')
          )
        ).mountManagementAudit as typeof mountManagementAudit)
      : mountManagementAudit;
  for (const dimension of ['principal', 'model'] as const) {
    const label =
      dimension === 'principal' ? 'Filter audit by this principal' : 'Filter audit by this model';
    test(`${artifact ? 'built' : 'source'} ${dimension}: fresh first-page submitted scope and exact HTTP encoding`, async () => {
      const root = new Element();
      const app = (await mount())(root);
      const seen: string[] = [];
      const special = ' <img src=x>&principal_id=other/💡 ';
      const model = 'provider/model+v1:tag';
      const data = ready('8');
      assert.equal(data.state, 'ready');
      if (data.state !== 'ready') throw Error('fixture');
      const firstEvent = data.data.events[0];
      assert.ok(firstEvent);
      const event = {
        ...firstEvent,
        principalId: special,
        requestId: 'read-1',
        details: { modelAlias: model, reason: 'unknown-model' },
      };
      app.connect(
        createManagementAuditClient(async (path) => {
          seen.push(path);
          return Response.json({
            object: 'list',
            data: [{ ...event, eventId: seen.length === 2 ? '8' : '9' }],
            has_more: true,
            next_cursor: seen.length === 2 ? '8' : '9',
          });
        }),
      );
      root.input('Principal ID').value = special;
      root.input('Model').value = model;
      root.input('From UTC').value = '1970-01-01T00:00';
      root.input('To UTC').value = '1970-01-01T00:01';
      root.button('Apply filters').listeners.click?.();
      await settle();
      root.button('Next page').listeners.click?.();
      await settle();
      assert.ok(seen[1]);
      assert.equal(new URL(seen[1], 'https://internal').searchParams.get('cursor'), '9');
      root.input('Principal ID').value = 'unsubmitted';
      root.input('Model').value = 'unsubmitted';
      root.input('From UTC').value = 'invalid';
      const control = root.button(label);
      control.listeners.click?.();
      control.listeners.click?.();
      assert.match(root.text(), /Loading audit events/);
      assert.doesNotMatch(root.text(), /Filter audit by this/);
      await settle();
      assert.equal(seen.length, 3);
      assert.ok(seen[2]);
      const query = new URL(seen[2], 'https://internal');
      assert.equal(query.pathname, '/v1/audit');
      assert.equal(query.searchParams.get('principal_id'), special);
      assert.equal(query.searchParams.get('model'), model);
      assert.equal(query.searchParams.get('from_ms'), '0');
      assert.equal(query.searchParams.get('to_ms'), '60000');
      assert.equal(query.searchParams.get('limit'), '25');
      assert.equal(query.searchParams.has('cursor'), false);
      assert.equal(root.input('Principal ID').value, special);
      assert.equal(root.input('Model').value, model);
      assert.equal(root.input('From UTC').value, '1970-01-01T00:00:00.000');
      assert.equal(
        root.all().some((n) => n.textContent === 'Previous page'),
        false,
      );
      app.dispose();
    });
    test(`${artifact ? 'built' : 'source'} ${dimension}: row target replaces only selected submitted dimension`, async () => {
      const root = new Element();
      const app = (await mount())(root);
      const seen: AuditFilters[] = [];
      app.connect({
        list: async (q) => {
          seen.push(q ?? {});
          return ready();
        },
        invalidate() {},
      });
      root.input('Principal ID').value = 'old-principal';
      root.input('Model').value = 'old-model';
      root.button('Apply filters').listeners.click?.();
      await settle();
      root.button(label).listeners.click?.();
      await settle();
      assert.equal(seen[1]?.principalId, dimension === 'principal' ? 'human' : 'old-principal');
      assert.equal(seen[1]?.model, dimension === 'model' ? 'm' : 'old-model');
      assert.equal(seen[1]?.limit, 25);
      app.dispose();
    });
    for (const boundary of ['clear', 'replace', 'dispose', 'navigate'] as const) {
      test(`${artifact ? 'built' : 'source'} ${dimension}: detached action after ${boundary}`, async () => {
        const root = new Element();
        const app = (await mount())(root);
        let calls = 0;
        const client = {
          list: async () => {
            calls++;
            return ready('8');
          },
          invalidate() {},
        };
        app.connect(client);
        root.button('Apply filters').listeners.click?.();
        await settle();
        const stale = root.button(label);
        if (boundary === 'clear') app.clear();
        if (boundary === 'replace') app.connect(client);
        if (boundary === 'dispose') app.dispose();
        if (boundary === 'navigate') {
          root.button('Next page').listeners.click?.();
          await settle();
        }
        const count = calls;
        stale.listeners.click?.();
        await settle();
        assert.equal(calls, count);
        app.dispose();
      });
    }
    test(`${artifact ? 'built' : 'source'} ${dimension}: failed drilldown clears records, download and controls`, async () => {
      const root = new Element();
      const app = (await mount())(root);
      let calls = 0;
      app.connect({
        list: async () => (++calls <= 2 ? ready() : { state: 'denied' }),
        invalidate() {},
      });
      root.button('Apply filters').listeners.click?.();
      await settle();
      root.button('Prepare current-page CSV').listeners.click?.();
      await settle();
      assert.ok(root.all().some((n) => n.attrs.download));
      root.button(label).listeners.click?.();
      await settle();
      assert.match(root.text(), /Access denied/);
      assert.equal(
        root.all().some((n) => n.attrs.download),
        false,
      );
      assert.doesNotMatch(root.text(), /<img src=x>|Filter audit by this/);
      app.dispose();
    });
  }
  test(`${artifact ? 'built' : 'source'} missing model has no model scope action`, async () => {
    const root = new Element();
    const app = (await mount())(root);
    const response = ready();
    if (response.state !== 'ready') throw Error('fixture');
    app.connect({
      list: async () => ({
        ...response,
        data: {
          ...response.data,
          events: response.data.events.map((row) => ({ ...row, details: {} })),
        },
      }),
      invalidate() {},
    });
    root.button('Apply filters').listeners.click?.();
    await settle();
    assert.match(root.text(), /Not reported/);
    assert.equal(
      root.all().some((n) => n.textContent === 'Filter audit by this model'),
      false,
    );
    app.dispose();
  });
}
