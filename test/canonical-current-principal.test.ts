import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresSsoCanonicalReviewServer } from '../src/gateway/postgres-sso-canonical-review-http.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
async function fixture(installAudit = true) {
  const db = new PGlite();
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
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
  let auditHook = async () => {};
  let acknowledgement: { readonly rows: readonly unknown[] } | undefined;
  let calls = 0;
  const client = {
    query: async (sql: string, params: readonly unknown[]) => {
      calls++;
      if (sql.includes('INSERT INTO sso_current_principal_audit_events')) {
        await auditHook();
        if (acknowledgement) return acknowledgement;
      }
      return db.query(sql, [...params]);
    },
  };
  const server = createPostgresSsoCanonicalReviewServer({
    ...jwt.config,
    client,
    newRequestId: () => 'account-read',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
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
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await db.close();
    },
  };
}

test('canonical Account reads exact active identity over HTTP without granting model permissions', async () => {
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

test('canonical Account missing audit fails closed without installing schema', async () => {
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

test('canonical Account audit must finish before identity is released', async () => {
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

test('canonical Account rejects query/framing and unknown methods without private SQL', async () => {
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

test('canonical Account invalid bearer persists only anonymous rejection metadata', async () => {
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

test('canonical Account suppresses identity on malformed SQL acknowledgement', async () => {
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

test('principal audit contract is not installed by default migration loading', async () => {
  assert.equal(
    (await loadPostgresMigrationSources()).some((source) =>
      source.sql.includes('sso_current_principal_audit_events'),
    ),
    false,
  );
});
