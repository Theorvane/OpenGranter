import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoManagementGateway } from '../src/gateway/postgres-gateway-runtime.ts';
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

test('owned management Account reads exact active identity over HTTP without granting model permissions', async () => {
  const f = await fixture();
  try {
    const response = await f.request();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(await response.json(), { principalId: 'account-human' });
    assert.deepEqual(await (await f.request('/management/v1/principal')).json(), {
      id: 'account-human',
      kind: 'human',
    });
    assert.deepEqual(await (await f.request('/management/v1/models')).json(), {
      object: 'list',
      data: [],
    });
    assert.equal(
      (
        await f.db.query<{ principal_id: string | null; outcome: string }>(
          'SELECT * FROM sso_current_principal_audit_events',
        )
      ).rows.length,
      2,
    );
    await f.db.exec('UPDATE iam_principals SET active=false');
    assert.equal((await f.request()).status, 401);
    assert.deepEqual(
      (
        await f.db.query(
          'SELECT outcome,principal_id FROM sso_current_principal_audit_events ORDER BY event_id DESC LIMIT 1',
        )
      ).rows,
      [{ outcome: 'unauthenticated', principal_id: null }],
    );
  } finally {
    await f.close();
  }
});

test('owned management Account missing audit fails closed without installing schema', async () => {
  const f = await fixture(false);
  try {
    const response = await f.request();
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.match(body, /audit_unavailable/);
    assert.ok(!body.includes('account-human'));
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT tablename FROM pg_tables WHERE tablename='sso_current_principal_audit_events'",
        )
      ).rows,
      [],
    );
  } finally {
    await f.close();
  }
});

test('owned management Account audit must finish before identity is released', async () => {
  const f = await fixture();
  let release!: () => void;
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.hook(async () => {
    enter();
    await pending;
  });
  try {
    let finished = false;
    const response = f.request().then((value) => {
      finished = true;
      return value;
    });
    await Promise.race([
      entered,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('audit not entered')), 10000).unref(),
      ),
    ]);
    assert.equal(finished, false);
    release();
    assert.equal((await response).status, 200);
  } finally {
    release();
    await f.close();
  }
});

test('owned management Account rejects queries and unknown methods without private SQL', async () => {
  const f = await fixture();
  try {
    const before = f.calls;
    assert.equal((await f.request('/management/v1/me?principal_id=foreign')).status, 400);
    assert.equal(
      (await f.request('/management/v1/me', '', { method: 'POST', body: 'private' })).status,
      404,
    );
    assert.equal((await f.request('/management/v1/me/foreign')).status, 404);
    assert.equal(f.calls, before);
  } finally {
    await f.close();
  }
});

test('owned management Account invalid bearer persists only anonymous rejection metadata', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/management/v1/me', 'Bearer private-invalid')).status, 401);
    const rows = (
      await f.db.query<{ principal_id: string | null; outcome: string }>(
        'SELECT * FROM sso_current_principal_audit_events',
      )
    ).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.principal_id, null);
    assert.equal(rows[0]?.outcome, 'unauthenticated');
    assert.ok(!JSON.stringify(rows).includes('private-invalid'));
    assert.ok(!JSON.stringify(rows).includes(jwt.subject));
  } finally {
    await f.close();
  }
});

test('owned management Account suppresses identity on malformed SQL acknowledgement', async () => {
  const f = await fixture();
  try {
    for (const rows of [
      [],
      [{ event_id: '0' }],
      [Object.create({ event_id: '1' })],
      [Object.assign([], { event_id: '1' })],
    ]) {
      f.ack({ rows });
      const response = await f.request();
      assert.equal(response.status, 503);
      const body = await response.text();
      assert.match(body, /audit_unavailable/);
      assert.ok(!body.includes('account-human'));
    }
    f.ack(undefined);
    assert.equal((await f.request()).status, 200);
  } finally {
    await f.close();
  }
});

test('owned management public shell does not acquire Account authority', async () => {
  const f = await fixture(true, true);
  try {
    const before = f.calls;
    const page = await f.request('/management', '');
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(!html.includes('account-human'));
    assert.equal(page.headers.get('set-cookie'), null);
    const script = await f.request('/management/app.js', '');
    assert.equal(script.status, 200);
    assert.equal(await script.text(), '// public Account shell');
    assert.match(html, /<link rel="stylesheet" href="\/management\/app.css">/);
    const stylesheet = await f.request('/management/app.css', '');
    assert.equal(stylesheet.status, 200);
    assert.equal(stylesheet.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal(stylesheet.headers.get('cache-control'), 'no-store');
    assert.equal(stylesheet.headers.get('set-cookie'), null);
    assert.equal(
      stylesheet.headers.get('content-security-policy'),
      page.headers.get('content-security-policy'),
    );
    assert.match(await stylesheet.text(), /white-space: pre-wrap/);
    const head = await f.request('/management/app.css', '', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal((await f.request('/management/app.css?identity=account-human', '')).status, 400);
    assert.equal((await f.request('/management/app.css', '', { method: 'POST' })).status, 405);
    assert.equal(f.calls, before);
    const anonymous = await f.request('/management/v1/me', '');
    assert.equal(anonymous.status, 401);
    assert.ok(!(await anonymous.text()).includes('account-human'));
    const authenticated = await f.request();
    assert.equal(authenticated.status, 200);
    assert.deepEqual(await authenticated.json(), { principalId: 'account-human' });
    assert.equal(authenticated.headers.get('set-cookie'), null);
  } finally {
    await f.close();
  }
});
