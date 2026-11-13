import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

class Element implements CatalogElement {
  textContent: string | null = null;
  value = '';
  children: Element[] = [];
  attributes: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
  readonly tag: string;
  constructor(tag = 'div') {
    this.tag = tag;
  }
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
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
function button(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  return node;
}
function click(root: Element, label: string) {
  button(root, label).listeners.click?.();
}
function field(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'input' && n.attributes['aria-label'] === label);
  assert.ok(node, label);
  return node;
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function waitFor(ready: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!ready() && Date.now() < deadline) await tick();
  assert.ok(ready(), 'history transition');
}
function usage(requestId = 'trace/one+part:two@host') {
  return buildUsageRecord({
    principalId: 'human',
    credentialId: 'PRIVATE-CREDENTIAL',
    policyVersions: [],
    requestId,
    attemptId: 'attempt-one',
    occurredAt: 100,
    modelAlias: 'chat',
    routeKind: 'managed',
    upstreamModelId: 'upstream',
    selectedCandidateId: 'candidate',
    latencyMs: 1,
    outcome: 'succeeded',
    possiblyBilled: false,
    possibleDuplicate: false,
  });
}
function audit(requestId = 'trace/one+part:two@host') {
  return {
    eventId: '1',
    occurredAt: 99,
    kind: 'models-listed',
    requestId,
    principalId: 'human',
    credentialId: 'PRIVATE-CREDENTIAL',
    policyVersions: [],
    details: { count: 0 },
  };
}
const page = (rows: unknown[]) =>
  Response.json({ object: 'list', data: rows, has_more: false, next_cursor: null });
const download = () => ({ save: () => 'started' as const, dispose() {} });

test('usage request investigation replaces old audit filters and scopes JSON and CSV to exact request and principal', async () => {
  const root = new Element();
  const paths: string[] = [];
  const saved: string[] = [];
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      return path.includes('format=csv')
        ? new Response('exact,csv\r\n', {
            headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
          })
        : page(path.includes('/audit?') ? [audit()] : [usage()]);
    },
    {
      save(_kind, csv) {
        saved.push(csv);
        return 'started';
      },
      dispose() {},
    },
  );
  await tick();
  click(root, 'Audit');
  await tick();
  field(root, 'Model').value = 'unrelated';
  field(root, 'From (Unix ms, inclusive)').value = '500';
  field(root, 'To (Unix ms, exclusive)').value = '900';
  field(root, 'Request ID').value = 'old';
  click(root, 'Apply filters');
  await tick();
  click(root, 'Usage');
  click(root, 'Audit for this request');
  await tick();
  const url = new URL(paths.at(-1) ?? '', 'http://local');
  assert.equal(url.pathname, '/management/v1/audit');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    format: 'json',
    principal_id: 'human',
    request_id: 'trace/one+part:two@host',
  });
  assert.equal(field(root, 'Principal').value, 'human');
  assert.equal(field(root, 'Request ID').value, 'trace/one+part:two@host');
  assert.equal(field(root, 'Model').value, '');
  assert.equal(field(root, 'From (Unix ms, inclusive)').value, '');
  assert.equal(field(root, 'To (Unix ms, exclusive)').value, '');
  assert.match(text(root), /trace\/one/);
  assert.doesNotMatch(text(root), /PRIVATE-CREDENTIAL/);
  click(root, 'Download current page CSV');
  await tick();
  assert.equal(saved.length, 1);
  const csvUrl = new URL(paths.at(-1) ?? '', 'http://local');
  assert.equal(csvUrl.searchParams.get('request_id'), 'trace/one+part:two@host');
  assert.equal(csvUrl.searchParams.get('principal_id'), 'human');
  click(root, 'Usage');
  assert.match(text(root), /trace\/one/);
  app.dispose();
});

for (const status of [401, 403])
  test(`request investigation ${status} clears both histories and retained action cannot reuse authority`, async () => {
    const root = new Element();
    let calls = 0;
    const app = mountHistoryWorkspace(
      root,
      async (path) => {
        calls++;
        return path.includes('/audit?') ? new Response('PRIVATE', { status }) : page([usage()]);
      },
      download(),
    );
    await tick();
    const retained = button(root, 'Audit for this request');
    retained.listeners.click?.();
    await tick();
    assert.match(text(root), status === 401 ? /Sign-in required/ : /Access denied/);
    assert.doesNotMatch(text(root), /trace\/one|PRIVATE/);
    const before = calls;
    retained.listeners.click?.();
    await tick();
    assert.equal(calls, before);
    app.dispose();
  });

test('failed request investigation retries same filters and empty results do not invent audit records', async () => {
  const root = new Element();
  const paths: string[] = [];
  let failed = true;
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      if (!path.includes('/audit?')) return page([usage()]);
      return failed ? new Response('PRIVATE', { status: 500 }) : page([]);
    },
    download(),
  );
  await tick();
  click(root, 'Audit for this request');
  await tick();
  assert.match(text(root), /History unavailable/);
  const first = paths.at(-1);
  failed = false;
  click(root, 'Retry');
  await tick();
  assert.equal(paths.at(-1), first);
  assert.match(text(root), /No history matches/);
  app.dispose();
});

test('retained usage investigation action is inert after rerender or disposal', async () => {
  const root = new Element();
  let calls = 0;
  const app = mountHistoryWorkspace(
    root,
    async () => {
      calls++;
      return page([usage()]);
    },
    download(),
  );
  await tick();
  const old = button(root, 'Audit for this request');
  click(root, 'Apply filters');
  await tick();
  const before = calls;
  old.listeners.click?.();
  await tick();
  assert.equal(calls, before);
  const current = button(root, 'Audit for this request');
  app.dispose();
  current.listeners.click?.();
  await tick();
  assert.equal(calls, before);
});

test('usage-to-audit investigation reaches real signed SSO HTTP with scoped durable audit and fresh IAM denial', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { createPostgresSsoCanonicalReviewServer } = await import(
    '../src/gateway/postgres-sso-canonical-review-http.ts'
  );
  const { loadPostgresMigrationSources } = await import(
    '../src/storage/postgres-migration-sources.ts'
  );
  const { createPostgresGatewayAuditStore } = await import(
    '../src/audit/postgres-gateway-audit.ts'
  );
  const { createPostgresUsageLedger } = await import('../src/usage/postgres-ledger.ts');
  const { createSsoAccessTokenFixture } = await import('./sso-access-token-fixture.ts');
  const jwt = await createSsoAccessTokenFixture();
  const token = await jwt.token();
  const db = new PGlite();
  let server: ReturnType<typeof createPostgresSsoCanonicalReviewServer> | undefined;
  let app: ReturnType<typeof mountHistoryWorkspace> | undefined;
  try {
    for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
    await db.exec(`INSERT INTO iam_principals VALUES ('human','human',true),('foreign','human',true);
      INSERT INTO iam_policies VALUES ('reader','v1','[{"effect":"Allow","actions":["usage:ReadSelf","audit:Read"],"resources":["principal:human"]}]');
      INSERT INTO iam_principal_policies VALUES ('human','reader');`);
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    const client = {
      query: async (sql: string, params: readonly unknown[]) => db.query(sql, [...params]),
    };
    const store = createPostgresGatewayAuditStore(client, () => 99);
    for (const [principalId, requestId, count] of [
      ['human', 'trace-one', 7],
      ['human', 'OTHER-REQUEST', 8],
      ['foreign', 'trace-one', 9],
    ] as const) {
      await store.append({
        kind: 'models-listed',
        requestId,
        principalId,
        credentialId: 'PRIVATE',
        policyVersions: [],
        count,
      });
    }
    await createPostgresUsageLedger(client)(usage('trace-one'));
    let ids = 0;
    server = createPostgresSsoCanonicalReviewServer({
      ...jwt.config,
      client,
      newRequestId: () => `investigate-${++ids}`,
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const root = new Element();
    const paths: string[] = [];
    const saved: string[] = [];
    app = mountHistoryWorkspace(
      root,
      async (path, init) => {
        paths.push(path);
        return fetch(origin + path, {
          ...init,
          headers: { ...init.headers, authorization: `Bearer ${token}` },
        });
      },
      {
        save(_kind, csv) {
          saved.push(csv);
          return 'started';
        },
        dispose() {},
      },
    );
    await waitFor(() => text(root).includes('trace-one'));
    click(root, 'Audit for this request');
    await waitFor(() => text(root).includes('1 records shown.'));
    assert.match(text(root), /trace-one/);
    assert.doesNotMatch(text(root), /OTHER-REQUEST|foreign|PRIVATE/);
    assert.equal(paths.length, 2);
    const query = new URL(paths[1] ?? '', origin).searchParams;
    assert.equal(query.get('principal_id'), 'human');
    assert.equal(query.get('request_id'), 'trace-one');
    click(root, 'Download current page CSV');
    await waitFor(() => saved.length === 1);
    assert.match(saved[0] ?? '', /trace-one/);
    assert.doesNotMatch(saved[0] ?? '', /OTHER-REQUEST|foreign/);
    const audits = await db.query<{ outcome: string }>(
      'SELECT outcome FROM sso_audit_history_access_events ORDER BY event_id',
    );
    assert.deepEqual(
      audits.rows.map((r) => r.outcome),
      ['ready', 'ready'],
    );
    click(root, 'Usage');
    await db.exec(
      'UPDATE iam_policies SET statements=\'[{"effect":"Allow","actions":["usage:ReadSelf"],"resources":["principal:human"]}]\' WHERE policy_id=\'reader\'',
    );
    click(root, 'Audit for this request');
    await waitFor(() => text(root).includes('Access denied'));
    assert.doesNotMatch(text(root), /trace-one/);
    const denied = await db.query<{ outcome: string }>(
      'SELECT outcome FROM sso_audit_history_access_events ORDER BY event_id',
    );
    assert.deepEqual(
      denied.rows.map((r) => r.outcome),
      ['ready', 'ready', 'forbidden'],
    );
  } finally {
    app?.dispose();
    if (server)
      await new Promise<void>((resolve, reject) =>
        server?.close((error) => (error ? reject(error) : resolve())),
      );
    await db.close();
  }
});

test('investigation invalidates an older audit page and starts without its cursor', async () => {
  const root = new Element();
  let auditCalls = 0;
  let finish: (response: Response) => void = () => {};
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const paths: string[] = [];
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      if (!path.includes('/audit?')) return page([usage('trace-new')]);
      auditCalls++;
      return auditCalls === 1 ? pending : page([audit('trace-new')]);
    },
    download(),
  );
  await tick();
  click(root, 'Audit');
  click(root, 'Usage');
  click(root, 'Audit for this request');
  await tick();
  assert.match(text(root), /trace-new/);
  finish(new Response('PRIVATE', { status: 403 }));
  await tick();
  assert.match(text(root), /trace-new/);
  assert.doesNotMatch(text(root), /Access denied/);
  const query = new URL(paths.at(-1) ?? '', 'http://local').searchParams;
  assert.equal(query.has('cursor'), false);
  assert.equal(query.get('request_id'), 'trace-new');
  assert.equal(button(root, 'Previous page').attributes.disabled, '');
  app.dispose();
});

test('unfilterable legacy request identifiers fail locally without relaxing audit query validation', async () => {
  const root = new Element();
  let calls = 0;
  const app = mountHistoryWorkspace(
    root,
    async () => {
      calls++;
      return page([usage('legacy?invalid')]);
    },
    download(),
  );
  await tick();
  click(root, 'Audit for this request');
  await tick();
  assert.match(text(root), /Invalid filters/);
  assert.equal(calls, 1);
  app.dispose();
});
