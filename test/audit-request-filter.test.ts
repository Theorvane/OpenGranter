import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import * as concrete from '../src/gateway/postgres-sso-audit-history-http.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

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

import { parseAuditHistoryQuery, projectAuditHistoryPage } from '../src/audit/history-http.ts';
import { createPostgresAuditHistoryReader } from '../src/audit/postgres-audit-history.ts';

test('audit request query is strict, exact and compatible with existing filters', () => {
  const parsed = parseAuditHistoryQuery(
    new URL('http://local/?request_id=req%2B1&model=chat&from_ms=100&to_ms=101'),
  );
  assert.equal(parsed.requestId, 'req+1');
  assert.equal(parsed.modelAlias, 'chat');
  for (const query of [
    'request_id=',
    'request_id=a&request_id=b',
    'request_id=req+bad',
    'request_id=%00',
    'request_id=%C3%A9',
    `request_id=${'a'.repeat(257)}`,
  ]) {
    assert.throws(() => parseAuditHistoryQuery(new URL(`http://local/?${query}`)));
  }
});

test('signed SSO SQL HTTP correlates JSON and CSV with scoped keyset continuation', async () => {
  const f = await fixture();
  try {
    const append = createPostgresGatewayAuditStore(f.ports.client, () => 100).append;
    for (const [requestId, principalId] of [
      ['target+1', 'human'],
      ['Target+1', 'human'],
      ['target+1', 'other'],
      ['target+1', 'human'],
      ['other-request', 'human'],
    ] as const) {
      await append({
        kind: 'request-denied',
        reason: 'invalid-request',
        requestId,
        principalId,
        credentialId: 'proxy-private',
        policyVersions: [],
        modelAlias: 'chat',
      });
    }
    const filter = '?request_id=target%2B1&model=chat&from_ms=100&to_ms=101&limit=1';
    const first = await f.get(filter);
    assert.equal(first.status, 200);
    const page = (await first.json()) as {
      data: { eventId: string; requestId: string; principalId: string }[];
      next_cursor: string;
    };
    assert.equal(page.data.length, 1);
    assert.equal(page.data[0]?.requestId, 'target+1');
    assert.equal(page.data[0]?.principalId, 'human');
    assert.ok(page.next_cursor);
    const second = await f.get(`${filter}&cursor=${page.next_cursor}`);
    assert.equal(second.status, 200);
    const next = (await second.json()) as typeof page;
    assert.equal(next.data.length, 1);
    assert.notEqual(next.data[0]?.eventId, page.data[0]?.eventId);
    assert.equal(next.next_cursor, null);
    const csv = await f.get(`${filter}&format=csv`);
    assert.equal(csv.status, 200);
    assert.equal(csv.headers.get('x-audit-next-cursor'), page.next_cursor);
    const text = await csv.text();
    assert.match(text, /target\+1/);
    assert.doesNotMatch(text, /Target\+1|other-request|event-human|event-other/);
    const empty = await f.get('?request_id=missing');
    assert.equal(empty.status, 200);
    assert.deepEqual(((await empty.json()) as { data: unknown[] }).data, []);
    const denied = await f.get('?request_id=target%2B1&principal_id=other');
    assert.equal(denied.status, 403);
    await denied.text();
    const invalid = await f.get('?request_id=');
    assert.equal(invalid.status, 400);
    await invalid.text();
    const anonymous = await f.get('?request_id=', '');
    assert.equal(anonymous.status, 401);
    await anonymous.text();
    assert.deepEqual(
      (
        await f.db.query(
          'SELECT outcome,record_count FROM sso_audit_history_access_events ORDER BY event_id',
        )
      ).rows,
      [
        { outcome: 'ready', record_count: 1 },
        { outcome: 'ready', record_count: 1 },
        { outcome: 'ready', record_count: 1 },
        { outcome: 'ready', record_count: 0 },
        { outcome: 'forbidden', record_count: 0 },
        { outcome: 'invalid_query', record_count: 0 },
        { outcome: 'unauthenticated', record_count: 0 },
      ],
    );
    const stored = JSON.stringify(
      (await f.db.query('SELECT * FROM sso_audit_history_access_events')).rows,
    );
    assert.doesNotMatch(stored, /target\+1|proxy-private/);
  } finally {
    await f.close();
  }
});

test('SQL and HTTP projections reject off-request hidden lookahead and injected pages', async () => {
  const f = await fixture();
  try {
    const raw = (
      await f.db.query<Record<string, unknown>>(
        'SELECT event_id::text AS event_id,occurred_at_ms::text AS occurred_at_ms,kind,request_id,principal_id,credential_id,policy_versions,details FROM gateway_audit_events WHERE principal_id=$1 ORDER BY gateway_audit_events.event_id DESC',
        ['human'],
      )
    ).rows;
    // Make both IDs decimal strings, as selected by the real reader.
    const rows: Record<string, unknown>[] = raw.map((row) => ({
      ...row,
      event_id: String(row.event_id),
      occurred_at_ms: String(row.occurred_at_ms),
    }));
    rows[0] = { ...rows[0], request_id: 'target' };
    let captured: readonly unknown[] = [];
    const read = createPostgresAuditHistoryReader({
      query: async (sql, params) => {
        assert.match(sql, /request_id = \$7::text/);
        captured = params;
        return { rows };
      },
    });
    await assert.rejects(() => read({ principalId: 'human', limit: 1, requestId: 'target' }));
    assert.deepEqual(captured, ['human', null, 2, null, null, null, 'target']);
    // Invalid grammar is rejected before the SQL boundary.
    let calls = 0;
    const strict = createPostgresAuditHistoryReader({
      query: async () => {
        calls++;
        return { rows: [] };
      },
    });
    await assert.rejects(() => strict({ principalId: 'human', limit: 1, requestId: 'a OR true' }));
    assert.equal(calls, 0);
    const valid = await createPostgresAuditHistoryReader(f.ports.client)({
      principalId: 'human',
      limit: 10,
    });
    assert.throws(() =>
      projectAuditHistoryPage(valid, 'human', 10, null, { requestId: 'different' }),
    );
  } finally {
    await f.close();
  }
});
