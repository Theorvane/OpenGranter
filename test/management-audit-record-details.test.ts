import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';

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
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function event(kind = 'attempt', details: Record<string, unknown> = {}) {
  return {
    eventId: '9007199254740993',
    occurredAt: 100,
    kind,
    requestId: 'trace-one',
    principalId: 'human',
    credentialId: 'PRIVATE-CREDENTIAL',
    policyVersions: [{ id: 'PRIVATE-POLICY', version: 'v1' }],
    details: {
      routeVersion: 'v1',
      modelAlias: 'chat',
      candidateId: 'candidate-one',
      outcome: 'failed',
      failureCategory: 'timeout',
      possiblyBilled: false,
      ...details,
    },
  };
}
const page = (row = event()) =>
  Response.json({ object: 'list', data: [row], has_more: false, next_cursor: null });
const download = () => ({ save: () => 'started' as const, dispose() {} });
async function open(request: Parameters<typeof mountHistoryWorkspace>[1]) {
  const root = new Element();
  const app = mountHistoryWorkspace(root, request, download());
  click(root, 'Audit');
  await tick();
  return { root, app };
}
function values(root: Element) {
  const disclosure = nodes(root).find((n) => n.tag === 'details');
  assert.ok(disclosure, 'audit event disclosure');
  assert.equal(
    nodes(disclosure).find((n) => n.tag === 'summary')?.textContent,
    'Inspect audit event',
  );
  const entries = nodes(disclosure).filter((n) => n.tag === 'dt' || n.tag === 'dd');
  return Object.fromEntries(
    entries
      .filter((_, i) => i % 2 === 0)
      .map((n, i) => [n.textContent, entries[i * 2 + 1]?.textContent]),
  );
}
test('canonical audit inspection preserves failed reason, exact event ID and false without raw metadata', async () => {
  let reads = 0;
  const { root, app } = await open(async () => {
    reads++;
    return page(
      event('attempt', {
        prompt: 'PRIVATE-PROMPT',
        response: 'PRIVATE-RESPONSE',
        apiKey: 'PRIVATE-KEY',
      }),
    );
  });
  const fields = values(root);
  assert.equal(fields['Event ID'], '9007199254740993');
  assert.equal(fields.Model, 'chat');
  assert.equal(fields.Outcome, 'failed');
  assert.equal(fields['Failure category'], 'timeout');
  assert.equal(fields['Possibly billed'], 'false');
  assert.equal(fields['Recorded upstream target'], 'Unknown');
  assert.equal(reads, 2, 'inspection adds no request beyond initial usage and explicit audit tab');
  assert.doesNotMatch(text(root), /PRIVATE|credentialId|policyVersions/);
  assert.match(text(root), /not proof of the actual model served/);
  app.dispose();
  assert.equal(root.children.length, 0);
});
test('read events retain zero count and no invented routing metadata', async () => {
  const { root, app } = await open(async () =>
    page(event('usage-read', { targetPrincipalId: 'human', count: 0, mode: 'self' })),
  );
  const fields = values(root);
  assert.equal(fields.Count, '0');
  assert.equal(fields['Target principal'], 'human');
  assert.equal(fields['Read mode'], 'self');
  assert.equal(fields.Outcome, 'Unknown');
  assert.equal(fields.Model, 'Unknown');
  app.dispose();
});
test('delegated attempt exposes recorded target but not authorization arrays or nested objects', async () => {
  const { root, app } = await open(async () =>
    page(
      event('delegated-attempt', {
        upstreamModelId: 'registered-target',
        candidateIds: ['PRIVATE-CANDIDATE'],
        authorizedProviderSlugs: ['PRIVATE-PROVIDER'],
        decision: { prompt: 'PRIVATE-PROMPT' },
        possiblyBilled: true,
      }),
    ),
  );
  assert.equal(values(root)['Recorded upstream target'], 'registered-target');
  assert.equal(values(root)['Possibly billed'], 'true');
  assert.doesNotMatch(text(root), /PRIVATE|\[object Object\]/);
  app.dispose();
});
test('refresh clears inspection while loading and failure cannot restore it', async () => {
  let finish: ((r: Response) => void) | undefined;
  let pending = false;
  const { root, app } = await open(async () =>
    pending
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : page(),
  );
  values(root);
  pending = true;
  click(root, 'Apply filters');
  assert.equal(
    nodes(root).some((n) => n.tag === 'details'),
    false,
  );
  finish?.(new Response(null, { status: 500 }));
  await tick();
  assert.match(text(root), /History unavailable/);
  assert.equal(
    nodes(root).some((n) => n.tag === 'details'),
    false,
  );
  app.dispose();
});
test('fresh denied response clears rows and invalidates retained audit controls', async () => {
  let denied = false;
  let reads = 0;
  const { root, app } = await open(async () => {
    reads++;
    return denied ? new Response(null, { status: 403 }) : page();
  });
  values(root);
  const old = nodes(root).find((n) => n.tag === 'button' && n.textContent === 'Apply filters');
  denied = true;
  click(root, 'Apply filters');
  await tick();
  assert.match(text(root), /Access denied/);
  assert.equal(
    nodes(root).some((n) => n.tag === 'details'),
    false,
  );
  const before = reads;
  old?.listeners.click?.();
  await tick();
  assert.equal(reads, before);
  app.dispose();
});
test('malformed audit metadata fails closed without inspection', async () => {
  const { root, app } = await open(async () =>
    page(event('attempt', { possiblyBilled: 'PRIVATE-INVALID' })),
  );
  assert.match(text(root), /History unavailable/);
  assert.equal(
    nodes(root).some((n) => n.tag === 'details'),
    false,
  );
  assert.doesNotMatch(text(root), /PRIVATE/);
  app.dispose();
});

async function waitFor(ready: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!ready() && Date.now() < deadline) await tick();
  assert.ok(ready(), 'local HTTP transition');
}
test('audit inspection uses real local SSO HTTP and migrated embedded PostgreSQL, then clears after policy denial', async () => {
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
  const { createSsoAccessTokenFixture } = await import('./sso-access-token-fixture.ts');
  const jwt = await createSsoAccessTokenFixture();
  const token = await jwt.token();
  const db = new PGlite();
  let server: ReturnType<typeof createPostgresSsoCanonicalReviewServer> | undefined;
  let app: ReturnType<typeof mountHistoryWorkspace> | undefined;
  try {
    for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
    await db.exec(`
      INSERT INTO iam_principals VALUES ('human','human',true),('foreign','human',true);
      INSERT INTO iam_policies VALUES ('reader','v1','[{"effect":"Allow","actions":["usage:ReadSelf","audit:Read"],"resources":["principal:human"]}]');
      INSERT INTO iam_principal_policies VALUES ('human','reader');
    `);
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    const client = {
      query: async (sql: string, params: readonly unknown[]) => db.query(sql, [...params]),
    };
    const store = createPostgresGatewayAuditStore(client, () => 100);
    await store.append({
      kind: 'attempt',
      requestId: 'trace-one',
      principalId: 'human',
      credentialId: 'PRIVATE-CREDENTIAL-ID',
      policyVersions: [],
      routeVersion: 'v1',
      modelAlias: 'chat',
      candidateId: 'candidate-one',
      outcome: 'failed',
      failureCategory: 'timeout',
      possiblyBilled: false,
    });
    await store.append({
      kind: 'models-listed',
      requestId: 'FOREIGN-REQUEST',
      principalId: 'foreign',
      credentialId: 'FOREIGN-CREDENTIAL',
      policyVersions: [],
      count: 0,
    });
    let ids = 0;
    server = createPostgresSsoCanonicalReviewServer({
      ...jwt.config,
      client,
      newRequestId: () => `detail-${++ids}`,
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const root = new Element();
    const paths: string[] = [];
    let complete: () => void = () => {};
    let pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    app = mountHistoryWorkspace(
      root,
      async (path, init) => {
        paths.push(path);
        try {
          return await fetch(origin + path, {
            ...init,
            headers: { ...init.headers, authorization: `Bearer ${token}` },
          });
        } finally {
          complete();
        }
      },
      download(),
    );
    await pending;
    click(root, 'Audit');
    await waitFor(() => nodes(root).some((node) => node.tag === 'details'));
    assert.equal(values(root).Outcome, 'failed');
    assert.equal(values(root)['Possibly billed'], 'false');
    assert.equal(values(root)['Failure category'], 'timeout');
    assert.doesNotMatch(text(root), /FOREIGN-REQUEST|PRIVATE-CREDENTIAL-ID/);
    assert.equal(paths.length, 2);
    const events = await db.query<{ outcome: string }>(
      'SELECT outcome FROM sso_audit_history_access_events',
    );
    assert.deepEqual(
      events.rows.map((r) => r.outcome),
      ['ready'],
    );
    await db.exec("UPDATE iam_policies SET statements='[]' WHERE policy_id='reader'");
    pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    click(root, 'Apply filters');
    await pending;
    await waitFor(() => text(root).includes('Access denied'));
    assert.match(text(root), /Access denied/);
    assert.equal(
      nodes(root).some((n) => n.tag === 'details'),
      false,
    );
    const deniedEvents = await db.query<{ outcome: string }>(
      'SELECT outcome FROM sso_audit_history_access_events ORDER BY event_id',
    );
    assert.deepEqual(
      deniedEvents.rows.map((r) => r.outcome),
      ['ready', 'forbidden'],
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
