import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { startPostgresSsoManagementGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const javascript = await buildManagementBrowser({
  root: fileURLToPath(new URL('..', import.meta.url)),
  entry: 'src/management/catalog-authority.ts',
});
function fixture() {
  const db = new PGlite();
  let opens = 0;
  let closes = 0;
  const connection: PostgresConnection = {
    query: (sql, params) => db.query(sql, [...params]),
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
    counts: () => ({ opens, closes }),
    ports: {
      ...jwt.config,
      host: '127.0.0.1',
      port: 0,
      newRequestId: () => 'browser-management-test',
      openConnection: () => {
        opens++;
        return connection;
      },
    },
  };
}

test('explicit browser artifact shares owned SSO socket without granting API authority', async () => {
  const f = fixture();
  const runtime = await startPostgresSsoManagementGateway({
    ...f.ports,
    browserJavascript: javascript,
  });
  const url = `http://127.0.0.1:${runtime.address.port}`;
  try {
    const page = await fetch(`${url}/management`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /type="module" src="\/management\/app.js"/);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    const script = await fetch(`${url}/management/app.js`);
    assert.equal(script.status, 200);
    assert.equal(await script.text(), javascript);
    assert.match(script.headers.get('content-type') ?? '', /javascript/);
    const head = await fetch(`${url}/management/app.js`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    const query = await fetch(`${url}/management/app.js?token=untrusted`);
    assert.equal(query.status, 400);
    await query.text();
    const issue = async (authorization?: string) =>
      fetch(`${url}/management/v1/proxy-tokens`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify({ principalId: 'human-owner', expiresAt: jwt.config.now() + 10000 }),
      });
    const unauthorized = await issue();
    assert.equal(unauthorized.status, 401);
    await unauthorized.text();
    await f.db.exec(
      "INSERT INTO iam_principals VALUES ('human-admin','human',true),('human-owner','human',true)",
    );
    await f.db.query(
      'INSERT INTO iam_sso_identity_bindings (issuer, subject, principal_id) VALUES ($1,$2,$3)',
      [jwt.issuer, jwt.subject, 'human-admin'],
    );
    const denied = await issue(`Bearer ${await jwt.token()}`);
    assert.equal(denied.status, 403);
    await denied.text();
    const events = (await f.db.query<{ kind: string }>('SELECT kind FROM gateway_audit_events'))
      .rows;
    assert.ok(events.some((row) => row.kind === 'management-auth-denied'));
    assert.equal((await f.db.query('SELECT * FROM proxy_credentials')).rows.length, 0);
    const proxy = await fetch(`${url}/v1/models`);
    assert.equal(proxy.status, 404);
    await proxy.text();
    assert.deepEqual(f.counts(), { opens: 1, closes: 0 });
  } finally {
    const closing = runtime.close();
    assert.equal(runtime.close(), closing);
    await closing;
  }
  assert.deepEqual(f.counts(), { opens: 1, closes: 1 });
  await assert.rejects(fetch(`${url}/management`));
});

test('SSO browser is default-off', async () => {
  const f = fixture();
  const runtime = await startPostgresSsoManagementGateway(f.ports);
  try {
    for (const path of ['/management', '/management/app.js']) {
      const response = await fetch(`http://127.0.0.1:${runtime.address.port}${path}`);
      assert.equal(response.status, 404);
      await response.text();
    }
  } finally {
    await runtime.close();
  }
});

test('invalid explicit public artifact fails before database acquisition', async () => {
  for (const browserJavascript of [null, 1, {}, '']) {
    let opens = 0;
    await assert.rejects(
      startPostgresSsoManagementGateway({
        ...jwt.config,
        host: '127.0.0.1',
        port: 0,
        newRequestId: () => 'id',
        browserJavascript: browserJavascript as unknown as string,
        openConnection: () => {
          opens++;
          throw new Error('must not open');
        },
      }),
      { name: 'InvalidGatewayRuntimeInput' },
    );
    assert.equal(opens, 0);
  }
});

test('browser composition startup failure still closes its migrated connection', async () => {
  const f = fixture();
  await assert.rejects(
    startPostgresSsoManagementGateway({
      ...f.ports,
      browserJavascript: javascript,
      issuer: 'not-an-issuer',
    }),
    { name: 'GatewayStartupUnavailable' },
  );
  assert.deepEqual(f.counts(), { opens: 1, closes: 1 });
});
