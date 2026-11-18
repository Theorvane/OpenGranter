import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoManagementGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import { createCurrentPrincipalClient } from '../src/management/current-principal-client.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
async function fixture(installAudit = true, shell = false) {
  const db = new PGlite();
  let auditHook = async () => {};
  let acknowledgement: { readonly rows: readonly unknown[] } | undefined;
  let calls = 0;
  let closes = 0;
  const client: PostgresConnection = {
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
    query: async (sql, params) => {
      calls++;
      if (sql.includes('INSERT INTO sso_current_principal_audit_events')) {
        await auditHook();
        if (acknowledgement) return acknowledgement;
      }
      return db.query(sql, [...params]);
    },
  };
  const runtime = await startPostgresSsoManagementGateway({
    ...jwt.config,
    host: '127.0.0.1',
    port: 0,
    openConnection: () => client,
    newRequestId: () => 'account-read',
    ...(shell ? { browserJavascript: '// public Account shell' } : {}),
  });
  if (installAudit)
    await db.exec(
      await readFile(
        new URL('../contracts/sql/current-principal-audit.sql', import.meta.url),
        'utf8',
      ),
    );
  await db.exec("INSERT INTO iam_principals VALUES ('account-human','human',true)");
  await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
    jwt.issuer,
    jwt.subject,
    'account-human',
  ]);
  const address = runtime.address;
  return {
    db,
    ack(value: { readonly rows: readonly unknown[] } | undefined) {
      acknowledgement = value;
    },
    get calls() {
      return calls;
    },
    hook(value: () => Promise<void>) {
      auditHook = value;
    },
    request(path = '/management/v1/me', authorization = `Bearer ${token}`, init: RequestInit = {}) {
      return fetch(`http://127.0.0.1:${address.port}${path}`, {
        headers: { authorization },
        ...init,
      });
    },
    async close() {
      await Promise.all([runtime.close(), runtime.close()]);
      assert.equal(closes, 1);
    },
  };
}

test('Account client consumes actual owned HTTP and fresh PostgreSQL identity/audit', async () => {
  const f = await fixture(true, true);
  try {
    const client = createCurrentPrincipalClient((path, init) =>
      f.request(path, `Bearer ${token}`, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers)),
          authorization: `Bearer ${token}`,
        },
      }),
    );
    const anonymous = createCurrentPrincipalClient((path, init) => f.request(path, '', init));
    const beforeAssets = f.calls;
    for (const path of ['/management', '/management/app.js', '/management/app.css']) {
      const response = await f.request(path, '');
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('set-cookie'), null);
      await response.arrayBuffer();
    }
    assert.equal(f.calls, beforeAssets);
    assert.deepEqual(await anonymous.read(), { state: 'unauthenticated' });
    assert.deepEqual(await client.read(), {
      state: 'ready',
      data: { id: 'account-human', kind: 'human' },
    });
    assert.equal(
      (await f.db.query('SELECT * FROM sso_current_principal_audit_events')).rows.length,
      2,
    );
    await f.db.exec('UPDATE iam_principals SET active=false');
    assert.deepEqual(await client.read(), { state: 'unauthenticated' });
    await f.db.exec('UPDATE iam_principals SET active=true');
    await f.db.exec('DELETE FROM iam_sso_identity_bindings');
    assert.deepEqual(await client.read(), { state: 'unauthenticated' });
    await f.db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'account-human',
    ]);
    assert.deepEqual(await client.read(), {
      state: 'ready',
      data: { id: 'account-human', kind: 'human' },
    });
    assert.deepEqual(
      (
        await f.db.query(
          'SELECT outcome, principal_id FROM sso_current_principal_audit_events ORDER BY event_id',
        )
      ).rows,
      [
        { outcome: 'unauthenticated', principal_id: null },
        { outcome: 'ready', principal_id: 'account-human' },
        { outcome: 'unauthenticated', principal_id: null },
        { outcome: 'unauthenticated', principal_id: null },
        { outcome: 'ready', principal_id: 'account-human' },
      ],
    );
    await f.db.exec('DROP TABLE sso_current_principal_audit_events');
    assert.deepEqual(await client.read(), { state: 'unavailable' });
  } finally {
    await f.close();
  }
});
