import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoCanonicalReviewGateway } from '../src/gateway/postgres-gateway-runtime.ts';
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

test('owned runtime migrates, binds canonical APIs together and closes SQL exactly once', async () => {
  const f = fixture();
  const runtime = await startPostgresSsoCanonicalReviewGateway({
    ...f.ports,
    javascript: 'export {};',
  });
  const base = `http://127.0.0.1:${runtime.address.port}`;
  const get = (path: string) =>
    fetch(base + path, { headers: { authorization: `Bearer ${token}` } });
  try {
    await seed(f.db);
    assert.equal(runtime.address.address, '127.0.0.1');
    assert.deepEqual(f.counts(), { opens: 1, closes: 0 });
    const page = JSON.parse(await read(await get('/management/v1/models'), 200));
    assert.equal(page.data[0].id, 'chat');
    assert.equal(JSON.parse(await read(await get('/management/v1/models/chat'), 200)).id, 'chat');
    for (const resource of ['usage', 'audit']) {
      assert.deepEqual(
        JSON.parse(await read(await get(`/management/v1/${resource}`), 200)).data,
        [],
      );
      const csv = await get(`/management/v1/${resource}?format=csv`);
      assert.match(csv.headers.get('content-type') ?? '', /^text\/csv/u);
      await read(csv, 200);
    }
    await read(await fetch(base + '/management'), 200);
    await read(
      await fetch(base + '/management/v1/audit', { headers: { cookie: 'session=not-authority' } }),
      401,
    );
    for (const path of ['/v1/models', '/management/v1/tokens', '/management/v1/unknown'])
      await read(await get(path), 404);
    await f.db.exec('DELETE FROM iam_principal_policies');
    await read(await get('/management/v1/usage'), 403);
    await f.db.exec('DELETE FROM iam_sso_identity_bindings');
    await read(await get('/management/v1/models'), 401);
  } finally {
    const close = runtime.close();
    assert.equal(runtime.close(), close);
    await close;
    assert.equal(runtime.close(), close);
  }
  assert.deepEqual(f.counts(), { opens: 1, closes: 1 });
  await assert.rejects(fetch(base + '/management/v1/models'));
});

test('shell absent by default and lost durable audit fails closed', async () => {
  const f = fixture();
  const runtime = await startPostgresSsoCanonicalReviewGateway(f.ports);
  const base = `http://127.0.0.1:${runtime.address.port}`;
  try {
    await seed(f.db);
    await read(await fetch(base + '/management'), 404);
    await f.db.exec('DROP TABLE sso_audit_history_access_events');
    await read(
      await fetch(base + '/management/v1/audit', { headers: { authorization: `Bearer ${token}` } }),
      503,
    );
  } finally {
    await runtime.close();
  }
  assert.equal(f.counts().closes, 1);
});

test('invalid canonical configuration and missing migrations clean up privately', async () => {
  const f = fixture();
  await assert.rejects(
    async () => {
      const unexpected = await startPostgresSsoCanonicalReviewGateway({
        ...f.ports,
        javascript: '\0private-artifact',
      });
      await unexpected.close();
    },
    { name: 'GatewayStartupUnavailable', message: 'Gateway startup unavailable' },
  );
  assert.deepEqual(f.counts(), { opens: 1, closes: 1 });
  const missing = fixture();
  await assert.rejects(
    startPostgresSsoCanonicalReviewGateway({
      ...missing.ports,
      migrationDirectory: new URL('file:///nonexistent-private-migrations/'),
    }),
    {
      name: 'GatewayStartupUnavailable',
      message: 'Gateway startup unavailable',
    },
  );
  assert.deepEqual(missing.counts(), { opens: 0, closes: 0 });
  await missing.db.close();
});

test('shutdown waits for active mandatory audit before releasing owned SQL', {
  timeout: 15000,
}, async () => {
  const f = fixture();
  const runtime = await startPostgresSsoCanonicalReviewGateway(f.ports);
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
