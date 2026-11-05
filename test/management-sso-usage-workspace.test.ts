import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import type { CatalogRequest } from '../src/management/catalog-client.ts';
import { mountSsoUsageWorkspace } from '../src/management/sso-usage-workspace.ts';

class Element {
  textContent: string | null = null;
  children: Element[] = [];
  value = '';
  attributes: Record<string, string> = {};
  events: Record<string, () => void> = {};
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
  addEventListener(key: string, callback: () => void) {
    this.events[key] = callback;
  }
  focus() {}
  text(): string {
    return [this.textContent ?? '', ...this.children.map((n) => n.text())].join(' ');
  }
  find(text: string): Element | undefined {
    return this.tag === 'button' && this.textContent === text
      ? this
      : this.children.map((n) => n.find(text)).find(Boolean);
  }
  click(text: string) {
    const button = this.find(text);
    assert.ok(button, text);
    button.events.click?.();
  }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 15));
const model = { id: 'team/chat', object: 'model', created: 1, owned_by: 'opengranter' };
function response(path: string) {
  return path.startsWith('/management/v1/models')
    ? Response.json({ object: 'list', data: [model] })
    : Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
}
function fixture() {
  const root = new Element();
  const lifecycle = new EventTarget();
  let time = 100;
  const jobs: (() => void)[] = [];
  const app = mountSsoUsageWorkspace(root, lifecycle, {
    now: () => time,
    schedule: (_delay, callback) => {
      jobs.push(callback);
      return () => {};
    },
  });
  return {
    root,
    lifecycle,
    app,
    jobs,
    time(value: number) {
      time = value;
    },
  };
}

test('workspace navigates existing SSO catalog and usage with fresh requests and no proxy fallback', async () => {
  const f = fixture();
  const paths: string[] = [];
  assert.match(f.root.text(), /Sign-in/);
  f.root.click('Usage history');
  assert.equal(paths.length, 0);
  await f.app.authorize({
    expiresAt: 200,
    request: async (path, init) => {
      paths.push(path);
      assert.equal(init.cache, 'no-store');
      return response(path);
    },
  });
  assert.match(f.root.text(), /team\/chat/);
  f.root.click('Usage history');
  await settle();
  assert.match(f.root.text(), /No usage records/);
  assert.doesNotMatch(f.root.text(), /team\/chat/);
  f.root.click('Models');
  await settle();
  assert.match(f.root.text(), /team\/chat/);
  assert.deepEqual(paths, [
    '/management/v1/models',
    '/management/v1/usage?format=json',
    '/management/v1/models',
  ]);
  f.app.dispose();
});

test('switch aborts old work and old unauthorized completions cannot clear a renewed grant', async () => {
  const f = fixture();
  let finish!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  await f.app.authorize({ expiresAt: 200, request: async (path) => response(path) });
  await f.app.authorize({
    expiresAt: 200,
    request: async (path, init) => {
      if (path.includes('/usage')) {
        signal = init.signal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
      return response(path);
    },
  });
  f.root.click('Usage history');
  await settle();
  assert.ok(signal);
  await f.app.authorize({ expiresAt: 300, request: async (path) => response(path) });
  assert.equal(signal.aborted, true);
  finish(new Response(null, { status: 401 }));
  await settle();
  assert.match(f.root.text(), /team\/chat/);
  f.app.dispose();
});

test('current denial clears both views, and navigation cannot replay authority', async () => {
  const f = fixture();
  let reads = 0;
  await f.app.authorize({
    expiresAt: 200,
    request: async (path) => {
      reads++;
      return path.includes('/usage') ? new Response(null, { status: 403 }) : response(path);
    },
  });
  f.root.click('Usage history');
  await settle();
  assert.match(f.root.text(), /Access denied/);
  f.root.click('Models');
  await settle();
  assert.match(f.root.text(), /Access denied/);
  assert.equal(reads, 2);
  f.app.dispose();
});

test('suspended timer deadline gates navigation and pagehide/pageshow requires a fresh grant', async () => {
  const f = fixture();
  let reads = 0;
  const request: CatalogRequest = async (path) => {
    reads++;
    return response(path);
  };
  await f.app.authorize({ expiresAt: 200, request });
  f.time(200);
  f.root.click('Usage history');
  await settle();
  assert.match(f.root.text(), /Session expired/);
  assert.equal(reads, 1);
  f.time(210);
  await f.app.authorize({ expiresAt: 300, request });
  f.lifecycle.dispatchEvent(new Event('pagehide'));
  await f.app.authorize({ expiresAt: 400, request });
  assert.equal(reads, 2);
  f.lifecycle.dispatchEvent(new Event('pageshow'));
  f.root.click('Usage history');
  await settle();
  assert.equal(reads, 2);
  assert.match(f.root.text(), /Sign-in/);
  await f.app.authorize({ expiresAt: 400, request });
  assert.equal(reads, 3);
  f.app.dispose();
  await f.app.authorize({ expiresAt: 500, request });
  f.lifecycle.dispatchEvent(new Event('pageshow'));
  assert.equal(f.root.text().trim(), '');
  assert.equal(reads, 3);
});

test('timer expiry clears active view; stale timer and invalid replacement cannot reuse old grant', async () => {
  const f = fixture();
  let reads = 0;
  const request: CatalogRequest = async (path) => {
    reads++;
    return response(path);
  };
  await f.app.authorize({ expiresAt: 200, request });
  const old = [...f.jobs];
  await f.app.authorize({ expiresAt: 300, request });
  f.time(200);
  for (const job of old) job();
  assert.match(f.root.text(), /team\/chat/);
  f.time(300);
  for (const job of [...f.jobs]) job();
  assert.match(f.root.text(), /Session expired/);
  await f.app.authorize({ expiresAt: NaN, request });
  f.root.click('Usage history');
  await settle();
  assert.equal(reads, 2);
  assert.match(f.root.text(), /Session expired/);
  f.app.dispose();
});

test('workspace is buildable through the reviewed public boundary', async () => {
  const javascript = await buildManagementBrowser({
    root: process.cwd(),
    entry: 'src/management/sso-usage-workspace.ts',
  });
  assert.match(javascript, /mountSsoUsageWorkspace/);
  assert.doesNotMatch(javascript, /node:|process\.env|localStorage|sessionStorage/);
});

test('workspace switches signed SSO HTTP views against shared SQL and durable audits, then clears on fresh IAM denial', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { readFile } = await import('node:fs/promises');
  const { createPostgresSsoReviewBrowserServer } = await import(
    '../src/gateway/postgres-sso-review-browser-http.ts'
  );
  const { loadPostgresMigrationSources } = await import(
    '../src/storage/postgres-migration-sources.ts'
  );
  const { createPostgresUsageLedger } = await import('../src/usage/postgres-ledger.ts');
  const { buildUsageRecord } = await import('../src/usage/record-usage.ts');
  const { createSsoAccessTokenFixture } = await import('./sso-access-token-fixture.ts');
  const db = new PGlite();
  const jwt = await createSsoAccessTokenFixture();
  const token = await jwt.token();
  const sql = { query: (text: string, values: readonly unknown[]) => db.query(text, [...values]) };
  let ids = 0;
  const ports = { ...jwt.config, client: sql, newRequestId: () => `workspace-${++ids}` };
  // Explicit production source composition; runtime/manifest remain unchanged.
  const javascript = await buildManagementBrowser({
    root: process.cwd(),
    entry: 'src/management/sso-usage-workspace.ts',
  });
  const server = createPostgresSsoReviewBrowserServer({ ...ports, javascript });
  const f = fixture();
  const originalRevoke = URL.revokeObjectURL;
  const revoked: string[] = [];
  URL.revokeObjectURL = (url) => {
    revoked.push(url);
    originalRevoke(url);
  };
  const paths: string[] = [];
  async function until(text: RegExp) {
    for (let n = 0; n < 200 && !text.test(f.root.text()); n++) await settle();
    assert.match(f.root.text(), text);
  }
  try {
    for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
    await db.exec(
      await readFile(new URL('../contracts/sso-usage-audit-schema.sql', import.meta.url), 'utf8'),
    );
    await db.exec(`
      INSERT INTO iam_principals VALUES ('human','human',true);
      INSERT INTO iam_policies VALUES ('allow','v1','[{"effect":"Allow","actions":["llm:InvokeModel","llm:UseProvider","usage:ReadSelf"],"resources":["model:*","provider:openai","principal:human"]}]');
      INSERT INTO iam_roles VALUES ('reader');
      INSERT INTO iam_principal_roles VALUES ('human','reader');
      INSERT INTO iam_role_policies VALUES ('reader','allow');
      INSERT INTO catalog_models (alias,created_at_seconds,enabled) VALUES ('team/chat',1,true);
      INSERT INTO catalog_routes (route_id,alias,kind,version,credential_ref,candidates) VALUES ('direct','team/chat','managed','v1',NULL,'[{"id":"one","kind":"managed","providerId":"openai","upstreamModelId":"private-upstream"}]');
      UPDATE catalog_models SET active_route_id='direct' WHERE alias='team/chat';
    `);
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    await createPostgresUsageLedger(sql)(
      buildUsageRecord({
        principalId: 'human',
        credentialId: 'credential',
        policyVersions: [],
        requestId: 'chat',
        attemptId: 'attempt',
        modelAlias: 'team/chat',
        routeKind: 'managed',
        upstreamModelId: 'upstream',
        selectedCandidateId: 'candidate',
        occurredAt: 1,
        latencyMs: 2,
        outcome: 'succeeded',
        possiblyBilled: true,
        possibleDuplicate: false,
      }),
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = 'http://127.0.0.1:' + address.port;
    const shell = await fetch(origin + '/management');
    assert.equal(shell.status, 200);
    assert.match(await shell.text(), /src="\/management\/app.js"/);
    const module = await fetch(origin + '/management/app.js');
    assert.equal(module.status, 200);
    assert.equal(await module.text(), javascript);
    // Workspace library only: trusted adapter remains external. Structural DOM
    // authorization below is explicit test authority, not native browser login.
    await f.app.authorize({
      expiresAt: 1000,
      request: (path, init) => {
        paths.push(path);
        return fetch(`http://127.0.0.1:${address.port}${path}`, {
          ...init,
          headers: { ...init.headers, authorization: `Bearer ${token}` },
        });
      },
    });
    assert.match(f.root.text(), /team\/chat/);
    f.root.click('Usage history');
    await until(/human/);
    assert.match(f.root.text(), /Unknown/);
    f.root.click('Export current page CSV');
    await until(/Download usage.csv/);
    f.root.click('Inspect model team/chat');
    await until(/Model ID/);
    assert.equal(revoked.length, 1, 'model navigation revokes the CSV download');
    assert.doesNotMatch(f.root.text(), /Download usage.csv/);
    assert.doesNotMatch(f.root.text(), /Inspect attempt|private-upstream/);
    f.root.click('Back to models');
    await until(/Models available/);
    await until(/team\/chat/);
    assert.deepEqual(paths, [
      '/management/v1/models',
      '/management/v1/usage?format=json',
      '/management/v1/usage?format=csv',
      '/management/v1/models/team%2Fchat',
      '/management/v1/models',
    ]);
    assert.equal((await db.query('SELECT * FROM sso_catalog_audit_events')).rows.length, 3);
    assert.equal((await db.query('SELECT * FROM sso_usage_audit_events')).rows.length, 2);
    // Same production source handler serves detail/export, not a test router.
    const review = (path: string, headers: Record<string, string> = {}) =>
      fetch(`http://127.0.0.1:${address.port}${path}`, {
        headers: { authorization: `Bearer ${token}`, ...headers },
      });
    const detail = await review('/management/v1/models/team%2Fchat');
    assert.equal(detail.status, 200);
    assert.match(await detail.text(), /team\/chat/);
    const csv = await review('/management/v1/usage?format=csv');
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(await csv.text(), /attempt/);
    const other = await review('/management/v1/usage?principal_id=other');
    assert.equal(other.status, 403);
    assert.doesNotMatch(await other.text(), /attempt|private-upstream/);
    const cookie = await review('/management/v1/usage', {
      authorization: '',
      cookie: 'session=not-authority',
    });
    assert.equal(cookie.status, 401);
    await cookie.text();
    f.root.click('Usage history');
    await until(/Inspect attempt/);
    const detached = f.root.find('Inspect model team/chat');
    assert.ok(detached);
    await db.exec('DELETE FROM iam_role_policies');
    detached.events.click?.();
    await until(/Model not found/);
    const beforeDetached = paths.length;
    detached.events.click?.();
    await settle();
    assert.equal(paths.length, beforeDetached, 'disposed usage controls cannot dispatch');
    f.root.click('Usage history');
    await until(/Access denied/);
    f.root.click('Models');
    await settle();
    assert.match(f.root.text(), /Access denied/);
    assert.equal(paths.length, 8);
    const audits = await db.query<{ outcome: string }>(
      'SELECT outcome FROM sso_usage_audit_events ORDER BY event_id',
    );
    assert.deepEqual(
      audits.rows.map((row) => row.outcome),
      ['ready', 'ready', 'ready', 'forbidden', 'unauthenticated', 'ready', 'forbidden'],
    );
    assert.doesNotMatch(f.root.text(), /private-upstream|Bearer|credential/);
    // Missing durable audit fails closed independently on each route.
    await db.exec('DROP TABLE sso_usage_audit_events');
    const failedUsage = await review('/management/v1/usage');
    assert.equal(failedUsage.status, 503);
    assert.equal(failedUsage.headers.get('cache-control'), 'no-store');
    assert.match(await failedUsage.text(), /audit_unavailable/);
    await db.exec('DROP TABLE sso_catalog_audit_events');
    const failedCatalog = await review('/management/v1/models');
    assert.equal(failedCatalog.status, 503);
    assert.match(await failedCatalog.text(), /audit_unavailable/);
  } finally {
    f.app.dispose();
    URL.revokeObjectURL = originalRevoke;
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  }
});

test('view navigation revokes completed CSV downloads and pagehide aborts a pending export', async () => {
  const f = fixture();
  const original = URL.revokeObjectURL;
  const revoked: string[] = [];
  URL.revokeObjectURL = (url) => {
    revoked.push(url);
    original(url);
  };
  let pending = false;
  let exportSignal: AbortSignal | null | undefined;
  try {
    await f.app.authorize({
      expiresAt: 200,
      request: async (path, init) => {
        if (path.includes('format=csv')) {
          if (pending) {
            exportSignal = init.signal;
            return new Promise(() => {});
          }
          return new Response('model\r\nchat\r\n', {
            headers: { 'content-type': 'text/csv', 'x-usage-has-more': 'false' },
          });
        }
        return response(path);
      },
    });
    f.root.click('Usage history');
    await settle();
    f.root.click('Export current page CSV');
    await settle();
    assert.match(f.root.text(), /Download usage.csv/);
    f.root.click('Models');
    await settle();
    assert.equal(revoked.length, 1);
    assert.doesNotMatch(f.root.text(), /Download usage.csv/);
    f.root.click('Usage history');
    await settle();
    pending = true;
    f.root.click('Export current page CSV');
    await settle();
    assert.ok(exportSignal);
    f.lifecycle.dispatchEvent(new Event('pagehide'));
    assert.equal(exportSignal.aborted, true);
    assert.match(f.root.text(), /Sign-in/);
    assert.doesNotMatch(f.root.text(), /Download usage.csv/);
  } finally {
    f.app.dispose();
    URL.revokeObjectURL = original;
  }
});

test('detached workspace navigation cannot spend renewed authority or replace the active view', async () => {
  for (const change of ['navigation', 'renewal', 'clear', 'pagehide', 'dispose'] as const) {
    const f = fixture();
    const paths: string[] = [];
    const grant = {
      expiresAt: 300,
      request: async (path: string) => {
        paths.push(path);
        return response(path);
      },
    };
    await f.app.authorize(grant);
    const detached = f.root.find('Usage history');
    assert.ok(detached);
    switch (change) {
      case 'navigation':
        f.root.click('Models');
        await settle();
        break;
      case 'renewal':
        await f.app.authorize(grant);
        break;
      case 'clear':
        f.app.clear();
        await f.app.authorize(grant);
        break;
      case 'pagehide':
        f.lifecycle.dispatchEvent(new Event('pagehide'));
        f.lifecycle.dispatchEvent(new Event('pageshow'));
        await f.app.authorize(grant);
        break;
      case 'dispose':
        f.app.dispose();
        break;
    }
    const before = f.root.text();
    const count = paths.length;
    detached.events.click?.();
    await settle();
    assert.equal(paths.length, count, change + ': detached navigation must not dispatch');
    assert.equal(f.root.text(), before, change + ': detached navigation must not rerender');
    if (change !== 'dispose') {
      f.root.click('Usage history');
      await settle();
      assert.equal(paths.length, count + 1, change + ': current navigation still works');
      assert.match(f.root.text(), /No usage records/);
    }
    f.app.dispose();
  }
});
