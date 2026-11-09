import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import * as concrete from '../src/gateway/postgres-sso-audit-history-http.ts';
import { renderAuditEventDetails } from '../src/management/audit-event-details.ts';
import { mountManagementAudit } from '../src/management/sso-audit-app.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';
import { TokenElement } from './token-management-dom-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
async function fixture() {
  const db = new PGlite();
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
  await db.exec(
    await readFile(
      new URL('../contracts/sso-audit-history-access-schema.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec(`
    INSERT INTO iam_principals VALUES ('human','human',true),('other','human',true);
    INSERT INTO iam_policies VALUES ('audit','v1','[{"effect":"Allow","actions":["audit:Read"],"resources":["principal:human"]}]');
    INSERT INTO iam_principal_policies VALUES ('human','audit');
  `);
  await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
    jwt.issuer,
    jwt.subject,
    'human',
  ]);
  const client = { query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]) };
  for (const principalId of ['human', 'human', 'other'])
    await createPostgresGatewayAuditStore(client, () => 100).append({
      kind: 'request-denied',
      reason: 'invalid-request',
      requestId: `event-${principalId}`,
      principalId,
      credentialId: 'proxy-private',
      policyVersions: [{ id: 'read-policy', version: 'v7' }],
      modelAlias: 'chat',
    });
  let hook: (() => Promise<void>) | undefined;
  const ports = {
    ...jwt.config,
    client,
    auditClient: {
      query: async (sql: string, params: readonly unknown[]) => {
        await hook?.();
        return client.query(sql, params);
      },
    },
    newRequestId: () => 'sql-audit-http',
  };
  const server = concrete.createPostgresSsoAuditHistoryServer(ports);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    db,
    origin: `http://127.0.0.1:${address.port}`,
    ports,
    hold: (fn: () => Promise<void>) => {
      hook = fn;
    },
    get: (query = '', auth = `Bearer ${token}`) =>
      fetch(`http://127.0.0.1:${address.port}/management/v1/audit${query}`, {
        headers: { authorization: auth },
      }),
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      await db.close();
    },
  };
}

const grant = { principalId: 'human', expiresAt: 1000 };
const event = {
  eventId: '9',
  occurredAt: 100,
  kind: 'models-listed',
  requestId: 'inspect-request',
  principalId: 'human',
  credentialId: 'credential-reference',
  policyVersions: [{ id: 'catalog-policy', version: 'v3' }],
  details: { count: 0, prompt: 'never-display-prompt' },
  access_token: 'never-display-token',
};
const reply = () =>
  Response.json(
    { object: 'list', data: [event], next_cursor: null },
    { headers: { 'x-audit-has-more': 'false' } },
  );

test('mounted audit rows disclose event and evaluated policy evidence without raw extras', async () => {
  const root = new TokenElement();
  let calls = 0;
  const app = mountManagementAudit(root, { now: () => 100, schedule: () => () => {} });
  await app.authorize({
    ...grant,
    request: async () => {
      calls++;
      return reply();
    },
  });
  const disclosure = root.all().find((n) => n.tag === 'details');
  assert.ok(disclosure, 'audit event disclosure');
  assert.equal(disclosure.children[0]?.tag, 'summary');
  for (const text of [
    'Event ID',
    '9',
    'Credential reference',
    'credential-reference',
    'catalog-policy',
    'v3',
    'inspect-request',
    'count',
    '0',
  ])
    assert.ok(disclosure.text().includes(text), text);
  assert.doesNotMatch(root.text(), /never-display/);
  assert.ok(
    root
      .all()
      .filter((n) => n.tag === 'th')
      .every((n) => n.attrs.scope === 'col'),
  );
  assert.ok(root.all().some((n) => n.tag === 'caption' && n.text().includes('current page')));
  assert.equal(calls, 1, 'inspection requires no extra request');
  app.dispose();
  assert.equal(root.text(), '');
});

test('audit inspection is removed on expiry, denial and failed replacement', async () => {
  let now = 100;
  let expire = () => {};
  let status = 200;
  const root = new TokenElement();
  const app = mountManagementAudit(root, {
    now: () => now,
    schedule: (_delay, fn) => {
      expire = fn;
      return () => {};
    },
  });
  const request = async () => (status === 200 ? reply() : new Response(null, { status }));
  await app.authorize({ ...grant, request });
  assert.ok(root.text().includes('credential-reference'));
  now = 1000;
  expire();
  assert.doesNotMatch(root.text(), /credential-reference|catalog-policy|inspect-request/);
  now = 100;
  await app.authorize({ ...grant, request });
  status = 403;
  root.named('audit-filters').submit();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(root.text(), /Access denied/);
  assert.equal(root.all().filter((n) => n.tag === 'details').length, 0);
  status = 200;
  await app.authorize({ ...grant, request });
  status = 503;
  root.named('audit-filters').submit();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(root.text(), /Audit unavailable/);
  assert.doesNotMatch(root.text(), /credential-reference|catalog-policy|inspect-request/);
  app.dispose();
});

test('actual signed SSO SQL HTTP audit exposes only scoped credential and policy evidence in mounted details', async () => {
  const f = await fixture();
  const root = new TokenElement();
  const app = mountManagementAudit(root, { now: () => 100, schedule: () => () => {} });
  try {
    await app.authorize({
      ...grant,
      request: async (path) => f.get(path.slice('/management/v1/audit'.length)),
    });
    const disclosures = root.all().filter((n) => n.tag === 'details');
    assert.equal(disclosures.length, 2);
    for (const node of disclosures) {
      assert.match(node.text(), /proxy-private/);
      assert.match(node.text(), /read-policy/);
      assert.match(node.text(), /v7/);
    }
    assert.doesNotMatch(root.text(), /event-other/);
    await f.db.exec('DELETE FROM iam_principal_policies');
    root.named('audit-filters').submit();
    // A real SQL/HTTP denial can outlive one timer tick under CI load.
    // Keep checking the terminal state, never accept an unfinished loading view.
    const deadline = performance.now() + 10_000;
    while (!root.text().includes('Access denied.') && performance.now() < deadline) {
      assert.doesNotMatch(root.text(), /proxy-private|read-policy|event-human/);
      await delay(5);
    }
    assert.match(root.text(), /Access denied/);
    assert.doesNotMatch(root.text(), /proxy-private|read-policy|event-human/);
  } finally {
    app.dispose();
    await f.close();
  }
});

test('audit disclosure makes missing versions explicit and uses text rather than markup', () => {
  const root = new TokenElement();
  const node = renderAuditEventDetails(root.ownerDocument, {
    ...event,
    policyVersions: [],
    details: { reason: '<img src=x onerror=alert(1)>' },
  });
  assert.ok(node instanceof TokenElement);
  root.append(node);
  assert.match(root.text(), /No policy versions recorded/);
  assert.match(root.text(), /not a current permission decision/);
  assert.ok(
    root.all().some((n) => n.tag === 'dd' && n.textContent === '<img src=x onerror=alert(1)>'),
  );
  assert.equal(
    root.all().some((n) => ['img', 'script'].includes(n.tag)),
    false,
  );
});

test('current-page retry recovers a required-audit failure through real signed SSO SQL HTTP', async () => {
  const f = await fixture();
  const root = new TokenElement();
  const paths: string[] = [];
  const app = mountManagementAudit(root, { now: () => 100, schedule: () => () => {} });
  async function waitFor(text: RegExp) {
    for (let attempt = 0; attempt < 100 && !text.test(root.text()); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match(root.text(), text);
  }
  try {
    await app.authorize({
      ...grant,
      request: async (path) => {
        paths.push(path);
        return f.get(path.slice('/management/v1/audit'.length));
      },
    });
    root.named('requestId').value = 'event-human';
    root.named('audit-filters').submit();
    await waitFor(/Audit events loaded/);
    const submitted = paths.at(-1);
    f.hold(async () => {
      throw Error('private-audit-storage-fault');
    });
    root.button('Refresh current page').click();
    assert.doesNotMatch(root.text(), /proxy-private|read-policy/);
    await waitFor(/Audit unavailable/);
    assert.doesNotMatch(root.text(), /private-audit-storage-fault|proxy-private/);
    f.hold(async () => {});
    root.button('Retry current page').click();
    await waitFor(/Audit events loaded/);
    assert.equal(paths.at(-1), submitted);
    assert.equal(root.all().filter((node) => node.tag === 'details').length, 2);
    assert.match(root.text(), /read-policy/);
    await f.db.exec('DELETE FROM iam_principal_policies');
    root.button('Refresh current page').click();
    await waitFor(/Access denied/);
    assert.doesNotMatch(
      root.text(),
      /Retry current page|Refresh current page|proxy-private|read-policy/,
    );
  } finally {
    app.dispose();
    await f.close();
  }
});
