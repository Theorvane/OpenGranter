import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import * as concrete from '../src/gateway/postgres-sso-audit-history-http.ts';
import { mountManagementAudit } from '../src/management/sso-audit-app.ts';
import { createManagementSsoAuditClient } from '../src/management/sso-audit-client.ts';
import { createManagementSsoAuditWorkspace } from '../src/management/sso-audit-workspace.ts';
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
      policyVersions: [],
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

const event = {
  eventId: '9',
  occurredAt: 100,
  kind: 'models-listed',
  requestId: 'req+1',
  principalId: 'human',
  credentialId: 'private',
  policyVersions: [],
  details: { count: 0 },
};
const reply = (requestId = 'req+1') =>
  Response.json(
    { object: 'list', data: [{ ...event, requestId }], next_cursor: null },
    { headers: { 'x-audit-has-more': 'false' } },
  );

test('browser audit client captures and validates exact request filter before transport and response', async () => {
  const seen: string[] = [];
  let result = reply();
  const client = createManagementSsoAuditClient(async (path) => {
    seen.push(path);
    return result.clone();
  }, 'human');
  try {
    assert.equal((await client.list({ requestId: 'req+1' })).state, 'ready');
    assert.equal(
      new URL(seen.at(-1) ?? '', 'http://local').searchParams.get('request_id'),
      'req+1',
    );
    assert.match(seen[0] ?? '', /request_id=req%2B1/u);
    for (const requestId of ['', 'req bad', 'é', 'a'.repeat(257)]) {
      const before = seen.length;
      assert.equal((await client.list({ requestId })).state, 'invalid_query');
      assert.equal(seen.length, before);
    }
    result = reply('Req+1');
    assert.equal((await client.list({ requestId: 'req+1' })).state, 'unavailable');
  } finally {
    client.invalidate();
  }
});

test('mounted audit form submits exact request ID and clears it on authority failure', async () => {
  const root = new TokenElement();
  const seen: string[] = [];
  const app = mountManagementAudit(root, { now: () => 10, schedule: () => () => {} });
  try {
    await app.authorize({
      principalId: 'human',
      expiresAt: 100,
      request: async (path) => {
        seen.push(path);
        return reply();
      },
    });
    root.named('requestId').value = 'req+1';
    root.named('audit-filters').submit();
    for (let i = 0; i < 30 && !root.text().includes('Audit events loaded.'); i++)
      await new Promise((r) => setTimeout(r, 5));
    assert.match(root.text(), /Audit events loaded/u);
    assert.equal(
      new URL(seen.at(-1) ?? '', 'http://local').searchParams.get('request_id'),
      'req+1',
    );
    assert.equal(root.named('requestId').value, 'req+1');
    app.clear('denied');
    assert.doesNotMatch(root.text(), /req\+1/u);
    await app.authorize({ principalId: 'human', expiresAt: 100, request: async () => reply() });
    assert.equal(root.named('requestId').value, '');
  } finally {
    app.dispose();
  }
});

test('real signed SSO SQL and HTTP: browser workspace retains exact filter across paging and CSV', async () => {
  const f = await fixture();
  const paths: string[] = [];
  const workspace = createManagementSsoAuditWorkspace({ now: () => 10, schedule: () => () => {} });
  try {
    for (const [requestId, principalId] of [
      ['req+1', 'human'],
      ['Req+1', 'human'],
      ['req+1', 'other'],
      ['req+1', 'human'],
    ] as const)
      await createPostgresGatewayAuditStore(f.ports.client, () => 100).append({
        kind: 'request-denied',
        reason: 'invalid-request',
        requestId,
        principalId,
        credentialId: 'private',
        policyVersions: [],
        modelAlias: 'chat',
      });
    workspace.authorize({
      principalId: 'human',
      expiresAt: 100,
      request: (path, init) => {
        paths.push(path);
        return fetch(f.origin + path, { ...init, headers: { authorization: `Bearer ${token}` } });
      },
    });
    const filters = { requestId: 'req+1', model: 'chat', fromMs: 100, toMs: 101, limit: 1 };
    await workspace.load(filters);
    filters.requestId = 'changed';
    assert.equal(workspace.snapshot().state, 'ready');
    assert.equal(workspace.snapshot().canNext, true);
    assert.equal(workspace.snapshot().page?.events[0]?.requestId, 'req+1');
    await workspace.next();
    assert.equal(workspace.snapshot().state, 'ready');
    assert.equal(workspace.snapshot().page?.events[0]?.principalId, 'human');
    assert.equal(workspace.snapshot().page?.events[0]?.requestId, 'req+1');
    await workspace.exportCsv();
    assert.match(workspace.snapshot().csv?.csv ?? '', /req\+1/u);
    assert.doesNotMatch(workspace.snapshot().csv?.csv ?? '', /Req\+1|other/u);
    await workspace.previous();
    for (const path of paths)
      assert.equal(new URL(path, 'http://local').searchParams.get('request_id'), 'req+1');
    await workspace.load({ requestId: 'absent' });
    assert.equal(workspace.snapshot().state, 'empty');
    await workspace.load({ principalId: 'other', requestId: 'req+1' });
    assert.equal(workspace.snapshot().state, 'denied');
    assert.equal(workspace.snapshot().page, undefined);
    assert.deepEqual(workspace.snapshot().filters, {});
    const rows = (
      await f.db.query<{ outcome: string; record_count: number }>(
        'SELECT outcome,record_count FROM sso_audit_history_access_events ORDER BY event_id',
      )
    ).rows;
    assert.deepEqual(
      rows.map((r) => r.outcome),
      ['ready', 'ready', 'ready', 'ready', 'ready', 'forbidden'],
    );
  } finally {
    workspace.dispose();
    await f.close();
  }
});
