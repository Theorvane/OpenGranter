import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoManagementGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
function fixture() {
  const db = new PGlite();
  let opens = 0;
  let closes = 0;
  let auditGate = async () => {};
  const client: PostgresConnection = {
    query: async (sql, params) => {
      if (sql.includes('INSERT INTO sso_audit_history_access_events')) await auditGate();
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
    client,
    gate: (fn: () => Promise<void>) => {
      auditGate = fn;
    },
    counts: () => ({ opens, closes }),
    ports: {
      ...jwt.config,
      host: '127.0.0.1',
      port: 0,
      newRequestId: () => 'owned-review',
      openConnection: () => {
        opens++;
        return client;
      },
    },
  };
}
async function seed(db: PGlite) {
  await db.exec(`
    INSERT INTO iam_principals VALUES ('human','human',true);
    INSERT INTO iam_policies VALUES ('reader','v1','[{"effect":"Allow","actions":["llm:InvokeModel","llm:UseProvider"],"resources":["model:*","provider:openai"]},{"effect":"Allow","actions":["usage:ReadSelf","audit:Read"],"resources":["principal:human"]}]');
    INSERT INTO iam_principal_policies VALUES ('human','reader');
    INSERT INTO catalog_models (alias,created_at_seconds,enabled) VALUES ('chat',42,true);
    INSERT INTO catalog_routes (route_id,alias,kind,version,credential_ref,candidates) VALUES ('direct','chat','managed','v1',NULL,'[{"id":"one","kind":"managed","providerId":"openai","upstreamModelId":"private-upstream"}]');
    UPDATE catalog_models SET active_route_id='direct' WHERE alias='chat';
  `);
  await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
    jwt.issuer,
    jwt.subject,
    'human',
  ]);
}
async function read(response: Response, status: number) {
  const body = await response.text();
  assert.equal(response.status, status, body);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(!body.includes(token));
  assert.doesNotMatch(body, /private-upstream|SELECT|INSERT/u);
  return body;
}

for (const resource of ['usage', 'audit']) {
  for (const browserJavascript of [undefined, 'export {};']) {
    test(`management listener integrates ${resource}; shell=${browserJavascript !== undefined}`, async () => {
      const f = fixture();
      const runtime = await startPostgresSsoManagementGateway({
        ...f.ports,
        ...(browserJavascript === undefined ? {} : { browserJavascript }),
      });
      const base = `http://127.0.0.1:${runtime.address.port}`;
      const path = `/management/v1/${resource}`;
      const get = (suffix = '') =>
        fetch(base + path + suffix, {
          headers: { authorization: `Bearer ${token}` },
        });
      try {
        await seed(f.db);
        const page = JSON.parse(await read(await get(), 200));
        assert.deepEqual(page.data, []);
        const csv = await get('?format=csv');
        assert.match(csv.headers.get('content-type') ?? '', /^text\/csv/u);
        await read(csv, 200);
        const table =
          resource === 'usage' ? 'sso_usage_audit_events' : 'sso_audit_history_access_events';
        const events = await f.db.query<{ principal_id: string; outcome: string }>(
          `SELECT principal_id, outcome FROM ${table}`,
        );
        assert.equal(events.rows.length, 2);
        for (const row of events.rows) {
          assert.equal(row.principal_id, 'human');
          assert.equal(row.outcome, 'ready');
        }
        await read(await fetch(base + path), 401);
        await read(await fetch(base + path, { headers: { cookie: 'session=not-authority' } }), 401);
        await read(
          await fetch(base + path, {
            headers: { authorization: 'Bearer invalid-proxy-credential' },
          }),
          401,
        );
        await read(await get('?format=unsupported'), 400);
        await read(await fetch(base + path, { method: 'POST' }), 400);
        for (const suffix of ['/', '-extra', '/detail']) await read(await get(suffix), 404);
        await read(await fetch(`${base}/management`), browserJavascript === undefined ? 404 : 200);
        await read(
          await fetch(`${base}/management/v1/models`, {
            headers: { authorization: `Bearer ${token}` },
          }),
          200,
        );
        await read(
          await fetch(`${base}/management/v1/proxy-tokens`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          }),
          401,
        );
        await f.db.exec(
          `UPDATE iam_policies SET version='v2', statements='[{"effect":"Deny","actions":["usage:ReadSelf","audit:Read"],"resources":["principal:human"]}]' WHERE policy_id='reader'`,
        );
        await read(await get(), 403);
        await f.db.exec('DELETE FROM iam_sso_identity_bindings');
        await read(await get(), 401);
        await f.db.exec(`DROP TABLE ${table}`);
        const unavailable = JSON.parse(await read(await get(), 503));
        assert.equal(unavailable.error.code, 'audit_unavailable');
        assert.deepEqual(f.counts(), { opens: 1, closes: 0 });
      } finally {
        const close = runtime.close();
        assert.equal(runtime.close(), close);
        await close;
      }
      assert.deepEqual(f.counts(), { opens: 1, closes: 1 });
      await assert.rejects(fetch(base + path));
    });
  }
}

test('shutdown waits for active mandatory audit before releasing owned SQL', {
  timeout: 15000,
}, async () => {
  const f = fixture();
  const runtime = await startPostgresSsoManagementGateway(f.ports);
  await seed(f.db);
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.gate(async () => {
    enter();
    await gate;
  });
  const pending = fetch(`http://127.0.0.1:${runtime.address.port}/management/v1/audit`, {
    headers: { authorization: `Bearer ${token}` },
  });
  try {
    await Promise.race([
      entered,
      pending.then(() => {
        throw new Error('audit not entered');
      }),
    ]);
    const closing = runtime.close();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.counts().closes, 0);
    release();
    await read(await pending, 200);
    await closing;
    assert.equal(f.counts().closes, 1);
  } finally {
    release();
    await pending;
    await runtime.close();
  }
});
