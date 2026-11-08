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

test('explicit workspace runtime joins public shell, audited Account and scoped APIs', async () => {
  const f = fixture();
  const runtime = await startPostgresSsoWorkspaceGateway(f.ports);
  const origin = `http://127.0.0.1:${runtime.address.port}`;
  const token = await jwt.token();
  const get = (path: string, signed = true) =>
    fetch(origin + path, {
      headers: signed ? { authorization: `Bearer ${token}` } : {},
    });
  try {
    const before = f.counts().queries;
    for (const path of ['/management', '/management/app.js']) {
      const response = await get(path, false);
      assert.equal(response.status, 200);
      await response.text();
    }
    assert.equal(f.counts().queries, before);
    const tables = await f.db.query(
      "SELECT tablename FROM pg_tables WHERE tablename IN ('sso_current_principal_audit_events','sso_usage_audit_events')",
    );
    assert.deepEqual(tables.rows, []);
    const unavailable = await get('/management/v1/me');
    assert.equal(unavailable.status, 503);
    assert.match(await unavailable.text(), /audit_unavailable/);
    // Disposable test DB only. Candidate schemas are never runtime migrations.
    for (const name of ['sql/current-principal-audit', 'sso-usage-audit-schema']) {
      await f.db.exec(await readFile(new URL(`../contracts/${name}.sql`, import.meta.url), 'utf8'));
    }
    const anonymous = await get('/management/v1/me', false);
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.headers.get('cache-control'), 'no-store');
    await anonymous.text();
    await f.db.exec("INSERT INTO iam_principals VALUES ('human-admin','human',true)");
    await f.db.query(
      'INSERT INTO iam_sso_identity_bindings (issuer,subject,principal_id) VALUES ($1,$2,$3)',
      [jwt.issuer, jwt.subject, 'human-admin'],
    );
    const me = await get('/management/v1/me');
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { principalId: 'human-admin' });
    assert.deepEqual(
      (
        await f.db.query(
          'SELECT outcome,principal_id FROM sso_current_principal_audit_events ORDER BY event_id',
        )
      ).rows,
      [
        { outcome: 'unauthenticated', principal_id: null },
        { outcome: 'ready', principal_id: 'human-admin' },
      ],
    );
    const models = await get('/management/v1/models');
    assert.equal(models.status, 200);
    assert.deepEqual(await models.json(), { object: 'list', data: [] });
    const deniedUsage = await get('/management/v1/usage');
    assert.equal(deniedUsage.status, 403);
    await deniedUsage.text();
    await f.db.query('INSERT INTO iam_policies VALUES ($1,$2,$3)', [
      'usage',
      'v1',
      JSON.stringify([
        { effect: 'Allow', actions: ['usage:ReadSelf'], resources: ['principal:human-admin'] },
      ]),
    ]);
    await f.db.exec("INSERT INTO iam_principal_policies VALUES ('human-admin','usage')");
    const usage = await get('/management/v1/usage');
    assert.equal(usage.status, 200);
    const page = (await usage.json()) as { data: unknown[] };
    assert.deepEqual(page.data, []);
    const mutation = await fetch(`${origin}/management/v1/proxy-tokens`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ principalId: 'human-admin', expiresAt: jwt.config.now() + 1000 }),
    });
    assert.equal(mutation.status, 403);
    await mutation.text();
    await f.db.exec('DELETE FROM iam_sso_identity_bindings');
    const revoked = await get('/management/v1/me');
    assert.equal(revoked.status, 401);
    await revoked.text();
    const audit = JSON.stringify(
      (await f.db.query('SELECT * FROM sso_current_principal_audit_events')).rows,
    );
    for (const secret of [token, jwt.issuer, jwt.subject])
      assert.equal(audit.includes(secret), false);
    await f.db.exec('DROP TABLE sso_current_principal_audit_events');
    const failed = await get('/management/v1/me');
    assert.equal(failed.status, 503);
    assert.doesNotMatch(await failed.text(), /human-admin|sso_current_principal/);
  } finally {
    const closing = runtime.close();
    assert.equal(runtime.close(), closing);
    await closing;
  }
  assert.equal(f.counts().opens, 1);
  assert.equal(f.counts().closes, 1);
});

test('workspace runtime rejects absent public artifact before connection ownership', async () => {
  const f = fixture();
  for (const browserJavascript of ['', undefined, null]) {
    await assert.rejects(
      startPostgresSsoWorkspaceGateway({ ...f.ports, browserJavascript } as unknown as Parameters<
        typeof startPostgresSsoWorkspaceGateway
      >[0]),
      { name: 'InvalidGatewayRuntimeInput' },
    );
  }
  assert.equal(f.counts().opens, 0);
  await f.db.close();
});
