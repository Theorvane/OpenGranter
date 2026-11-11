import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoWorkspaceGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
function fixture() {
  const db = new PGlite();
  let opens = 0;
  let closes = 0;
  let queries = 0;
  const connection: PostgresConnection = {
    query: (sql, params) => {
      queries++;
      return db.query(sql, [...params]);
    },
    transaction: (callback) =>
      db.transaction((tx) =>
        callback({
          exec: (sql) => tx.exec(sql),
          query: (sql, params) => tx.query(sql, [...params]),
        }),
      ),
    close: async () => {
      closes++;
      await db.close();
    },
  };
  return {
    db,
    counts: () => ({ opens, closes, queries }),
    ports: {
      ...jwt.config,
      host: '127.0.0.1',
      port: 0,
      browserJavascript: 'export const workspace = true;',
      newRequestId: () => 'workspace-runtime',
      openConnection: () => {
        opens++;
        return connection;
      },
    },
  };
}

test('workspace owned SQL audit serves isolated JSON/CSV only after durable audit', async () => {
  const f = fixture();
  const runtime = await startPostgresSsoWorkspaceGateway({
    ...f.ports,
    enableAuditHistoryReads: true,
  } as Parameters<typeof startPostgresSsoWorkspaceGateway>[0]);
  const origin = `http://127.0.0.1:${runtime.address.port}`;
  const token = await jwt.token();
  const get = (query = '', signed = true) =>
    fetch(`${origin}/management/v1/audit${query}`, {
      headers: signed ? { authorization: `Bearer ${token}` } : {},
    });
  try {
    const before = f.counts().queries;
    const shell = await fetch(`${origin}/management`);
    assert.equal(shell.status, 200);
    await shell.text();
    assert.equal(f.counts().queries, before);
    const missing = await get();
    assert.equal(missing.status, 503);
    assert.doesNotMatch(await missing.text(), /sso_audit_history_access_events/);
    await f.db.exec(
      await readFile(
        new URL('../contracts/sso-audit-history-access-schema.sql', import.meta.url),
        'utf8',
      ),
    );
    await f.db.exec(`INSERT INTO iam_principals VALUES ('human','human',true),('other','human',true);
      INSERT INTO iam_policies VALUES ('reader','v1','[{"effect":"Allow","actions":["audit:Read"],"resources":["principal:human"]}]');
      INSERT INTO iam_principal_policies VALUES ('human','reader');`);
    await f.db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    const { createPostgresGatewayAuditStore } = await import(
      '../src/audit/postgres-gateway-audit.ts'
    );
    const store = createPostgresGatewayAuditStore(
      { query: (sql, params) => f.db.query(sql, [...params]) },
      () => 100,
    );
    for (const principalId of ['human', 'other'])
      await store.append({
        kind: 'request-denied',
        reason: 'invalid-request',
        requestId: `event-${principalId}`,
        principalId,
        credentialId: 'private-proxy',
        policyVersions: [],
        modelAlias: 'chat',
      });
    const page = await get();
    assert.equal(page.status, 200);
    const body = (await page.json()) as { data: { principalId: string }[] };
    assert.deepEqual(
      body.data.map((r) => r.principalId),
      ['human'],
    );
    const csv = await get('?format=csv');
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type') ?? '', /text\/csv/);
    assert.doesNotMatch(await csv.text(), /event-other/);
    assert.deepEqual(
      (
        await f.db.query(
          'SELECT outcome,record_count FROM sso_audit_history_access_events ORDER BY event_id',
        )
      ).rows,
      [
        { outcome: 'ready', record_count: 1 },
        { outcome: 'ready', record_count: 1 },
      ],
    );
    for (const [query, signed, status] of [
      ['?principal_id=other', true, 403],
      ['', false, 401],
    ] as const) {
      const r = await get(query, signed);
      assert.equal(r.status, status);
      await r.text();
    }
    await f.db.exec('DELETE FROM iam_principal_policies');
    const denied = await get();
    assert.equal(denied.status, 403);
    await denied.text();
    await f.db.exec('DELETE FROM iam_sso_identity_bindings');
    const revoked = await get();
    assert.equal(revoked.status, 401);
    await revoked.text();
    const audit = JSON.stringify(
      (await f.db.query('SELECT * FROM sso_audit_history_access_events')).rows,
    );
    for (const secret of [token, jwt.issuer, jwt.subject, 'private-proxy'])
      assert.equal(audit.includes(secret), false);
    await f.db.exec('DROP TABLE sso_audit_history_access_events');
    const failed = await get();
    assert.equal(failed.status, 503);
    assert.doesNotMatch(await failed.text(), /human|sso_audit/);
  } finally {
    const closing = runtime.close();
    assert.equal(runtime.close(), closing);
    await closing;
  }
  assert.equal(f.counts().opens, 1);
  assert.equal(f.counts().closes, 1);
});

test('workspace rejects invalid SQL audit switches and callback conflicts before opening SQL', async () => {
  const f = fixture();
  try {
    for (const option of [undefined, null, 0, 1, 'true', {}, []]) {
      await assert.rejects(
        startPostgresSsoWorkspaceGateway({
          ...f.ports,
          enableAuditHistoryReads: option,
        } as unknown as Parameters<typeof startPostgresSsoWorkspaceGateway>[0]),
        { name: 'InvalidGatewayRuntimeInput' },
      );
    }
    await assert.rejects(
      startPostgresSsoWorkspaceGateway({
        ...f.ports,
        enableAuditHistoryReads: true,
        writeAuditHistoryAccess: async () => {},
      } as Parameters<typeof startPostgresSsoWorkspaceGateway>[0]),
      { name: 'InvalidGatewayRuntimeInput' },
    );
    assert.equal(f.counts().opens, 0);
  } finally {
    await f.db.close();
  }
});

test('workspace omitted false and inherited switches preserve audit 404', async () => {
  for (const mode of ['omitted', 'false', 'inherited']) {
    const f = fixture();
    const ports =
      mode === 'inherited'
        ? Object.assign(Object.create({ enableAuditHistoryReads: true }), f.ports)
        : { ...f.ports, ...(mode === 'false' ? { enableAuditHistoryReads: false } : {}) };
    const runtime = await startPostgresSsoWorkspaceGateway(ports);
    try {
      const before = f.counts().queries;
      const r = await fetch(`http://127.0.0.1:${runtime.address.port}/management/v1/audit`);
      assert.equal(r.status, 404);
      await r.text();
      assert.equal(f.counts().queries, before);
    } finally {
      await runtime.close();
    }
  }
});
