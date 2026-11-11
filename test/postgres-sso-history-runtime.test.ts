import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoManagementGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

for (const enabled of [false, true]) {
  test(`owned history listener is explicitly gated: ${enabled}`, async () => {
    const jwt = await createSsoAccessTokenFixture();
    const db = new PGlite();
    let closes = 0;
    let sequence = 0;
    let brokenAudit = false;
    const connection: PostgresConnection = {
      query: (sql, params) => {
        if (brokenAudit && /INSERT INTO sso_(usage_audit|audit_history_access)_events/u.test(sql))
          throw new Error('private insert failure');
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
    const runtime = await startPostgresSsoManagementGateway({
      ...jwt.config,
      host: '127.0.0.1',
      port: 0,
      enableHistoryReads: enabled,
      browserJavascript: 'export {};',
      newRequestId: () => `history-runtime-${++sequence}`,
      openConnection: () => connection,
    });
    const base = `http://127.0.0.1:${runtime.address.port}`;
    const token = await jwt.token();
    async function read(path: string, status: number, authenticated = true) {
      const response = await fetch(`${base}${path}`, {
        headers: authenticated ? { authorization: `Bearer ${token}` } : {},
      });
      assert.equal(response.status, status);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const text = await response.text();
      assert.ok(!text.includes(token));
      assert.ok(!text.includes('private insert failure'));
      return { response, text };
    }
    try {
      await db.exec(`
        INSERT INTO iam_principals VALUES ('human', 'human', true), ('other', 'human', true);
        INSERT INTO iam_policies VALUES ('allow', 'v1',
          '[{"effect":"Allow","actions":["usage:ReadSelf","audit:Read"],"resources":["principal:human"]}]');
        INSERT INTO iam_principal_policies VALUES ('human', 'allow');
      `);
      await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
        jwt.issuer,
        jwt.subject,
        'human',
      ]);
      for (const kind of ['usage', 'audit']) {
        const path = `/management/v1/${kind}`;
        if (!enabled) {
          await read(path, 404);
          continue;
        }
        const page = await read(path, 200);
        assert.deepEqual(JSON.parse(page.text), {
          object: 'list',
          data: [],
          has_more: false,
          next_cursor: null,
        });
        const csv = await read(`${path}?format=csv`, 200);
        assert.match(csv.response.headers.get('content-type') ?? '', /^text\/csv/u);
        assert.ok(csv.text.length > 0);
        await read(`${path}?principal_id=other`, 403);
        await read(`${path}?unexpected=1`, 400);
        await read(path, 401, false);
        const table =
          kind === 'usage' ? 'sso_usage_audit_events' : 'sso_audit_history_access_events';
        const events = await db.query<{ outcome: string; principal_id: string | null }>(
          `SELECT outcome, principal_id FROM ${table} ORDER BY event_id`,
        );
        assert.deepEqual(
          events.rows.map((row) => row.outcome),
          ['ready', 'ready', 'forbidden', 'invalid_query', 'unauthenticated'],
        );
        assert.deepEqual(
          events.rows.map((row) => row.principal_id),
          ['human', 'human', 'human', 'human', null],
        );
        brokenAudit = true;
        const unavailable = await read(path, 503);
        assert.equal(JSON.parse(unavailable.text).error.code, 'audit_unavailable');
        brokenAudit = false;
      }
      if (enabled) {
        await db.exec("UPDATE iam_principals SET active=false WHERE principal_id='human'");
        await read('/management/v1/usage', 401);
        await read('/management/v1/audit', 401);
      }
      await read('/management/v1/audit/extra', 404);
      await read('/management/v1/usage/extra', 404);
    } finally {
      await runtime.close();
    }
    assert.equal(closes, 1);
  });
}

test('history switch rejects invalid trusted configuration before opening the database', async () => {
  const jwt = await createSsoAccessTokenFixture();
  let opens = 0;
  for (const value of [null, 0, 1, 'true', {}, []]) {
    await assert.rejects(
      startPostgresSsoManagementGateway({
        ...jwt.config,
        host: '127.0.0.1',
        port: 0,
        enableHistoryReads: value as boolean,
        newRequestId: () => 'invalid-switch',
        openConnection: () => {
          opens++;
          throw new Error('must not open');
        },
      }),
      { name: 'InvalidGatewayRuntimeInput' },
    );
  }
  assert.equal(opens, 0);
});
