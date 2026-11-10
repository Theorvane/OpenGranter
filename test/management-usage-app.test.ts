import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountSsoUsageReview } from '../src/management/usage-app.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

class Element implements CatalogElement {
  readonly tag: string;
  textContent: string | null = null;
  value = '';
  attributes: Record<string, string> = {};
  children: Element[] = [];
  listeners: Record<string, () => void> = {};
  focused = false;
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
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
  addEventListener(type: string, listener: () => void) {
    this.listeners[type] = listener;
  }
  focus() {
    this.focused = true;
  }
}
function nodes(root: Element): Element[] {
  return [root, ...root.children.flatMap(nodes)];
}
function text(root: Element): string {
  return nodes(root)
    .map((node) => node.textContent ?? '')
    .join(' ');
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const row = buildUsageRecord({
  principalId: 'human',
  credentialId: 'old',
  policyVersions: [],
  requestId: 'request',
  attemptId: 'attempt',
  modelAlias: '<img src=x onerror=alert(1)>',
  routeKind: 'managed',
  upstreamModelId: 'up',
  selectedCandidateId: 'candidate',
  occurredAt: 10,
  latencyMs: 1,
  outcome: 'succeeded',
  possiblyBilled: true,
  possibleDuplicate: true,
  estimatedCost: { amountDecimal: '0.000000000000000001', currency: 'USD', priceVersion: 'v1' },
});
const page = (data = [row], cursor: string | null = null) =>
  Response.json({ object: 'list', data, has_more: cursor !== null, next_cursor: cursor });
const click = (root: Element, name: string) => {
  const button = nodes(root).find((n) => n.tag === 'button' && n.textContent === name);
  assert.ok(button, name);
  button.listeners.click?.();
};

test('locked initial screen and disposal have no read authority', async () => {
  const root = new Element();
  const app = mountSsoUsageReview(root);
  assert.match(text(root), /Sign-in required/);
  await app.search();
  assert.match(text(root), /Sign-in required/);
  app.dispose();
  assert.equal(root.children.length, 0);
});
test('mounted page renders exact money, unknown counts, markers and hostile values as text', async () => {
  const root = new Element();
  const app = mountSsoUsageReview(root);
  app.authorize(async () => page());
  await app.search();
  const content = text(root);
  assert.match(content, /Estimated: 0.000000000000000001 USD/);
  assert.match(content, /Reported: Unknown/);
  assert.match(content, /Tokens: Unknown/);
  assert.match(content, /Possible duplicate/);
  assert.match(content, /Possibly billed/);
  assert.ok(content.includes(row.modelAlias));
  assert.ok(!nodes(root).some((n) => n.tag === 'img'));
  assert.ok(nodes(root).some((n) => n.tag === 'table'));
  app.dispose();
});
test('native filter search and next use copied filters and exact server cursor', async () => {
  const root = new Element();
  const app = mountSsoUsageReview(root);
  const paths: string[] = [];
  const cursor = Buffer.from(JSON.stringify([10, 'attempt'])).toString('base64url');
  app.authorize(async (path) => {
    paths.push(path);
    return page(
      [
        {
          ...row,
          modelAlias: 'chat',
          occurredAt: paths.length === 1 ? 10 : 9,
          attemptId: paths.length === 1 ? 'attempt' : 'older',
        },
      ],
      paths.length === 1 ? cursor : null,
    );
  });
  const inputs = nodes(root).filter((n) => n.tag === 'input');
  assert.equal(inputs.length, 5);
  assert.ok(inputs.every((n) => Boolean(n.attributes['aria-label'])));
  assert.ok(inputs[1]);
  assert.ok(inputs[4]);
  inputs[1].value = 'chat';
  inputs[4].value = '1';
  click(root, 'Search usage');
  assert.match(text(root), /Loading usage/);
  await tick();
  click(root, 'Next page');
  await tick();
  assert.ok(paths[0]?.includes('model=chat'));
  assert.ok(paths[1]?.includes('model=chat'));
  assert.ok(paths[1]?.includes(`cursor=${cursor}`));
  assert.ok(!nodes(root).some((n) => n.textContent === 'Next page'));
  assert.match(text(root), /older/);
  assert.ok(!text(root).includes('Usage unavailable'));
  app.dispose();
});
test('clear and identity change remove old DOM and suppress pending results', async () => {
  for (const mode of ['clear', 'identity', 'dispose']) {
    const root = new Element();
    const app = mountSsoUsageReview(root);
    app.authorize(async () => page());
    await app.search();
    assert.ok(text(root).includes(row.modelAlias));
    let finish: (r: Response) => void = () => {};
    app.authorize(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    assert.ok(!text(root).includes(row.modelAlias));
    const pending = app.search();
    assert.match(text(root), /Loading usage/);
    if (mode === 'clear') app.clear('expired');
    if (mode === 'identity') app.authorize(async () => page([]));
    if (mode === 'dispose') app.dispose();
    finish(page());
    await pending;
    assert.ok(!text(root).includes(row.modelAlias));
    if (mode === 'clear') assert.match(text(root), /Session expired/);
    if (mode === 'identity') assert.match(text(root), /Search usage/);
    if (mode === 'dispose') assert.equal(root.children.length, 0);
    app.dispose();
  }
});
test('empty denial unauthenticated unavailable and invalid filters never leak body', async () => {
  for (const [response, expected] of [
    [page([]), /No usage records/],
    [new Response('secret', { status: 403 }), /Access denied/],
    [new Response('secret', { status: 401 }), /Sign-in required/],
    [new Response('secret', { status: 500 }), /Usage unavailable/],
  ] as const) {
    const root = new Element();
    const app = mountSsoUsageReview(root);
    app.authorize(async () => response);
    await app.search();
    assert.match(text(root), expected);
    assert.ok(!text(root).includes('secret'));
    app.dispose();
  }
  const root = new Element();
  const app = mountSsoUsageReview(root);
  let calls = 0;
  app.authorize(async () => {
    calls++;
    return page();
  });
  const from = nodes(root).find((n) => n.attributes['aria-label'] === 'From (epoch ms)');
  assert.ok(from);
  from.value = 'invalid';
  click(root, 'Search usage');
  await tick();
  assert.match(text(root), /Invalid usage filters/);
  assert.equal(calls, 0);
  app.dispose();
});

test('mounted usage composes signed SSO, migrated SQL, scoped reads, audit failure and fresh revocation', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { createPostgresSsoUsageHistory } = await import(
    '../src/gateway/postgres-sso-usage-history.ts'
  );
  const { createSsoUsageHistoryHandler } = await import('../src/gateway/sso-usage-history-http.ts');
  const { loadPostgresMigrationSources } = await import(
    '../src/storage/postgres-migration-sources.ts'
  );
  const { createPostgresUsageLedger } = await import('../src/usage/postgres-ledger.ts');
  const { createSsoAccessTokenFixture } = await import('./sso-access-token-fixture.ts');
  const db = new PGlite();
  const root = new Element();
  const app = mountSsoUsageReview(root);
  try {
    for (const migration of await loadPostgresMigrationSources()) await db.exec(migration.sql);
    await db.query('INSERT INTO iam_principals VALUES ($1,$2,$3)', ['human', 'human', true]);
    await db.query('INSERT INTO iam_policies VALUES ($1,$2,$3)', [
      'reader',
      'v1',
      JSON.stringify([
        { effect: 'Allow', actions: ['usage:ReadSelf'], resources: ['principal:human'] },
      ]),
    ]);
    await db.query('INSERT INTO iam_principal_policies VALUES ($1,$2)', ['human', 'reader']);
    const jwt = await createSsoAccessTokenFixture();
    const token = await jwt.token();
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    const client = {
      query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]),
    };
    const write = createPostgresUsageLedger(client);
    await write({ ...row, modelAlias: 'scoped-model' });
    await write({
      ...row,
      principalId: 'other',
      modelAlias: 'foreign-model',
      attemptId: 'foreign',
    });
    let failAudit = false;
    let audits = 0;
    const history = createPostgresSsoUsageHistory({
      ...jwt.config,
      client,
      writeAudit: async () => {
        if (failAudit) throw Error('private audit failure');
        audits++;
      },
    });
    const handler = createSsoUsageHistoryHandler({ history, newRequestId: () => 'screen-read' });
    app.authorize((path, init) =>
      handler(
        new Request(`https://management.test${path}`, {
          ...init,
          headers: { authorization: `Bearer ${token}` },
        }),
      ),
    );
    await app.search();
    assert.match(text(root), /scoped-model/);
    assert.ok(!text(root).includes('foreign-model'));
    assert.equal(audits, 1);
    failAudit = true;
    await app.search();
    assert.match(text(root), /Usage unavailable/);
    assert.ok(!text(root).includes('scoped-model'));
    assert.ok(!text(root).includes('private audit'));
    failAudit = false;
    await app.search();
    assert.match(text(root), /scoped-model/);
    await db.query('DELETE FROM iam_principal_policies WHERE principal_id=$1', ['human']);
    await app.search();
    assert.match(text(root), /Access denied/);
    assert.ok(!text(root).includes('scoped-model'));
  } finally {
    app.dispose();
    await db.close();
  }
});
