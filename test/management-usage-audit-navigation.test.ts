import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { createPostgresAuditHistoryReader } from '../src/audit/postgres-audit-history.ts';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { mountManagementAudit } from '../src/management/audit-app.ts';
import { mountSsoUsageWorkspace } from '../src/management/sso-usage-workspace.ts';
import type { UsageElement } from '../src/management/usage-app.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

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
const usage = buildUsageRecord({
  principalId: event.principalId,
  credentialId: 'ref',
  policyVersions: [],
  requestId: event.requestId,
  attemptId: 'attempt',
  modelAlias: 'not-a-filter',
  routeKind: 'managed',
  upstreamModelId: 'model',
  selectedCandidateId: 'candidate',
  occurredAt: 1000,
  latencyMs: 10,
  outcome: 'succeeded',
  possiblyBilled: true,
  possibleDuplicate: false,
});
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
        if (path.startsWith('/v1/audit') && deny) return new Response(null, { status: 403 });
        if (path.startsWith('/v1/audit')) {
          if (new URL(path, 'http://local').searchParams.get('format') === 'csv')
            return new Response('csv', {
              headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
            });
          return Response.json({
            object: 'list',
            data: [event],
            has_more: false,
            next_cursor: null,
          });
        }
        if (path.includes('/usage')) {
          const q = new URL(path, 'http://local').searchParams;
          return Response.json({
            object: 'list',
            data: [usage],
            has_more: !q.has('cursor'),
            next_cursor: q.has('cursor')
              ? null
              : Buffer.from(JSON.stringify([1000, 'attempt'])).toString('base64url'),
          });
        }
        return Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
      },
    };
    await app.authorize(grant);
    root.button('Usage history').click();
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
    'usage-to-audit sends exact principal/request and submitted bounds; resets draft/cursor and ordinary navigation: ' +
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
        f.root.button('View audit for request ' + event.requestId).click();
        await settle();
        const q = new URL(required(f.paths.at(-1)), 'http://local');
        assert.equal(q.pathname, '/v1/audit');
        assert.deepEqual(Object.fromEntries(q.searchParams), {
          principal_id: 'human',
          request_id: event.requestId,
          from_ms: '0',
          to_ms: '2000',
          limit: '2',
          format: 'json',
        });
        assert.doesNotMatch(f.root.text(), /Usage history filters|DRAFT/);
        f.root.button('Export current page CSV').click();
        await settle();
        assert.match(f.root.text(), /Download audit.csv/);
        const exported = new URL(required(f.paths.at(-1)), 'http://local');
        q.searchParams.set('format', 'csv');
        assert.equal(exported.href, q.href);
        f.root.button('Models').click();
        await settle();
        f.root.button('Audit history').click();
        await settle();
        assert.equal(f.paths.at(-1), '/v1/audit?format=json');
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
      f.root.button('View audit for request ' + event.requestId).click();
      await settle();
      assert.equal(
        new URL(required(f.paths.at(-1)), 'http://local').searchParams.get('model'),
        'not-a-filter',
      );
      await f.app.authorize(f.grant);
      f.root.button('Audit history').click();
      await settle();
      assert.equal(f.paths.at(-1), '/v1/audit?format=json');
    } finally {
      f.app.dispose();
    }
  });
  test(
    'usage visibility cannot grant audit; explicit denial clears without broad retry: ' + label,
    async () => {
      const f = await mount();
      try {
        f.deny();
        f.root.button('View audit for request ' + event.requestId).click();
        await settle();
        assert.match(f.root.text(), /Access denied/);
        assert.equal(f.paths.filter((p) => p.startsWith('/v1/audit')).length, 1);
        assert.equal(
          new URL(required(f.paths.at(-1)), 'http://local').searchParams.get('principal_id'),
          'human',
        );
        const count = f.paths.length;
        f.root.button('Audit history').click();
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
          const old = f.root.button('View audit for request ' + event.requestId);
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
    'initial audit hints are snapshotted, cursorless and fail locally on invalid scope: ' +
      (artifact ? 'artifact' : 'source'),
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
        assert.match(root.text(), /Invalid audit filters/);
      } finally {
        invalid.dispose();
      }
    },
  );
}

// Real loopback HTTP and embedded SQL, with explicit test proxy authentication.
// Models/usage are fixtures. This is NOT browser login or SSO API integration.
for (const artifact of [false, true]) {
  test(
    'reverse navigation rechecks audit IAM and required SQL audit over HTTP: ' +
      (artifact ? 'artifact' : 'source'),
    async () => {
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
      const db = new PGlite();
      await db.exec(
        await readFile(new URL('../migrations/003_gateway_audit.sql', import.meta.url), 'utf8'),
      );
      const sql = { query: (q: string, params: readonly unknown[]) => db.query(q, [...params]) };
      const writer = createPostgresGatewayAuditStore(sql, () => 1000);
      const reader = createPostgresAuditHistoryReader(sql);
      await writer.append({ ...event, kind: 'models-listed', count: 1 });
      await writer.append({
        ...event,
        kind: 'models-listed',
        principalId: 'other',
        requestId: 'PRIVATE_OTHER',
        count: 1,
      });
      let deny = false;
      let failedAudit = false;
      let reads = 0;
      const handler = createChatHandler({
        newRequestId: () => 'audit-navigation-read',
        authenticate: async () => ({
          id: 'human',
          active: true,
          credentialId: 'ref',
          policyVersions: [],
          statements: [
            {
              effect: deny ? 'Deny' : 'Allow',
              actions: ['audit:Read'],
              resources: ['principal:human'],
            },
          ],
        }),
        resolveRoute: async () => {
          throw Error('unexpected route');
        },
        checkLimit: async () => {
          throw Error('unexpected limits');
        },
        resolveSecret: async () => {
          throw Error('unexpected secrets');
        },
        writeUsage: async () => {
          throw Error('unexpected usage');
        },
        invokeDirect: async () => {
          throw Error('unexpected inference');
        },
        writeAudit: async (value) => {
          if (failedAudit) throw Error('PRIVATE_AUDIT');
          await writer.append(value);
        },
        listAudit: async (query) => {
          reads++;
          assert.equal(query.principalId, 'human');
          assert.equal(query.requestId, event.requestId);
          return reader(query);
        },
      });
      const server = createNodeRequestServer(handler, () => new Response(null, { status: 503 }));
      const root = new Element();
      const app = factory(root, new EventTarget(), { now: () => 100, schedule: () => () => {} });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const paths: string[] = [];
      const grant = {
        expiresAt: 200,
        request: async (path: string, init: RequestInit) => {
          paths.push(path);
          if (path.startsWith('/v1/audit'))
            return fetch('http://127.0.0.1:' + address.port + path, {
              ...init,
              headers: { ...init.headers, authorization: 'Bearer test-proxy-fixture' },
            });
          return Response.json({
            object: 'list',
            data: path.includes('/usage') ? [usage] : [],
            has_more: false,
            next_cursor: null,
          });
        },
      };
      async function until(check: () => boolean) {
        for (let i = 0; i < 100 && !check(); i++) await settle();
        assert.ok(check(), 'UI settled');
      }
      async function inspect() {
        await app.authorize(grant);
        root.button('Usage history').click();
        await until(
          () =>
            !!root.all().find((n) => n.textContent === 'View audit for request ' + event.requestId),
        );
        root.button('View audit for request ' + event.requestId).click();
      }
      try {
        await inspect();
        await until(() => root.text().includes('Authorized audit metadata'));
        assert.match(root.text(), /models-listed/);
        assert.doesNotMatch(root.text(), /PRIVATE_OTHER/);
        root.button('Export current page CSV').click();
        await until(() => root.text().includes('Download audit.csv'));
        assert.equal(reads, 2);
        assert.equal(
          (
            await db.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM gateway_audit_events WHERE kind='audit-history-read'",
            )
          ).rows[0]?.count,
          2,
        );
        deny = true;
        const before = reads;
        await inspect();
        await until(() => root.text().includes('Access denied'));
        assert.equal(reads, before);
        assert.equal(paths.filter((p) => p.startsWith('/v1/audit')).length, 3);
        deny = false;
        failedAudit = true;
        await inspect();
        await until(() => root.text().includes('unavailable'));
        assert.doesNotMatch(root.text(), /PRIVATE_AUDIT|models-listed|Download audit.csv/);
      } finally {
        app.dispose();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        await db.close();
      }
    },
  );
}
