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
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function click(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
}
function record(overrides: Partial<Parameters<typeof buildUsageRecord>[0]> = {}) {
  return buildUsageRecord({
    principalId: 'human',
    credentialId: 'PRIVATE-CREDENTIAL-ID',
    policyVersions: [],
    requestId: 'trace-one',
    attemptId: 'attempt-one',
    occurredAt: 100,
    modelAlias: 'alias',
    routeKind: 'managed',
    upstreamModelId: 'recorded-target',
    selectedCandidateId: 'candidate-one',
    actualInferenceProviderId: 'reported-provider',
    latencyMs: 0,
    outcome: 'failed',
    possiblyBilled: true,
    possibleDuplicate: true,
    providerUsage: { prompt_tokens: 0, completion_tokens: 2, total_tokens: 2 },
    ...overrides,
  });
}
function page(row: ReturnType<typeof record>) {
  return Response.json({ object: 'list', data: [row], has_more: false, next_cursor: null });
}
const download = () => ({ save: () => 'started' as const, dispose() {} });
function values(root: Element) {
  const list = nodes(root).find((n) => n.tag === 'details');
  assert.ok(list, 'usage attempt disclosure');
  const entries = nodes(list).filter((n) => n.tag === 'dt' || n.tag === 'dd');
  const result = new Map<string, string>();
  for (let i = 0; i < entries.length; i += 2) {
    result.set(entries[i]?.textContent ?? '', entries[i + 1]?.textContent ?? '');
  }
  return result;
}

test('history exposes per-attempt failure, recorded destination and zero token counts', async () => {
  const root = new Element();
  let reads = 0;
  const app = mountHistoryWorkspace(
    root,
    async () => {
      reads++;
      return page(record());
    },
    download(),
  );
  await tick();
  assert.equal(reads, 1, 'inspection uses existing scoped response, no new fetch');
  assert.deepEqual(Object.fromEntries(values(root)), {
    'Attempt ID': 'attempt-one',
    'Route kind': 'managed',
    'Recorded upstream target': 'recorded-target',
    'Selected candidate': 'candidate-one',
    'Reported inference provider': 'reported-provider',
    Outcome: 'failed',
    'Latency (ms)': '0',
    'Usage availability': 'reported',
    'Input tokens': '0',
    'Output tokens': '2',
    'Total tokens': '2',
  });
  assert.equal(nodes(root).find((n) => n.tag === 'summary')?.textContent, 'Inspect usage attempt');
  assert.doesNotMatch(text(root), /PRIVATE-CREDENTIAL-ID/);
  assert.match(text(root), /not proof of the actual model served/);
  app.dispose();
  assert.equal(root.children.length, 0);
});

for (const [name, providerUsage, availability, input, output, total] of [
  ['partial', { prompt_tokens: 7 }, 'partial', '7', 'Unknown', 'Unknown'],
  ['missing', undefined, 'missing', 'Unknown', 'Unknown', 'Unknown'],
  ['invalid', { prompt_tokens: -1 }, 'invalid', 'Unknown', 'Unknown', 'Unknown'],
] as const) {
  test(`history preserves ${name} token availability without fabricating zeros`, async () => {
    const root = new Element();
    const app = mountHistoryWorkspace(
      root,
      async () => page(record({ providerUsage })),
      download(),
    );
    await tick();
    const v = values(root);
    assert.equal(v.get('Usage availability'), availability);
    assert.equal(v.get('Input tokens'), input);
    assert.equal(v.get('Output tokens'), output);
    assert.equal(v.get('Total tokens'), total);
    app.dispose();
  });
}

test('delegated records preserve unknown provider and candidate, render markup literally', async () => {
  const root = new Element();
  const target = '<img src=x onerror=alert(1)>';
  const app = mountHistoryWorkspace(
    root,
    async () =>
      page(
        record({
          routeKind: 'delegated',
          selectedCandidateId: null,
          actualInferenceProviderId: undefined,
          upstreamModelId: target,
          outcome: 'succeeded',
        }),
      ),
    download(),
  );
  await tick();
  const v = values(root);
  assert.equal(v.get('Route kind'), 'delegated');
  assert.equal(v.get('Selected candidate'), 'Unknown');
  assert.equal(v.get('Reported inference provider'), 'Unknown');
  assert.equal(v.get('Recorded upstream target'), target);
  assert.equal(v.get('Outcome'), 'succeeded');
  assert.equal(
    nodes(root).some((n) => ['img', 'script'].includes(n.tag)),
    false,
  );
  app.dispose();
});

test('filter replacement and denial remove previous attempt disclosures', async () => {
  const root = new Element();
  let denied = false;
  let id = 'attempt-one';
  const app = mountHistoryWorkspace(
    root,
    async () => (denied ? new Response(null, { status: 403 }) : page(record({ attemptId: id }))),
    download(),
  );
  await tick();
  const previous = nodes(root).find((n) => n.tag === 'details');
  assert.ok(previous);
  id = 'attempt-two';
  click(root, 'Apply filters');
  assert.doesNotMatch(text(root), /attempt-one/);
  await tick();
  assert.equal(values(root).get('Attempt ID'), 'attempt-two');
  assert.equal(nodes(root).includes(previous), false);
  denied = true;
  click(root, 'Apply filters');
  await tick();
  assert.match(text(root), /Access denied/);
  assert.equal(
    nodes(root).some((n) => n.tag === 'details'),
    false,
  );
  app.dispose();
});

test('history inspects real local SSO HTTP and migrated embedded PostgreSQL ledger, then clears after policy denial', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { createPostgresSsoCanonicalReviewServer } = await import(
    '../src/gateway/postgres-sso-canonical-review-http.ts'
  );
  const { loadPostgresMigrationSources } = await import(
    '../src/storage/postgres-migration-sources.ts'
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
    await db.exec(`
      INSERT INTO iam_principals VALUES ('human','human',true),('foreign','human',true);
      INSERT INTO iam_policies VALUES ('reader','v1','[{"effect":"Allow","actions":["usage:ReadSelf"],"resources":["principal:human"]}]');
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
    const ledger = createPostgresUsageLedger(client);
    await ledger(record());
    await ledger(record({ principalId: 'foreign', attemptId: 'FOREIGN-ATTEMPT' }));
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
    await tick();
    assert.equal(values(root).get('Outcome'), 'failed');
    assert.equal(values(root).get('Input tokens'), '0');
    assert.equal(values(root).get('Attempt ID'), 'attempt-one');
    assert.doesNotMatch(text(root), /FOREIGN-ATTEMPT|PRIVATE-CREDENTIAL-ID/);
    assert.equal(paths.length, 1);
    const events = await db.query<{ outcome: string }>(
      'SELECT outcome FROM sso_usage_audit_events',
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
    await tick();
    assert.match(text(root), /Access denied/);
    assert.equal(
      nodes(root).some((n) => n.tag === 'details'),
      false,
    );
    const deniedEvents = await db.query<{ outcome: string }>(
      'SELECT outcome FROM sso_usage_audit_events ORDER BY event_id',
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
