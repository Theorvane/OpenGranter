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

test('concrete SQL HTTP returns isolated JSON/CSV and persists reader attribution', async () => {
  const f = await fixture();
  try {
    const page = await f.get('?limit=1');
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    const body = (await page.json()) as { data: { principalId: string }[]; next_cursor: string };
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0]?.principalId, 'human');
    const next = await f.get(`?cursor=${body.next_cursor}`);
    assert.equal(next.status, 200);
    await next.text();
    const csv = await f.get('?format=csv');
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type') ?? '', /text\/csv/);
    assert.doesNotMatch(await csv.text(), /event-other/);
    const rows = (
      await f.db.query(
        'SELECT principal_id,target_principal_id,outcome,record_count FROM sso_audit_history_access_events ORDER BY event_id',
      )
    ).rows;
    assert.deepEqual(
      rows,
      [1, 1, 2].map((record_count) => ({
        principal_id: 'human',
        target_principal_id: 'human',
        outcome: 'ready',
        record_count,
      })),
    );
    const audit = JSON.stringify(
      (await f.db.query('SELECT * FROM sso_audit_history_access_events')).rows,
    );
    for (const secret of [token, jwt.issuer, jwt.subject, 'proxy-private'])
      assert.equal(audit.includes(secret), false);
  } finally {
    await f.close();
  }
});

test('concrete SQL HTTP audits anonymous, malformed, denial and fresh binding revocation', async () => {
  const f = await fixture();
  try {
    for (const [query, auth, status] of [
      ['?unknown=1', '', 401],
      ['?unknown=1', `Bearer ${token}`, 400],
      ['?principal_id=other', `Bearer ${token}`, 403],
    ] as const) {
      const r = await f.get(query, auth);
      assert.equal(r.status, status);
      await r.text();
    }
    await f.db.exec('DELETE FROM iam_principal_policies');
    const denied = await f.get();
    assert.equal(denied.status, 403);
    await denied.text();
    await f.db.exec('DELETE FROM iam_sso_identity_bindings');
    const revoked = await f.get();
    assert.equal(revoked.status, 401);
    await revoked.text();
    assert.deepEqual(
      (
        await f.db.query<{ outcome: string }>(
          'SELECT outcome FROM sso_audit_history_access_events ORDER BY event_id',
        )
      ).rows.map((r) => r.outcome),
      ['unauthenticated', 'invalid_query', 'forbidden', 'forbidden', 'unauthenticated'],
    );
  } finally {
    await f.close();
  }
});

test('concrete SQL HTTP withholds JSON/CSV and authentication errors without access audit table', async () => {
  const f = await fixture();
  try {
    await f.db.exec('DROP TABLE sso_audit_history_access_events');
    for (const [query, auth] of [
      ['', `Bearer ${token}`],
      ['?format=csv', `Bearer ${token}`],
      ['', ''],
    ]) {
      const r = await f.get(query, auth);
      assert.equal(r.status, 503);
      assert.match(await r.text(), /audit_unavailable/);
    }
  } finally {
    await f.close();
  }
});

test('concrete SQL HTTP waits for SQL acknowledgement before releasing export', async () => {
  const f = await fixture();
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>((r) => {
    entered = r;
  });
  const gate = new Promise<void>((r) => {
    release = r;
  });
  f.hold(async () => {
    entered();
    await gate;
  });
  try {
    let settled = false;
    const pending = f.get('?format=csv').then((r) => {
      settled = true;
      return r;
    });
    await Promise.race([
      waiting,
      pending.then(() => {
        throw Error('released before SQL');
      }),
    ]);
    assert.equal(settled, false);
    release();
    const response = await pending;
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(
      (await f.db.query('SELECT * FROM sso_audit_history_access_events')).rows.length,
      1,
    );
  } finally {
    release();
    await f.close();
  }
});

test('concrete factory rejects invalid explicit SQL ports before any query and ignores callback override', async () => {
  const f = await fixture();
  try {
    for (const key of ['client', 'auditClient', 'newRequestId'] as const)
      for (const value of [undefined, null, false, {}]) {
        assert.throws(
          () =>
            concrete.createPostgresSsoAuditHistoryHandler({
              ...f.ports,
              [key]: value,
            } as unknown as concrete.PostgresSsoAuditHistoryHttpPorts),
          { name: 'InvalidSsoAccessTokenConfiguration' },
        );
      }
    let calls = 0;
    const handler = concrete.createPostgresSsoAuditHistoryHandler({
      ...f.ports,
      writeAudit: async () => {
        calls++;
        throw Error('override');
      },
    } as concrete.PostgresSsoAuditHistoryHttpPorts);
    const response = await handler(
      new Request('https://management.invalid/management/v1/audit', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(calls, 0);
    const inherited = Object.create(f.ports) as concrete.PostgresSsoAuditHistoryHttpPorts;
    assert.throws(() => concrete.createPostgresSsoAuditHistoryHandler(inherited), {
      name: 'InvalidSsoAccessTokenConfiguration',
    });
  } finally {
    await f.close();
  }
});
