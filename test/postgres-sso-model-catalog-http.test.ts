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
import { discoveryModel } from './model-discovery-filters-fixture.ts';
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

test('SSO observer authority reflects fresh HTTP IAM, audit failure and revoked identity', async () => {
  const f = await fixture();
  const server = createPostgresSsoModelCatalogServer(f.ports);
  const states: string[] = [];
  let time = 1000;
  let expire: (() => void) | undefined;
  let calls = 0;
  const authority = createSsoManagementCatalogAuthority({
    now: () => time,
    onChange: (snapshot) => states.push(snapshot.state),
    schedule: (_delay, callback) => {
      expire = callback;
      return () => {
        expire = undefined;
      };
    },
  });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    // Test-only trusted port; not a browser session or credential adapter.
    const grant = {
      expiresAt: 2000,
      request: async (path: string, init: RequestInit) => {
        calls++;
        assert.ok(path.startsWith('/management/v1/models'));
        const headers = new Headers(init.headers);
        headers.set('authorization', 'Bearer ' + f.token);
        return fetch('http://127.0.0.1:' + address.port + path, { ...init, headers });
      },
    };
    const row = { id: 'team/chat', object: 'model', created: 42, owned_by: 'opengranter' };
    authority.authorize(grant);
    await authority.list();
    assert.deepEqual(authority.snapshot(), { state: 'list', models: [row] });
    await authority.detail('team/chat');
    assert.deepEqual(authority.snapshot(), { state: 'detail', model: row });
    await f.db.query('UPDATE iam_policies SET version = $1, statements = $2 WHERE policy_id = $3', [
      'v2',
      JSON.stringify([{ effect: 'Deny', actions: ['llm:InvokeModel'], resources: ['model:*'] }]),
      'allow',
    ]);
    await authority.detail('team/chat');
    assert.deepEqual(authority.snapshot(), { state: 'missing' });
    await authority.list();
    assert.deepEqual(authority.snapshot(), { state: 'empty' });
    time = 2000;
    expire?.();
    await authority.list();
    assert.deepEqual(authority.snapshot(), { state: 'expired' });
    assert.equal(calls, 4);
    authority.authorize({ ...grant, expiresAt: 3000 });
    await f.db.exec('DELETE FROM iam_sso_identity_bindings');
    await authority.list();
    assert.deepEqual(authority.snapshot(), { state: 'unauthenticated' });
    await authority.detail('team/chat');
    assert.equal(calls, 5);
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
    authority.authorize({ ...grant, expiresAt: 3000 });
    await authority.list();
    assert.deepEqual(authority.snapshot(), { state: 'unavailable' });
    assert.deepEqual(states, [
      'idle',
      'loading',
      'list',
      'loading',
      'detail',
      'loading',
      'missing',
      'loading',
      'empty',
      'expired',
      'idle',
      'loading',
      'unauthenticated',
      'idle',
      'loading',
      'unavailable',
    ]);
    assert.doesNotMatch(JSON.stringify(authority.snapshot()), /private-secret|Bearer|SELECT/);
  } finally {
    authority.dispose();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await f.db.close();
  }
});

test('signed HTTP catalog data clears on clock failure despite throwing timer cleanup', async () => {
  const f = await fixture();
  const server = createPostgresSsoModelCatalogServer(f.ports);
  let broken = false;
  let calls = 0;
  const authority = createSsoManagementCatalogAuthority({
    now: () => {
      if (broken) throw new Error('private clock diagnostic');
      return 1000;
    },
    onChange: () => {},
    schedule: () => () => {
      throw new Error('private timer diagnostic');
    },
  });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    // Test-only trusted server token, never a browser session adapter.
    const grant = {
      expiresAt: 2000,
      request: async (path: string, init: RequestInit) => {
        calls++;
        const headers = new Headers(init.headers);
        headers.set('authorization', 'Bearer ' + f.token);
        return fetch('http://127.0.0.1:' + address.port + path, { ...init, headers });
      },
    };
    authority.authorize(grant);
    await authority.detail('team/chat');
    assert.equal(authority.snapshot().state, 'detail');
    broken = true;
    assert.deepEqual(authority.snapshot(), { state: 'expired' });
    await authority.list();
    assert.equal(calls, 1);
    broken = false;
    authority.authorize(grant);
    await authority.list();
    assert.equal(authority.snapshot().state, 'list');
    authority.clear('unauthenticated');
    await authority.detail('team/chat');
    assert.deepEqual(authority.snapshot(), { state: 'unauthenticated' });
    assert.equal(calls, 2);
    const events = (
      await f.db.query<{ outcome: string }>(
        'SELECT outcome FROM sso_catalog_audit_events ORDER BY event_id',
      )
    ).rows;
    assert.deepEqual(
      events.map((event) => event.outcome),
      ['ready', 'ready'],
    );
    assert.doesNotThrow(() => authority.dispose());
    assert.deepEqual(authority.snapshot(), { state: 'disposed' });
  } finally {
    authority.dispose();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await f.db.close();
  }
});

test('published SSO display fields survive persisted catalog, HTTP and UI transport', async () => {
  const f = await fixture();
  const server = createPostgresSsoModelCatalogServer(f.ports);
  try {
    const metadata = {
      ...discoveryModel('team/chat', {
        inputs: ['text', 'image'],
        outputs: ['text'],
        parameters: ['tools', 'temperature'],
      }).openRouterMetadata,
      name: 'Published model <b>text</b>',
      description: 'Published description\n模型',
      context_length: null,
      top_provider: { is_moderated: true, context_length: 32768, max_completion_tokens: null },
      pricing: {
        prompt: '0.0000001234567890123456789',
        completion: '0e-9',
      },
    };
    await f.db.query('UPDATE catalog_models SET openrouter_metadata = $1::jsonb WHERE alias = $2', [
      JSON.stringify(metadata),
      'team/chat',
    ]);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const client = createSsoManagementCatalogClient(async (path, init) => {
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${f.token}`);
      return fetch(`http://127.0.0.1:${address.port}${path}`, { ...init, headers });
    });
    const row = {
      id: 'team/chat',
      object: 'model',
      created: 42,
      owned_by: 'opengranter',
      name: metadata.name,
      description: metadata.description,
      context_length: null,
    };
    const raw = await fetch(`http://127.0.0.1:${address.port}/management/v1/models`, {
      headers: { authorization: `Bearer ${f.token}` },
    });
    assert.deepEqual(await safe(raw, 200), {
      object: 'list',
      data: [
        {
          ...row,
          pricing: { prompt: metadata.pricing.prompt, completion: metadata.pricing.completion },
          architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
          supported_parameters: ['tools', 'temperature'],
          top_provider: { context_length: 32768, max_completion_tokens: null },
        },
      ],
    });
    const rawDetail = await fetch(
      `http://127.0.0.1:${address.port}/management/v1/models/team%2Fchat`,
      {
        headers: { authorization: `Bearer ${f.token}` },
      },
    );
    assert.deepEqual(await safe(rawDetail, 200), {
      ...row,
      pricing: { prompt: metadata.pricing.prompt, completion: metadata.pricing.completion },
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      supported_parameters: ['tools', 'temperature'],
      top_provider: { context_length: 32768, max_completion_tokens: null },
    });
    for (const max_completion_tokens of [undefined, 0, 8192]) {
      const top_provider = {
        context_length: 32768,
        ...(max_completion_tokens === undefined ? {} : { max_completion_tokens }),
      };
      await f.db.query(
        'UPDATE catalog_models SET openrouter_metadata = $1::jsonb WHERE alias = $2',
        [
          JSON.stringify({ ...metadata, top_provider: { ...top_provider, is_moderated: true } }),
          'team/chat',
        ],
      );
      const response = await fetch(
        `http://127.0.0.1:${address.port}/management/v1/models/team%2Fchat`,
        { headers: { authorization: `Bearer ${f.token}` } },
      );
      const data = await safe(response, 200);
      assert.deepEqual(data.top_provider, top_provider);
      assert.equal(Object.hasOwn(data.top_provider, 'is_moderated'), false);
    }
    // Browser parser adoption belongs to frontend; it still omits this new optional field.
    assert.deepEqual(await client.list(), { state: 'ready', data: [row] });
    assert.deepEqual(await client.detail('team/chat'), { state: 'ready', data: row });
    await f.db.query('UPDATE catalog_models SET openrouter_metadata = $1::jsonb WHERE alias = $2', [
      JSON.stringify({ ...metadata, context_length: 8192 }),
      'team/chat',
    ]);
    assert.deepEqual(await client.detail('team/chat'), {
      state: 'ready',
      data: { ...row, context_length: 8192 },
    });
    const events = (await f.db.query('SELECT * FROM sso_catalog_audit_events')).rows;
    assert.equal(events.length, 8);
    assert.doesNotMatch(
      JSON.stringify(events),
      /Published|description|context_length|max_completion_tokens|top_provider|architecture|input_modalities|supported_parameters|temperature|pricing|0\.0000001234567890123456789|private\/canonical/u,
    );
    await f.db.exec(`UPDATE iam_policies SET version = 'v2', statements =
      '[{"effect":"Deny","actions":["llm:InvokeModel"],"resources":["model:*"]}]' WHERE policy_id = 'allow'`);
    assert.deepEqual(await client.list(), { state: 'ready', data: [] });
    assert.deepEqual(await client.detail('team/chat'), { state: 'missing' });
    await f.db.exec('DELETE FROM iam_sso_identity_bindings');
    assert.deepEqual(await client.list(), { state: 'unauthenticated' });
    await f.db.exec('DROP TABLE sso_catalog_audit_events');
    assert.deepEqual(await client.list(), { state: 'unavailable' });
    client.invalidate();
  } finally {
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await f.db.close();
  }
});
