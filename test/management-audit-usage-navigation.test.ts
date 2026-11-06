import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { mountSsoUsageWorkspace } from '../src/management/sso-usage-workspace.ts';
import { mountManagementUsage, type UsageElement } from '../src/management/usage-app.ts';

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

const event = {
  eventId: '8',
  occurredAt: 1000,
  kind: 'route-unavailable',
  requestId: 'req/one+two@v1',
  principalId: 'human',
  credentialId: 'ref',
  policyVersions: [],
  details: { action: 'model:Invoke', modelAlias: 'not-a-filter', outcome: 'allowed' },
};
function required<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 15));
for (const artifact of [false, true]) {
  const label = artifact ? 'artifact' : 'source';
  async function mount() {
    const factory = artifact
      ? ((
          await import(
            'data:text/javascript;base64,' +
              Buffer.from(
                await buildManagementBrowser({
                  root: process.cwd(),
                  entry: 'src/management/sso-usage-workspace.ts',
                }),
              ).toString('base64')
          )
        ).mountSsoUsageWorkspace as typeof mountSsoUsageWorkspace)
      : mountSsoUsageWorkspace;
    const root = new Element();
    const lifecycle = new EventTarget();
    let time = 100;
    const app = factory(root, lifecycle, { now: () => time, schedule: () => () => {} });
    const paths: string[] = [];
    let deny = false;
    const grant = {
      expiresAt: 200,
      request: async (path: string) => {
        paths.push(path);
        if (path.includes('/usage') && deny) return new Response(null, { status: 403 });
        if (path.startsWith('/v1/audit')) {
          const q = new URL(path, 'http://local').searchParams;
          return Response.json({
            object: 'list',
            data: [{ ...event, eventId: q.has('cursor') ? '7' : '8' }],
            has_more: !q.has('cursor'),
            next_cursor: q.has('cursor') ? null : '8',
          });
        }
        if (
          path.includes('/usage') &&
          new URL(path, 'http://local').searchParams.get('format') === 'csv'
        )
          return new Response('csv', {
            headers: { 'content-type': 'text/csv', 'x-usage-has-more': 'false' },
          });
        return Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
      },
    };
    await app.authorize(grant);
    root.button('Audit history').click();
    await settle();
    return {
      root,
      app,
      paths,
      lifecycle,
      grant,
      expire: () => {
        time = 200;
      },
      deny: () => {
        deny = true;
      },
    };
  }
  test(
    'audit-to-usage sends exact principal/request and submitted bounds; resets draft/cursor and ordinary navigation: ' +
      label,
    async () => {
      const f = await mount();
      try {
        const inputs = f.root.all().filter((n) => n.tag === 'label');
        const input = (name: string) => {
          const n = inputs.find((n) => n.textContent === name);
          assert.ok(n, name);
          return required(n.children[0]);
        };
        input('Principal ID').value = 'human';
        input('Model').value = '';
        input('From (UTC)').value = '1970-01-01T00:00:00.000';
        input('To (UTC, exclusive)').value = '1970-01-01T00:00:02.000';
        input('Page size (1–100)').value = '2';
        f.root.button('Apply filters').click();
        await settle();
        f.root.button('Next page').click();
        await settle();
        f.root
          .all()
          .filter((n) => n.tag === 'input')
          .forEach((n) => {
            n.value = 'DRAFT';
          });
        f.root.button('View usage for request ' + event.requestId).click();
        await settle();
        const q = new URL(required(f.paths.at(-1)), 'http://local');
        assert.equal(q.pathname, '/management/v1/usage');
        assert.deepEqual(Object.fromEntries(q.searchParams), {
          principal_id: 'human',
          request_id: event.requestId,
          from_ms: '0',
          to_ms: '2000',
          limit: '2',
          format: 'json',
        });
        assert.doesNotMatch(f.root.text(), /Audit history filters|DRAFT|not-a-filter/);
        f.root.button('Export current page CSV').click();
        await settle();
        const exported = new URL(required(f.paths.at(-1)), 'http://local');
        q.searchParams.set('format', 'csv');
        assert.equal(exported.href, q.href);
        f.root.button('Models').click();
        await settle();
        f.root.button('Usage history').click();
        await settle();
        assert.equal(f.paths.at(-1), '/management/v1/usage?format=json');
      } finally {
        f.app.dispose();
      }
    },
  );
  test('submitted model is retained and renewal discards trace scope: ' + label, async () => {
    const f = await mount();
    try {
      const modelLabel = f.root.all().find((n) => n.tag === 'label' && n.textContent === 'Model');
      required(required(modelLabel).children[0]).value = 'not-a-filter';
      f.root.button('Apply filters').click();
      await settle();
      f.root.button('View usage for request ' + event.requestId).click();
      await settle();
      assert.equal(
        new URL(required(f.paths.at(-1)), 'http://local').searchParams.get('model'),
        'not-a-filter',
      );
      await f.app.authorize(f.grant);
      f.root.button('Usage history').click();
      await settle();
      assert.equal(f.paths.at(-1), '/management/v1/usage?format=json');
    } finally {
      f.app.dispose();
    }
  });
  test(
    'audit visibility cannot grant usage; explicit denial clears without broad retry: ' + label,
    async () => {
      const f = await mount();
      try {
        f.deny();
        f.root.button('View usage for request ' + event.requestId).click();
        await settle();
        assert.match(f.root.text(), /Access denied/);
        assert.equal(f.paths.filter((p) => p.includes('/usage')).length, 1);
        assert.equal(
          new URL(required(f.paths.at(-1)), 'http://local').searchParams.get('principal_id'),
          'human',
        );
        const count = f.paths.length;
        f.root.button('Usage history').click();
        await settle();
        assert.equal(f.paths.length, count);
      } finally {
        f.app.dispose();
      }
    },
  );
  test(
    'detached trace actions cannot consume replacement, hidden or expired authority: ' + label,
    async () => {
      for (const change of ['navigate', 'renew', 'hide', 'expire', 'clear', 'dispose']) {
        const f = await mount();
        try {
          const old = f.root.button('View usage for request ' + event.requestId);
          if (change === 'navigate') {
            f.root.button('Models').click();
            await settle();
          }
          if (change === 'renew') await f.app.authorize(f.grant);
          if (change === 'hide') f.lifecycle.dispatchEvent(new Event('pagehide'));
          if (change === 'expire') f.expire();
          if (change === 'clear') f.app.clear();
          if (change === 'dispose') f.app.dispose();
          const count = f.paths.length;
          old.click();
          await settle();
          assert.equal(f.paths.length, count, change);
          if (change === 'expire') assert.match(f.root.text(), /Session expired/);
        } finally {
          f.app.dispose();
        }
      }
    },
  );
}

for (const artifact of [false, true]) {
  test(
    'initial usage hints are snapshotted, cursorless and fail locally on invalid scope: ' +
      (artifact ? 'artifact' : 'source'),
    async () => {
      const mount = artifact
        ? ((
            await import(
              'data:text/javascript;base64,' +
                Buffer.from(
                  await buildManagementBrowser({
                    root: process.cwd(),
                    entry: 'src/management/usage-app.ts',
                  }),
                ).toString('base64')
            )
          ).mountManagementUsage as typeof mountManagementUsage)
        : mountManagementUsage;
      const root = new Element();
      const scope = { principalId: 'human', requestId: event.requestId, cursor: 'must-not-replay' };
      const app = mount(root, { initialFilters: scope, now: () => 100, schedule: () => () => {} });
      scope.principalId = 'other';
      scope.requestId = 'mutated';
      const paths: string[] = [];
      const grant = {
        expiresAt: 200,
        request: async (path: string) => {
          paths.push(path);
          return Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
        },
      };
      try {
        await app.authorize(grant);
        assert.deepEqual(
          Object.fromEntries(new URL(required(paths[0]), 'http://local').searchParams),
          { principal_id: 'human', request_id: event.requestId, format: 'json' },
        );
      } finally {
        app.dispose();
      }
      const invalid = mount(root, {
        initialFilters: { requestId: 'not valid' },
        now: () => 100,
        schedule: () => () => {},
      });
      try {
        await invalid.authorize(grant);
        assert.equal(paths.length, 1);
        assert.match(root.text(), /Invalid usage filters/);
      } finally {
        invalid.dispose();
      }
    },
  );
}
