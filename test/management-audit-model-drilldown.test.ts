import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { mountManagementAudit } from '../src/management/audit-app.ts';
import type { UsageElement } from '../src/management/usage-app.ts';

class Element implements UsageElement {
  textContent: string | null = null;
  value = '';
  children: Element[] = [];
  attrs: Record<string, string> = {};
  listeners: Record<string, (event?: { preventDefault(): void }) => void> = {};
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
  readonly tag: string;
  constructor(tag = 'div') {
    this.tag = tag;
  }
  setAttribute(key: string, value: string) {
    this.attrs[key] = value;
  }
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
  }
  addEventListener(type: string, listener: (event?: { preventDefault(): void }) => void) {
    this.listeners[type] = listener;
  }
  click() {
    this.listeners.click?.();
  }
  focus() {}
  all(): Element[] {
    return [this, ...this.children.flatMap((node) => node.all())];
  }
  text(): string {
    return this.all()
      .map((node) => node.textContent ?? '')
      .join(' ');
  }
  button(text: string) {
    const found = this.all().find((node) => node.tag === 'button' && node.textContent === text);
    assert.ok(found, text);
    return found;
  }
}

const row = {
  eventId: '8',
  occurredAt: 1,
  kind: 'route-unavailable',
  requestId: 'request',
  principalId: 'human',
  credentialId: 'reference',
  policyVersions: [],
  details: { action: 'model:Invoke', modelAlias: 'model/team:alpha+beta@v1', outcome: 'allowed' },
};
const reply = (more = false, id = '8') =>
  Response.json({
    object: 'list',
    data: [{ ...row, eventId: id }],
    has_more: more,
    next_cursor: more ? id : null,
  });
async function settled(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(check(), 'UI settled');
}
for (const artifact of [false, true]) {
  test(
    'model API drilldown and authority guards: ' + (artifact ? 'artifact' : 'source'),
    async () => {
      const mount = artifact
        ? ((
            await import(
              'data:text/javascript;base64,' +
                Buffer.from(
                  await buildManagementBrowser({
                    root: process.cwd(),
                    entry: 'src/management/audit-app.ts',
                  }),
                ).toString('base64')
            )
          ).mountManagementAudit as typeof mountManagementAudit)
        : mountManagementAudit;
      const root = new Element();
      let time = 1;
      const app = mount(root, { now: () => time, schedule: () => () => {} });
      const seen: URLSearchParams[] = [];
      let pending: ((response: Response) => void) | undefined;
      let mode = 'ready';
      const request = async (path: string) => {
        const query = new URL(path, 'http://local').searchParams;
        seen.push(query);
        if (mode === 'pending')
          return new Promise<Response>((resolve) => {
            pending = resolve;
          });
        if (mode === 'denied') return new Response('private failure', { status: 403 });
        if (query.get('format') === 'csv')
          return new Response('safe,csv', {
            headers: {
              'content-type': 'text/csv',
              'x-has-more': 'true',
              'x-next-cursor': '7',
            },
          });
        return reply(!query.has('model'), query.has('cursor') ? '7' : '8');
      };
      const filter = () => root.button('Filter audit for model ' + row.details.modelAlias);
      try {
        await app.authorize({ request, expiresAt: 100 });
        const inputs = root.all().filter((n) => n.tag === 'input');
        assert.equal(inputs.length, 5);
        assert.ok(inputs[0]);
        assert.ok(inputs[2]);
        assert.ok(inputs[3]);
        assert.ok(inputs[4]);
        inputs[0].value = 'human';
        inputs[2].value = '1970-01-01T00:00:00.001';
        inputs[3].value = '1970-01-01T00:00:00.010';
        inputs[4].value = '7';
        root.button('Apply filters').click();
        await settled(() => root.text().includes('Audit events — current page'));
        root.button('Next page').click();
        await settled(() => root.text().includes('Previous page'));
        root.button('Export current page CSV').click();
        await settled(() => root.all().some((n) => n.tag === 'a'));
        const download = root.all().find((n) => n.tag === 'a');
        assert.ok(download);
        const csvUrl = download.attrs.href;
        assert.ok(csvUrl);
        const staleCsv = root.button('Export next CSV page');
        // Unsubmitted principal/model edits must not silently change drilldown scope.
        const drafts = root.all().filter((n) => n.tag === 'input');
        assert.ok(drafts[0]);
        assert.ok(drafts[1]);
        drafts[0].value = 'unsent-principal';
        drafts[1].value = 'unsent-model';
        const detached = filter();
        mode = 'pending';
        detached.click();
        assert.match(root.text(), /Loading audit/);
        assert.doesNotMatch(root.text(), /Audit events — current page|Request correlation/);
        assert.equal(
          root.all().some((n) => n.tag === 'a'),
          false,
        );
        await assert.rejects(fetch(csvUrl));
        const count = seen.length;
        staleCsv.click();
        assert.equal(seen.length, count);
        detached.click();
        assert.equal(seen.length, count);
        const query = seen.at(-1);
        assert.ok(query);
        assert.equal(query.get('model'), row.details.modelAlias);
        assert.equal(query.get('principal_id'), 'human');
        assert.equal(query.get('from_ms'), '1');
        assert.equal(query.get('to_ms'), '10');
        assert.equal(query.get('limit'), '7');
        assert.equal(query.get('format'), 'json');
        assert.equal(query.has('cursor'), false);
        assert.ok(pending);
        pending(reply());
        await settled(() => root.text().includes('Audit events — current page'));
        assert.doesNotMatch(root.text(), /Previous page/);
        assert.equal(root.all().filter((n) => n.tag === 'input')[1]?.value, row.details.modelAlias);
        assert.equal(
          root.all().some((n) => n.tag === 'img'),
          false,
        );
        const stale = filter();
        app.clear();
        stale.click();
        assert.equal(seen.length, count);
        mode = 'ready';
        await app.authorize({ request, expiresAt: 100 });
        const oldAuthority = filter();
        await app.authorize({ request, expiresAt: 100 });
        const afterRenewal = seen.length;
        oldAuthority.click();
        assert.equal(seen.length, afterRenewal);
        const expires = filter();
        time = 100;
        expires.click();
        assert.match(root.text(), /Session expired/);
        assert.equal(seen.length, afterRenewal);
        time = 1;
        await app.authorize({ request, expiresAt: 100 });
        mode = 'denied';
        filter().click();
        await settled(() => root.text().includes('Access denied'));
        assert.doesNotMatch(root.text(), /private failure|Request correlation/);
        mode = 'ready';
        await app.authorize({ request, expiresAt: 100 });
        mode = 'pending';
        filter().click();
        app.clear();
        assert.ok(pending);
        pending(reply());
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.doesNotMatch(root.text(), /Audit events — current page|Request correlation/);
        mode = 'ready';
        await app.authorize({ request, expiresAt: 100 });
        const disposed = filter();
        const beforeDispose = seen.length;
        app.dispose();
        disposed.click();
        assert.equal(seen.length, beforeDispose);
        assert.equal(root.text(), '');
      } finally {
        app.dispose();
      }
    },
  );
}

test('non-model events have no model drilldown; rejected metadata cannot supply a control', async () => {
  const root = new Element();
  const app = mountManagementAudit(root);
  try {
    await app.connect(async () =>
      Response.json({
        object: 'list',
        data: [
          { ...row, kind: 'models-listed', details: { count: 1, modelAlias: 'not-allowlisted' } },
        ],
        has_more: false,
        next_cursor: null,
      }),
    );
    assert.match(root.text(), /Audit events — current page/);
    assert.equal(
      root
        .all()
        .some((n) => n.tag === 'button' && n.textContent?.startsWith('Filter audit for model')),
      false,
    );
    await app.connect(async () =>
      Response.json({
        object: 'list',
        data: [{ ...row, details: { modelAlias: '<img src=x>&model=other' } }],
        has_more: false,
        next_cursor: null,
      }),
    );
    assert.match(root.text(), /Audit unavailable/);
    assert.doesNotMatch(root.text(), /Filter audit for model|<img/);
  } finally {
    app.dispose();
  }
});
