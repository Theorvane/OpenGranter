import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import { startPostgresSsoManagementGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

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
function click(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
}
function input(root: Element, name: string, value: string) {
  const node = nodes(root).find((n) => n.attributes['aria-label'] === name);
  assert.ok(node, name);
  node.value = value;
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function page(audit = false, more = false) {
  const row = audit
    ? {
        eventId: '1',
        occurredAt: 100,
        kind: 'models-listed',
        requestId: 'req',
        principalId: 'human',
        credentialId: 'cred',
        policyVersions: [],
        details: { count: 1, prompt: 'PRIVATE' },
      }
    : buildUsageRecord({
        principalId: 'human',
        credentialId: 'cred',
        policyVersions: [],
        requestId: 'req',
        attemptId: 'a',
        occurredAt: 100,
        modelAlias: '<script>chat</script>',
        routeKind: 'managed',
        upstreamModelId: 'upstream',
        selectedCandidateId: 'candidate',
        latencyMs: 1,
        outcome: 'succeeded',
        possiblyBilled: true,
        possibleDuplicate: true,
        estimatedCost: {
          amountDecimal: '9007199254740993.0000000001',
          currency: 'USD',
          priceVersion: 'v1',
        },
      });
  return Response.json({
    object: 'list',
    data: [row],
    has_more: more,
    next_cursor:
      more && audit
        ? '1'
        : more
          ? Buffer.from(JSON.stringify([100, 'a'])).toString('base64url')
          : null,
  });
}
function downloads() {
  const saved: [string, string][] = [];
  let disposed = 0;
  return {
    saved,
    get disposed() {
      return disposed;
    },
    save(kind: 'usage' | 'audit', csv: string) {
      saved.push([kind, csv]);
      return 'started' as const;
    },
    dispose() {
      disposed++;
    },
  };
}
test('usage row opens a fresh exact request/principal audit query and returns to usage drafts', async () => {
  const root = new Element();
  const paths: string[] = [];
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      return page(path.includes('/audit?'));
    },
    downloads(),
  );
  await tick();
  input(root, 'Principal', 'unsaved-draft');
  click(root, 'View related audit');
  assert.match(text(root), /Loading history/);
  assert.match(text(root), /Audit for request req/);
  await tick();
  const url = new URL(paths.at(-1) ?? '', 'https://local.invalid');
  assert.equal(url.pathname, '/management/v1/audit');
  assert.equal(url.searchParams.get('principal_id'), 'human');
  assert.equal(url.searchParams.get('request_id'), 'req');
  assert.equal(url.searchParams.get('cursor'), null);
  assert.match(text(root), /authorized view/);
  assert.match(text(root), /not invoice reconciliation/);
  click(root, 'Back to usage');
  assert.match(text(root), /Loading history/);
  assert.doesNotMatch(text(root), /9007199254740993/);
  assert.equal(paths.length, 3, 'return rechecks usage authorization');
  assert.equal(paths[2], paths[0], 'return retains submitted usage filters');
  await tick();
  assert.equal(
    nodes(root).find((n) => n.attributes['aria-label'] === 'Principal')?.value,
    'unsaved-draft',
  );
  assert.match(text(root), /9007199254740993.0000000001/);
  click(root, 'View related audit');
  await tick();
  assert.equal(paths.length, 4, 'same row rechecks audit authorization');
  app.dispose();
});

for (const status of [401, 403, 503])
  test(`Back to usage rechecks authorization and hides cached rows on ${status}`, async () => {
    const root = new Element();
    const paths: string[] = [];
    let changed = false;
    let finish: ((response: Response) => void) | undefined;
    const download = downloads();
    const app = mountHistoryWorkspace(
      root,
      async (path) => {
        paths.push(path);
        if (changed) return new Promise<Response>((resolve) => (finish = resolve));
        return page(path.includes('/audit?'));
      },
      download,
    );
    await tick();
    assert.match(text(root), /9007199254740993.0000000001/);
    const stale = nodes(root).find((n) => n.textContent === 'View related audit');
    assert.ok(stale);
    click(root, 'View related audit');
    await tick();
    changed = true;
    click(root, 'Back to usage');
    assert.equal(paths.length, 3, 'return must issue a fresh usage read');
    assert.equal(paths[2], paths[0], 'return must retain the exact usage query');
    assert.match(text(root), /Loading history/);
    assert.doesNotMatch(text(root), /9007199254740993|View related audit/);
    assert.ok(finish);
    finish(new Response('', { status }));
    await tick();
    assert.match(
      text(root),
      status === 401
        ? /Sign-in required/
        : status === 403
          ? /Access denied/
          : /History unavailable/,
    );
    assert.doesNotMatch(text(root), /9007199254740993|View related audit/);
    stale.listeners.click?.();
    assert.equal(paths.length, 3, 'stale row callbacks cannot revive cached data');
    assert.equal(download.disposed, status === 503 ? 0 : 1);
    app.dispose();
  });

test('correlation discards previous audit drafts/range/model/cursor and manual apply clears context', async () => {
  const root = new Element();
  const paths: string[] = [];
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      return page(path.includes('/audit?'), true);
    },
    downloads(),
  );
  await tick();
  click(root, 'Audit');
  await tick();
  input(root, 'Principal', 'other');
  input(root, 'Model', 'stale-model');
  input(root, 'Request ID', 'stale-request');
  input(root, 'From (Unix ms, inclusive)', '1');
  input(root, 'To (Unix ms, exclusive)', '200');
  click(root, 'Apply filters');
  await tick();
  click(root, 'Next page');
  await tick();
  click(root, 'Usage');
  // Main rechecks authority on tab return; act only on the newly loaded row.
  assert.match(text(root), /Loading history/);
  await tick();
  click(root, 'View related audit');
  await tick();
  const query = new URL(paths.at(-1) ?? '', 'https://local.invalid').searchParams;
  assert.deepEqual([...query.keys()].sort(), ['format', 'principal_id', 'request_id']);
  for (const label of ['Model', 'From (Unix ms, inclusive)', 'To (Unix ms, exclusive)'])
    assert.equal(nodes(root).find((n) => n.attributes['aria-label'] === label)?.value, '');
  assert.equal(nodes(root).find((n) => n.attributes['aria-label'] === 'Request ID')?.value, 'req');
  click(root, 'Apply filters');
  await tick();
  assert.doesNotMatch(text(root), /Audit for request/);
  app.dispose();
});

test('related audit next, retry and CSV retain the exact correlation scope', async () => {
  const root = new Element();
  const paths: string[] = [];
  let fail = false;
  const download = downloads();
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      if (path.includes('format=csv'))
        return new Response('request_id\nreq\n', {
          headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
        });
      if (fail) return new Response('', { status: 503 });
      if (path.includes('cursor='))
        return Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
      return page(path.includes('/audit?'), true);
    },
    download,
  );
  await tick();
  click(root, 'View related audit');
  await tick();
  fail = true;
  click(root, 'Next page');
  await tick();
  assert.match(text(root), /History unavailable/);
  fail = false;
  click(root, 'Retry');
  await tick();
  click(root, 'Download current page CSV');
  await tick();
  for (const path of paths.slice(1)) {
    const query = new URL(path, 'https://local.invalid').searchParams;
    assert.equal(query.get('principal_id'), 'human');
    assert.equal(query.get('request_id'), 'req');
  }
  assert.equal(download.saved.length, 1);
  assert.equal(download.saved[0]?.[0], 'audit');
  app.dispose();
});

for (const status of [401, 403])
  test(`related audit ${status} clears both histories and stale row action`, async () => {
    const root = new Element();
    let calls = 0;
    const app = mountHistoryWorkspace(
      root,
      async (path) => {
        calls++;
        return path.includes('/audit?') ? new Response('', { status }) : page();
      },
      downloads(),
    );
    await tick();
    const old = nodes(root).find((n) => n.textContent === 'View related audit');
    assert.ok(old);
    old.listeners.click?.();
    await tick();
    assert.match(text(root), status === 401 ? /Sign-in required/ : /Access denied/);
    assert.doesNotMatch(text(root), /Audit for request|human|900719925/);
    old.listeners.click?.();
    assert.equal(calls, 2);
    app.dispose();
  });

test('empty related audit is explicit and no more permissive read is attempted', async () => {
  const root = new Element();
  const paths: string[] = [];
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      return path.includes('/audit?')
        ? Response.json({ object: 'list', data: [], has_more: false, next_cursor: null })
        : page();
    },
    downloads(),
  );
  await tick();
  click(root, 'View related audit');
  await tick();
  assert.match(text(root), /No history matches/);
  assert.match(text(root), /authorized view/);
  assert.equal(paths.length, 2);
  app.dispose();
});

test('dispose during related audit prevents late data and detached actions', async () => {
  const root = new Element();
  let finish!: (r: Response) => void;
  let calls = 0;
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      calls++;
      if (path.includes('/audit?'))
        return new Promise((resolve) => {
          finish = resolve;
        });
      return page();
    },
    downloads(),
  );
  await tick();
  const old = nodes(root).find((n) => n.textContent === 'View related audit');
  assert.ok(old);
  old.listeners.click?.();
  app.dispose();
  finish(page(true));
  await tick();
  old.listeners.click?.();
  assert.equal(root.children.length, 0);
  assert.equal(calls, 2);
});

async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Expected UI state not reached');
}

test('request drill-down uses owned HTTP, signed SSO, migrated SQL and fresh audit Deny', async () => {
  const jwt = await createSsoAccessTokenFixture();
  const token = await jwt.token();
  const db = new PGlite();
  const client: PostgresConnection = {
    query: (sql, params) => db.query(sql, [...params]),
    transaction: (callback) =>
      db.transaction((tx) =>
        callback({
          exec: (sql) => tx.exec(sql),
          query: (sql, params) => tx.query(sql, [...params]),
        }),
      ),
    close: () => db.close(),
  };
  const runtime = await startPostgresSsoManagementGateway({
    ...jwt.config,
    host: '127.0.0.1',
    port: 0,
    newRequestId: () => 'correlation-read',
    openConnection: () => client,
  });
  let app: ReturnType<typeof mountHistoryWorkspace> | undefined;
  try {
    await db.exec(`INSERT INTO iam_principals VALUES ('human','human',true);
      INSERT INTO iam_policies VALUES ('reader','v1','[{"effect":"Allow","actions":["usage:ReadSelf","audit:Read"],"resources":["principal:human"]}]');
      INSERT INTO iam_principal_policies VALUES ('human','reader');`);
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    const store = createPostgresGatewayAuditStore(client, () => 99);
    for (const requestId of ['req', 'unrelated'])
      await store.append({
        kind: 'models-listed',
        principalId: 'human',
        requestId,
        credentialId: 'old',
        policyVersions: [],
        count: 1,
      });
    const usage = (await page().json()) as { data: unknown[] };
    await createPostgresUsageLedger(client)(usage.data[0] as ReturnType<typeof buildUsageRecord>);
    const root = new Element();
    const paths: string[] = [];
    const saved = downloads();
    app = mountHistoryWorkspace(
      root,
      async (path, init) => {
        paths.push(path);
        return fetch(`http://127.0.0.1:${runtime.address.port}${path}`, {
          ...init,
          headers: { ...init.headers, authorization: `Bearer ${token}` },
        });
      },
      saved,
    );
    await until(() => text(root).includes('records shown'));
    click(root, 'View related audit');
    await until(() => text(root).includes('models-listed'));
    assert.doesNotMatch(text(root), /unrelated/);
    assert.match(paths.at(-1) ?? '', /request_id=req/);
    click(root, 'Download current page CSV');
    await until(() => saved.saved.length === 1);
    assert.match(saved.saved[0]?.[1] ?? '', /req/);
    assert.doesNotMatch(saved.saved[0]?.[1] ?? '', /unrelated/);
    click(root, 'Back to usage');
    assert.match(text(root), /Loading history/);
    assert.doesNotMatch(text(root), /9007199254740993/);
    await until(() => text(root).includes('records shown'));
    assert.match(text(root), /9007199254740993.0000000001/);
    await db.query('UPDATE iam_policies SET version=$1, statements=$2::jsonb', [
      'v2',
      JSON.stringify([
        { effect: 'Allow', actions: ['usage:ReadSelf'], resources: ['principal:human'] },
        { effect: 'Deny', actions: ['audit:Read'], resources: ['principal:human'] },
      ]),
    ]);
    click(root, 'View related audit');
    await until(() => text(root).includes('Access denied'));
    assert.doesNotMatch(text(root), /human|900719925|Audit for request/);
    const evidence = await db.query<{ outcome: string }>(
      'SELECT outcome FROM sso_audit_history_access_events ORDER BY event_id',
    );
    assert.deepEqual(
      evidence.rows.map((row) => row.outcome),
      ['ready', 'ready', 'forbidden'],
    );
  } finally {
    app?.dispose();
    await runtime.close();
  }
});

test('back to usage preserves the selected page and applied range', async () => {
  const root = new Element();
  const paths: string[] = [];
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      if (path.includes('/audit?')) return page(true);
      const result = (await page(false, !path.includes('cursor=')).json()) as {
        data: { attemptId: string }[];
      };
      if (path.includes('cursor=')) {
        assert.ok(result.data[0]);
        result.data[0].attemptId = '0';
      }
      return Response.json(result);
    },
    downloads(),
  );
  await tick();
  input(root, 'From (Unix ms, inclusive)', '10');
  input(root, 'To (Unix ms, exclusive)', '200');
  click(root, 'Apply filters');
  await tick();
  click(root, 'Next page');
  await tick();
  const before = paths.length;
  const selectedPage = paths.at(-1);
  assert.ok(selectedPage);
  assert.ok(new URL(selectedPage, 'https://local.invalid').searchParams.get('cursor'));
  input(root, 'Principal', 'unsaved-principal');
  click(root, 'View related audit');
  await tick();
  click(root, 'Back to usage');
  assert.equal(paths.length, before + 2, 'audit and usage each require a fresh read');
  assert.equal(paths.at(-1), selectedPage, 'recheck uses the exact applied filters and cursor');
  assert.match(text(root), /Loading history/);
  assert.doesNotMatch(text(root), /9007199254740993/);
  await tick();
  assert.match(text(root), /9007199254740993.0000000001/);
  assert.equal(
    nodes(root).find((n) => n.attributes['aria-label'] === 'Principal')?.value,
    'unsaved-principal',
  );
  assert.equal(
    nodes(root).find((n) => n.attributes['aria-label'] === 'From (Unix ms, inclusive)')?.value,
    '10',
  );
  const previous = nodes(root).find((n) => n.textContent === 'Previous page');
  assert.ok(previous);
  assert.equal(previous.attributes.disabled, undefined);
  click(root, 'Previous page');
  await tick();
  const query = new URL(paths.at(-1) ?? '', 'https://local.invalid').searchParams;
  assert.equal(query.get('from_ms'), '10');
  assert.equal(query.get('to_ms'), '200');
  assert.equal(query.get('cursor'), null);
  app.dispose();
});

test('request identifier is text-only and URL encoded, never a filter injection', async () => {
  const root = new Element();
  const requestId = 'req+trace:/@test';
  const paths: string[] = [];
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      if (path.includes('/audit?'))
        return Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
      const result = (await page().json()) as { data: { requestId: string }[] };
      assert.ok(result.data[0]);
      result.data[0].requestId = requestId;
      return Response.json(result);
    },
    downloads(),
  );
  await tick();
  click(root, 'View related audit');
  await tick();
  const query = new URL(paths.at(-1) ?? '', 'https://local.invalid').searchParams;
  assert.equal(query.get('request_id'), requestId);
  assert.deepEqual(query.getAll('principal_id'), ['human']);
  assert.equal(
    nodes(root).some((n) => n.tag === 'script'),
    false,
  );
  assert.ok(text(root).includes(requestId));
  app.dispose();
});
