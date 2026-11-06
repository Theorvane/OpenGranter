import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  createPostgresSsoModelCatalogHandler,
  createPostgresSsoModelCatalogServer,
} from '../src/gateway/postgres-sso-model-catalog-http.ts';
import { createSsoManagementCatalogAuthority } from '../src/management/catalog-authority.ts';
import { createSsoManagementCatalogClient } from '../src/management/catalog-client.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

async function fixture() {
  const jwt = await createSsoAccessTokenFixture();
  const db = new PGlite();
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
  await db.exec(`
      INSERT INTO iam_principals VALUES ('human', 'human', true);
      INSERT INTO iam_policies VALUES ('allow', 'v1',
        '[{"effect":"Allow","actions":["llm:InvokeModel","llm:UseProvider"],"resources":["model:*","provider:openai"]}]');
      INSERT INTO iam_roles VALUES ('reader');
      INSERT INTO iam_principal_roles VALUES ('human', 'reader');
      INSERT INTO iam_role_policies VALUES ('reader', 'allow');
      INSERT INTO catalog_models (alias, created_at_seconds, enabled) VALUES ('team/chat', 42, true);
      INSERT INTO catalog_routes (route_id, alias, kind, version, credential_ref, candidates) VALUES
        ('direct', 'team/chat', 'managed', 'v1', NULL,
         '[{"id":"one","kind":"managed","providerId":"openai","upstreamModelId":"private-secret"}]');
      UPDATE catalog_models SET active_route_id = 'direct' WHERE alias = 'team/chat';
    `);
  await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1, $2, $3)', [
    jwt.issuer,
    jwt.subject,
    'human',
  ]);
  let sequence = 0;
  const ports = {
    ...jwt.config,
    client: { query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]) },
    newRequestId: () => `composed-${++sequence}`,
  };
  const token = await jwt.token();
  const request = (suffix = '', authenticated = true) =>
    new Request(`http://localhost/management/v1/models${suffix}`, {
      headers: {
        ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
        'x-request-id': 'client-forged',
      },
    });
  return { db, ports, request, token };
}

async function safe(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const text = await response.text();
  assert.doesNotMatch(text, /private-secret|client-forged|Bearer|SELECT|INSERT/u);
  return JSON.parse(text);
}

test('composed Node HTTP performs fresh IAM and durable SSO audit without callback wiring', async () => {
  const f = await fixture();
  const server = createPostgresSsoModelCatalogServer(f.ports);
  try {
    assert.equal(server.listening, false);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const get = (suffix = '', authenticated = true) =>
      fetch(`http://127.0.0.1:${address.port}/management/v1/models${suffix}`, {
        headers: authenticated ? { authorization: `Bearer ${f.token}` } : {},
        redirect: 'error',
      });
    const model = { id: 'team/chat', object: 'model', created: 42, owned_by: 'opengranter' };
    assert.deepEqual(await safe(await get(), 200), { object: 'list', data: [model] });
    assert.deepEqual(await safe(await get('/team%2Fchat'), 200), model);
    await f.db.exec(`UPDATE iam_policies SET version = 'v2', statements =
      '[{"effect":"Deny","actions":["llm:InvokeModel"],"resources":["model:*"]}]' WHERE policy_id = 'allow'`);
    assert.deepEqual(await safe(await get(), 200), { object: 'list', data: [] });
    await safe(await get('/team%2Fchat'), 404);
    await f.db.exec('DELETE FROM iam_sso_identity_bindings');
    await safe(await get(), 401);
    await safe(await get('', false), 401);
    const rows = (
      await f.db.query<Record<string, unknown>>(
        'SELECT * FROM sso_catalog_audit_events ORDER BY event_id',
      )
    ).rows;
    assert.equal(rows.length, 6);
    assert.equal(rows[0]?.principal_id, 'human');
    assert.equal(rows[0]?.request_id, 'composed-1');
    assert.deepEqual(rows[0]?.policy_versions, [{ id: 'allow', version: 'v1' }]);
    assert.deepEqual(rows[3]?.policy_versions, [{ id: 'allow', version: 'v2' }]);
    assert.equal(rows[4]?.principal_id, null);
    assert.equal(rows[5]?.outcome, 'unauthenticated');
    assert.doesNotMatch(
      JSON.stringify(rows),
      /private-secret|client-forged|credential|team\/chat/u,
    );
    await f.db.exec('DROP TABLE sso_catalog_audit_events');
    await safe(await get(), 503);
    await safe(await get('', false), 503);
  } finally {
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await f.db.close();
  }
});

test('Fetch composition awaits its actual audit insert and ignores extra callback overrides', {
  timeout: 15000,
}, async () => {
  const f = await fixture();
  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let overrideCalls = 0;
  const ports = {
    ...f.ports,
    writeAudit: async () => {
      overrideCalls++;
    },
    client: {
      query: async (sql: string, params: readonly unknown[]) => {
        if (sql.includes('INSERT INTO sso_catalog_audit_events')) {
          entered?.();
          await blocked;
        }
        return f.ports.client.query(sql, params);
      },
    },
  };
  try {
    const handle = createPostgresSsoModelCatalogHandler(ports);
    let settled = false;
    const pending = handle(f.request()).then((response) => {
      settled = true;
      return response;
    });
    await started;
    assert.equal(settled, false);
    assert.equal((await f.db.query('SELECT * FROM sso_catalog_audit_events')).rows.length, 0);
    release?.();
    await safe(await pending, 200);
    assert.equal(overrideCalls, 0);
    assert.equal((await f.db.query('SELECT * FROM sso_catalog_audit_events')).rows.length, 1);
    await f.db.exec('DROP TABLE sso_catalog_audit_events');
    await safe(await handle(f.request()), 503);
    await safe(await handle(f.request('', false)), 503);
    assert.equal(overrideCalls, 0);
  } finally {
    release?.();
    await f.db.close();
  }
});

test('loopback detail remains authorized and durably audited beyond the collection bound', async () => {
  const f = await fixture();
  const server = createPostgresSsoModelCatalogServer(f.ports);
  try {
    await f.db.exec(
      "INSERT INTO catalog_models (alias, created_at_seconds, enabled) SELECT 'extra-' || n, 0, false FROM generate_series(1, 1001) AS n",
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const get = (suffix = '') =>
      fetch(`http://127.0.0.1:${address.port}/management/v1/models${suffix}`, {
        headers: { authorization: `Bearer ${f.token}` },
        redirect: 'error',
      });
    await safe(await get(), 503);
    assert.deepEqual(await safe(await get('/team%2Fchat'), 200), {
      id: 'team/chat',
      object: 'model',
      created: 42,
      owned_by: 'opengranter',
    });
    await f.db.exec(`UPDATE iam_policies SET version = 'v2', statements =
      '[{"effect":"Deny","actions":["llm:InvokeModel"],"resources":["model:*"]}]' WHERE policy_id = 'allow'`);
    await safe(await get('/team%2Fchat'), 404);
    await safe(await get('/absent'), 404);
    const rows = (
      await f.db.query<{ outcome: string; model_count: number }>(
        'SELECT outcome, model_count FROM sso_catalog_audit_events ORDER BY event_id',
      )
    ).rows;
    assert.deepEqual(
      rows.map(({ outcome }) => outcome),
      ['unavailable', 'ready', 'missing', 'missing'],
    );
    await f.db.exec('DROP TABLE sso_catalog_audit_events');
    await safe(await get('/team%2Fchat'), 503);
  } finally {
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await f.db.close();
  }
});

test('SSO UI transport consumes real signed-JWT HTTP with fresh IAM and durable audit', async () => {
  const f = await fixture();
  const server = createPostgresSsoModelCatalogServer(f.ports);
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const paths: string[] = [];
    // Test-only trusted request port, not a browser credential/session adapter.
    const client = createSsoManagementCatalogClient(async (path, init) => {
      paths.push(path);
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${f.token}`);
      return fetch(`http://127.0.0.1:${address.port}${path}`, { ...init, headers });
    });
    const row = { id: 'team/chat', object: 'model', created: 42, owned_by: 'opengranter' };
    assert.deepEqual(await client.list(), { state: 'ready', data: [row] });
    assert.deepEqual(await client.detail('team/chat'), { state: 'ready', data: row });
    await f.db.exec(`UPDATE iam_policies SET version = 'v2', statements =
      '[{"effect":"Deny","actions":["llm:InvokeModel"],"resources":["model:*"]}]' WHERE policy_id = 'allow'`);
    assert.deepEqual(await client.detail('team/chat'), { state: 'missing' });
    assert.deepEqual(await client.list(), { state: 'ready', data: [] });
    await f.db.exec('DELETE FROM iam_sso_identity_bindings');
    assert.deepEqual(await client.list(), { state: 'unauthenticated' });
    const events = (
      await f.db.query<{ outcome: string }>(
        'SELECT outcome FROM sso_catalog_audit_events ORDER BY event_id',
      )
    ).rows;
    assert.deepEqual(
      events.map((event) => event.outcome),
      ['ready', 'ready', 'missing', 'ready', 'unauthenticated'],
    );
    await f.db.exec('DROP TABLE sso_catalog_audit_events');
    assert.deepEqual(await client.list(), { state: 'unavailable' });
    assert.equal(paths.length, 6);
    assert.ok(paths.every((path) => path.startsWith('/management/v1/models')));
    assert.equal(paths[1], '/management/v1/models/team%2Fchat');
    client.invalidate();
  } finally {
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await f.db.close();
  }
});

test('cancelled catalog read retains committed audit and retries under current persisted IAM', async () => {
  const f = await fixture();
  const server = createPostgresSsoModelCatalogServer(f.ports);
  const authority = createSsoManagementCatalogAuthority({
    onChange() {},
    now: () => 1000,
    schedule: () => () => {},
  });
  let release!: () => void;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    let received!: () => void;
    const committed = new Promise<void>((done) => {
      received = done;
    });
    const hold = new Promise<void>((done) => {
      release = done;
    });
    let reads = 0;
    let signal!: AbortSignal;
    authority.authorize({
      expiresAt: 2000,
      request: async (path, init) => {
        reads++;
        assert.ok(init.signal);
        signal = init.signal;
        const headers = new Headers(init.headers);
        headers.set('authorization', `Bearer ${f.token}`);
        const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
          ...init,
          headers,
        });
        if (reads === 1) {
          received();
          await hold;
        }
        return response;
      },
    });
    const pending = authority.list();
    await committed;
    const count = async () =>
      (
        await f.db.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM sso_catalog_audit_events',
        )
      ).rows[0]?.count;
    assert.equal(await count(), 1);
    authority.cancel();
    assert.equal(signal.aborted, true);
    assert.equal(authority.snapshot().state, 'cancelled');
    await pending;
    release();
    await new Promise((done) => setTimeout(done, 0));
    assert.equal(authority.snapshot().state, 'cancelled');
    assert.equal(await count(), 1); // A cancelled UI read cannot undo mandatory server audit.
    await f.db.exec(`UPDATE iam_policies SET version = 'v2', statements =
      '[{"effect":"Deny","actions":["llm:InvokeModel"],"resources":["model:*"]}]' WHERE policy_id = 'allow'`);
    await authority.list();
    assert.equal(authority.snapshot().state, 'empty');
    assert.equal(await count(), 2);
    await f.db.exec('DELETE FROM iam_sso_identity_bindings');
    await authority.list();
    assert.equal(authority.snapshot().state, 'unauthenticated');
    assert.equal(await count(), 3);
    assert.equal(reads, 3);
  } finally {
    release?.();
    authority.dispose();
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await f.db.close();
  }
});
