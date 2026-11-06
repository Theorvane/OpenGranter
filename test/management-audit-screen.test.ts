import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { createPostgresAuditHistoryReader } from '../src/audit/postgres-audit-history.ts';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { mountManagementAudit } from '../src/management/audit-app.ts';
import { createManagementAuditClient } from '../src/management/audit-client.ts';
import type { CatalogRequest } from '../src/management/catalog-client.ts';
import { mountSsoUsageWorkspace } from '../src/management/sso-usage-workspace.ts';
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

const event = {
  eventId: '8',
  occurredAt: 1000,
  kind: 'models-listed',
  requestId: 'request-1',
  principalId: '사용자',
  credentialId: 'credential-1',
  policyVersions: [{ id: 'policy-1', version: 'v1' }],
  details: { count: 1, prompt: 'PRIVATE_PROMPT', token: 'PRIVATE_TOKEN' },
};
const response = (events: unknown[] = [event], next: string | null = null) =>
  Response.json({ object: 'list', data: events, has_more: next !== null, next_cursor: next });
function required<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 15));
};
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await settle();
  assert.ok(check(), 'UI settled');
}

test('audit client reprojects allowlisted metadata, enforces filters and exact descending cursors', async () => {
  const seen: string[] = [];
  let resultResponse = () => response([event], '8');
  const client = createManagementAuditClient(async (path, init) => {
    seen.push(path);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
    return resultResponse();
  });
  const result = await client.list({ principalId: '사용자', limit: 1 });
  assert.equal(result.state, 'ready');
  if (result.state !== 'ready') throw Error('ready');
  assert.equal(result.data.nextCursor, '8');
  assert.equal(result.data.events[0]?.details.count, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  assert.ok(seen[0]?.startsWith('/v1/audit?'));
  assert.equal(
    new URL(required(seen[0]), 'http://local').searchParams.get('principal_id'),
    '사용자',
  );
  assert.equal((await client.list({ cursor: '08' })).state, 'invalid_query');
  assert.equal(seen.length, 1);
  resultResponse = () => response([{ ...event, principalId: 'other' }]);
  assert.equal((await client.list({ principalId: '사용자' })).state, 'unavailable');
  resultResponse = () => response([{ ...event, eventId: '9' }]);
  assert.equal((await client.list({ cursor: '8' })).state, 'unavailable');
  resultResponse = () => response([event, { ...event, eventId: '7', principalId: 'other' }]);
  assert.equal((await client.list()).state, 'unavailable');
  resultResponse = () => response([event], '7');
  assert.equal((await client.list()).state, 'unavailable');
  resultResponse = () => response([event]);
  assert.equal((await client.list({ fromMs: 1001 })).state, 'unavailable');
});

test('audit client contains private failures, bounds responses and cancels uncooperative work', async () => {
  for (const [status, state] of [
    [400, 'invalid_query'],
    [401, 'unauthenticated'],
    [403, 'denied'],
    [503, 'unavailable'],
  ] as const) {
    const client = createManagementAuditClient(
      async () => new Response('PRIVATE_TOKEN', { status }),
    );
    assert.deepEqual(await client.list(), { state });
  }
  const huge = createManagementAuditClient(
    async () =>
      new Response('x'.repeat(1_048_577), { headers: { 'content-type': 'application/json' } }),
  );
  assert.equal((await huge.list()).state, 'unavailable');
  const client = createManagementAuditClient(async () => new Promise<Response>(() => {}));
  const pending = client.list();
  client.invalidate();
  assert.deepEqual(await pending, { state: 'cancelled' });
});

for (const [compiled, host] of [
  [false, false],
  [true, false],
  [false, true],
  [true, true],
]) {
  test(`audit ${compiled ? 'executed browser bundle' : 'source screen'} reads real HTTP handler with scoped IAM, audit and CSV (host=${host})`, async () => {
    let mount = mountManagementAudit;
    let mountHost = mountSsoUsageWorkspace;
    if (compiled) {
      const code = await buildManagementBrowser({
        root: process.cwd(),
        entry: host ? 'src/management/sso-usage-workspace.ts' : 'src/management/audit-app.ts',
      });
      assert.ok(code);
      assert.doesNotMatch(code, /node:|process\.env|require\(/);
      const bundle = await import(
        `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
      );
      if (host) mountHost = bundle.mountSsoUsageWorkspace;
      else mount = bundle.mountManagementAudit;
    }

    const db = new PGlite();
    await db.exec(
      await readFile(new URL('../migrations/003_gateway_audit.sql', import.meta.url), 'utf8'),
    );
    const sql = {
      query: (query: string, params: readonly unknown[]) => db.query(query, [...params]),
    };
    const writer = createPostgresGatewayAuditStore(sql, () => 1000);
    const reader = createPostgresAuditHistoryReader(sql);
    await writer.append({ ...event, kind: 'models-listed', count: 1 });
    await writer.append({
      ...event,
      kind: 'models-listed',
      principalId: 'other',
      requestId: 'OTHER_PRIVATE_REQUEST',
      count: 1,
    });
    await writer.append({ ...event, kind: 'models-listed', count: 2 });
    const audit: unknown[] = [];
    const queries: unknown[] = [];
    let deny = false;
    let failedAudit = false;
    const handler = createChatHandler({
      newRequestId: () => 'audit-screen-test',
      authenticate: async () => ({
        id: '사용자',
        active: true,
        credentialId: 'credential-1',
        policyVersions: [],
        statements: [
          {
            effect: deny ? ('Deny' as const) : ('Allow' as const),
            actions: ['audit:Read'],
            resources: ['principal:사용자'],
          },
        ],
      }),
      resolveRoute: async () => {
        throw Error('unexpected route');
      },
      checkLimit: async () => {
        throw Error('unexpected limit');
      },
      resolveSecret: async () => {
        throw Error('unexpected secret');
      },
      writeUsage: async () => {
        throw Error('unexpected usage');
      },
      invokeDirect: async () => {
        throw Error('unexpected provider');
      },
      writeAudit: async (value) => {
        if (failedAudit) throw Error('PRIVATE_TOKEN');
        audit.push(value);
        await writer.append(value);
      },
      listAudit: async (query) => {
        queries.push(query);
        return reader(query);
      },
    });
    const server = createServer(async (req, res) => {
      try {
        const result = await handler(
          new Request(`http://local${req.url}`, { headers: { authorization: 'Bearer test-only' } }),
        );
        res.writeHead(result.status, Object.fromEntries(result.headers));
        res.end(Buffer.from(await result.arrayBuffer()));
      } catch {
        res.writeHead(500);
        res.end();
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const request: CatalogRequest = (path, init) =>
      fetch(`http://127.0.0.1:${address.port}${path}`, init);
    const root = new Element();
    const hostApp = host ? mountHost(root, new EventTarget()) : undefined;
    const auditApp = host ? undefined : mount(root);
    const app = {
      dispose() {
        hostApp?.dispose();
        auditApp?.dispose();
      },
      async connect(request: CatalogRequest) {
        if (hostApp) {
          await hostApp.authorize({ request, expiresAt: Date.now() + 60000 });
          root.button('Audit history').click();
          await until(() => /Refresh current page|Audit unavailable/.test(root.text()));
        } else await auditApp?.connect(request);
      },
    };
    try {
      assert.match(root.text(), /Sign-in required/);
      await app.connect(request);
      assert.match(root.text(), /Audit history/);
      assert.match(root.text(), /models-listed/);
      assert.match(root.text(), /credential-1/);
      assert.match(root.text(), /policy-1/);
      assert.doesNotMatch(root.text(), /PRIVATE/);
      assert.equal(
        (
          await db.query('SELECT * FROM gateway_audit_events WHERE kind = $1', [
            'audit-history-read',
          ])
        ).rows.length,
        1,
      );
      const trace = root
        .all()
        .find((node) => node.attrs['aria-label'] === 'Current page audit request correlation');
      assert.ok(trace);
      assert.match(trace.text(), /Events on this page: 2/);
      assert.doesNotMatch(trace.text(), /OTHER_PRIVATE_REQUEST|PRIVATE/);
      assert.equal(queries.length, 1);
      assert.equal(
        audit.filter((entry) => (entry as { kind: string }).kind === 'audit-history-read').length,
        1,
      );
      const filterForm = root.all().find((node) => node.tag === 'form');
      assert.ok(filterForm);
      const principal = filterForm.all().find((node) => node.tag === 'input');
      assert.ok(principal);
      principal.value = '사용자';
      let prevented = false;
      filterForm.listeners.submit?.({
        preventDefault() {
          prevented = true;
        },
      });
      assert.equal(prevented, true);
      await until(() => root.text().includes('Refresh current page'));
      assert.equal(queries.length, 2);
      assert.doesNotMatch(root.text(), /OTHER_PRIVATE_REQUEST|PRIVATE/);
      root.button('Export current page CSV').click();
      await until(() => root.all().some((n) => n.tag === 'a'));
      const link = root.all().find((n) => n.tag === 'a');
      assert.ok(link);
      const csv = await (await fetch(required(link.attrs.href))).text();
      assert.match(csv, /event_id/);
      assert.doesNotMatch(csv, /PRIVATE/);
      deny = true;
      root.button('Refresh current page').click();
      await until(() => root.text().includes('Access denied'));
      assert.doesNotMatch(root.text(), /credential-1|Request correlation/);
      assert.equal(queries.length, 3);
      deny = false;
      // New model action traverses real HTTP, migrated PGlite, IAM and mandatory audit.
      await writer.append({
        ...event,
        kind: 'route-unavailable',
        modelAlias: 'team/model:alpha+v1',
      });
      await app.connect(request);
      root.button('Filter audit for model team/model:alpha+v1').click();
      await until(() => root.text().includes('Refresh current page'));
      assert.equal((queries.at(-1) as { modelAlias?: string }).modelAlias, 'team/model:alpha+v1');
      assert.equal((queries.at(-1) as { principalId?: string }).principalId, '사용자');
      assert.doesNotMatch(root.text(), /models-listed|OTHER_PRIVATE_REQUEST/);
      const persisted = await db.query<{ details: { count?: number } }>(
        "SELECT details FROM gateway_audit_events WHERE kind = 'audit-history-read' ORDER BY event_id DESC LIMIT 1",
      );
      assert.equal(persisted.rows[0]?.details.count, 1);
      const beforeDeny = queries.length;
      deny = true;
      root.button('Filter audit for model team/model:alpha+v1').click();
      await until(() => root.text().includes('Access denied'));
      assert.equal(queries.length, beforeDeny); // denied before database read; no fallback
      assert.doesNotMatch(root.text(), /team\/model:alpha/);
      deny = false;
      failedAudit = true;
      await app.connect(request);
      assert.match(root.text(), /Audit unavailable/);
      assert.doesNotMatch(root.text(), /PRIVATE|credential-1/);
    } finally {
      app.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.close();
    }
  });
}

test('audit screen uses exact returned paging and clears detached actions at trusted expiry', async () => {
  let time = 100;
  const seen: string[] = [];
  const root = new Element();
  const app = mountManagementAudit(root, { now: () => time, schedule: () => () => {} });
  try {
    await app.authorize({
      expiresAt: 200,
      request: async (path) => {
        seen.push(path);
        return response(
          [{ ...event, eventId: seen.length === 1 ? '8' : '7' }],
          seen.length === 1 ? '8' : null,
        );
      },
    });
    const stale = root.button('Next page');
    stale.click();
    await until(() => seen.length === 2 && root.text().includes('Previous page'));
    assert.equal(new URL(required(seen[1]), 'http://local').searchParams.get('cursor'), '8');
    stale.click();
    assert.equal(seen.length, 2);
    const refresh = root.button('Refresh current page');
    time = 200;
    refresh.click();
    assert.match(root.text(), /Session expired/);
    assert.doesNotMatch(root.text(), /credential-1/);
    assert.equal(seen.length, 2);
  } finally {
    app.dispose();
  }
});

test('audit screen preserves rejected UTC drafts, resets self scope, and renders empty/loading safely', async () => {
  const root = new Element();
  const app = mountManagementAudit(root);
  const seen: string[] = [];
  try {
    await app.connect(async (path) => {
      seen.push(path);
      return response([]);
    });
    assert.match(root.text(), /No audit events/);
    const inputs = root.all().filter((node) => node.tag === 'input');
    assert.equal(inputs.length, 5);
    required(inputs[0]).value = '사용자';
    required(inputs[2]).value = 'not-a-date';
    root.button('Apply filters').click();
    await settle();
    assert.match(root.text(), /Invalid audit filters/);
    assert.equal(seen.length, 1);
    assert.equal(root.all().filter((n) => n.tag === 'input')[2]?.value, 'not-a-date');
    root.button('Clear filters').click();
    await until(() => seen.length === 2 && root.text().includes('No audit events'));
    const query = new URL(required(seen[1]), 'http://local').searchParams;
    assert.equal(query.has('principal_id'), false);
    assert.equal(query.has('cursor'), false);
    let release!: (value: Response) => void;
    const pending = app.connect(
      async () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    assert.match(root.text(), /Loading audit/);
    assert.doesNotMatch(root.text(), /No audit events/);
    root.button('Cancel request').click();
    await pending;
    assert.match(root.text(), /Request cancelled/);
    release(response());
    await settle();
    assert.doesNotMatch(root.text(), /credential-1/);
  } finally {
    app.dispose();
  }
});

test('audit renewal discards stale reads and revoked CSV links cannot activate after expiry', async () => {
  let time = 100;
  const root = new Element();
  const app = mountManagementAudit(root, { now: () => time, schedule: () => () => {} });
  let release!: (value: Response) => void;
  try {
    const old = app.authorize({
      expiresAt: 200,
      request: async () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    });
    await app.authorize({
      expiresAt: 300,
      request: async (path) =>
        path.includes('format=csv')
          ? new Response('event_id\r\n8\r\n', {
              headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
            })
          : response([]),
    });
    await old;
    release(response());
    await settle();
    assert.match(root.text(), /No audit events/);
    assert.doesNotMatch(root.text(), /credential-1/);
    root.button('Export current page CSV').click();
    await until(() => root.all().some((n) => n.tag === 'a'));
    const link = root.all().find((n) => n.tag === 'a');
    assert.ok(link);
    const href = required(link.attrs.href);
    assert.equal((await fetch(href)).status, 200);
    time = 300;
    let prevented = 0;
    link.listeners.click?.({
      preventDefault() {
        prevented++;
      },
    });
    assert.equal(prevented, 1);
    assert.match(root.text(), /Session expired/);
    await assert.rejects(fetch(href));
  } finally {
    app.dispose();
  }
});

test('audit CSV forwards opaque decimal cursor and rejects invalid paging metadata', async () => {
  let headers: Record<string, string> = {
    'content-type': 'text/csv',
    'x-has-more': 'true',
    'x-next-cursor': '7',
  };
  const seen: string[] = [];
  const client = createManagementAuditClient(async (path) => {
    seen.push(path);
    return new Response('event_id\r\n7\r\n', { headers });
  });
  const result = await client.csv({ cursor: '8', principalId: '사용자' });
  assert.equal(result.state, 'ready');
  if (result.state === 'ready') assert.equal(result.data.nextCursor, '7');
  assert.equal(new URL(required(seen[0]), 'http://local').searchParams.get('cursor'), '8');
  for (const next of ['8', '9', '07', '9223372036854775808']) {
    headers = { ...headers, 'x-next-cursor': next };
    assert.equal((await client.csv({ cursor: '8' })).state, 'unavailable');
  }
  headers = { 'content-type': 'text/csv', 'x-has-more': 'false', 'x-next-cursor': '7' };
  assert.equal((await client.csv()).state, 'unavailable');
});

for (const artifact of [false, true]) {
  for (const reason of ['unauthenticated', 'expired', 'denied', 'dispose'] as const) {
    test(`audit ${artifact ? 'artifact' : 'source'} ${reason} clears protected data when timer cancellation throws`, async () => {
      const mount: typeof mountManagementAudit = artifact
        ? (
            await import(
              `data:text/javascript;base64,${Buffer.from(await buildManagementBrowser({ root: process.cwd(), entry: 'src/management/audit-app.ts' })).toString('base64')}`
            )
          ).mountManagementAudit
        : mountManagementAudit;
      const root = new Element();
      let cancellations = 0;
      let requests = 0;
      const app = mount(root, {
        now: () => 100,
        schedule: () => () => {
          cancellations++;
          throw new Error('PRIVATE_CANCELLATION_ERROR');
        },
      });
      await app.authorize({
        expiresAt: 200,
        request: async (path) => {
          requests++;
          return path.includes('format=csv')
            ? new Response('event_id\r\n8\r\n', {
                headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
              })
            : response();
        },
      });
      assert.match(root.text(), /credential-1/);
      const refresh = root.button('Refresh current page');
      root.button('Export current page CSV').click();
      await until(() => root.all().some((node) => node.tag === 'a'));
      const href = required(root.all().find((node) => node.tag === 'a')?.attrs.href);
      assert.equal((await fetch(href)).status, 200);
      assert.doesNotThrow(() => (reason === 'dispose' ? app.dispose() : app.clear(reason)));
      assert.equal(cancellations, 1);
      assert.doesNotMatch(root.text(), /credential-1|사용자|PRIVATE/);
      assert.equal(
        root.all().some((node) => node.tag === 'a'),
        false,
      );
      await assert.rejects(fetch(href));
      const count = requests;
      refresh.click();
      await settle();
      assert.equal(requests, count);
      app.dispose();
      assert.equal(cancellations, 1);
    });
  }
}
