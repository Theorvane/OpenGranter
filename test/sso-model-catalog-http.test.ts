import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresSsoCatalogAuditStore } from '../src/audit/postgres-sso-catalog.ts';
import {
  createPostgresSsoModelCatalog,
  type SsoCatalogAuditEvent,
  type SsoCatalogModel,
  type SsoCatalogResult,
} from '../src/gateway/postgres-sso-model-catalog.ts';
import {
  createSsoModelCatalogHandler,
  createSsoModelCatalogServer,
  type SsoModelCatalogHttpPorts,
} from '../src/gateway/sso-model-catalog-http.ts';
import { createSsoManagementCatalogClient } from '../src/management/catalog-client.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const path = '/management/v1/models';
const model: SsoCatalogModel = {
  id: 'team/chat',
  object: 'model',
  created: 42,
  owned_by: 'opengranter',
};
const request = (suffix = '', bearer: string | null = 'Bearer signed-access-token') =>
  new Request(`http://localhost${path}${suffix}`, {
    headers: {
      ...(bearer === null ? {} : { authorization: bearer }),
      'x-request-id': 'client-forged',
    },
  });
function fixture() {
  const calls: unknown[][] = [];
  let listResult: SsoCatalogResult<readonly SsoCatalogModel[]> = { state: 'ready', data: [model] };
  let detailResult: SsoCatalogResult<SsoCatalogModel> = { state: 'ready', data: model };
  const ports: SsoModelCatalogHttpPorts = {
    newRequestId: () => 'server-1',
    catalog: {
      list: async (...args) => {
        calls.push(['list', ...args]);
        return listResult;
      },
      detail: async (...args) => {
        calls.push(['detail', ...args]);
        return detailResult;
      },
    },
  };
  return {
    ports,
    calls,
    handle: createSsoModelCatalogHandler(ports),
    setList: (result: typeof listResult) => {
      listResult = result;
    },
    setDetail: (result: typeof detailResult) => {
      detailResult = result;
    },
  };
}
async function safe(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const text = await response.text();
  assert.doesNotMatch(
    text,
    /signed-access-token|client-forged|private-secret|private-error|credentialRef/u,
  );
  return JSON.parse(text);
}

test('list/empty/detail use exact safe envelopes and server-owned request ID', async () => {
  const f = fixture();
  assert.deepEqual(await safe(await f.handle(request()), 200), { object: 'list', data: [model] });
  assert.deepEqual(f.calls, [['list', 'signed-access-token', 'server-1']]);
  f.setList({ state: 'ready', data: [] });
  assert.deepEqual(await safe(await f.handle(request()), 200), { object: 'list', data: [] });
  assert.deepEqual(await safe(await f.handle(request('/team%2Fchat')), 200), model);
  assert.deepEqual(f.calls[2], ['detail', 'signed-access-token', 'server-1', 'team/chat']);
});

test('only frozen known fields are serialized, never trusted service extra fields', async () => {
  const f = fixture();
  const extra = { ...model, credentialRef: 'private-secret' };
  f.setList({ state: 'ready', data: [extra] });
  f.setDetail({ state: 'ready', data: extra });
  assert.deepEqual(await safe(await f.handle(request()), 200), { object: 'list', data: [model] });
  assert.deepEqual(await safe(await f.handle(request('/team%2Fchat')), 200), model);
});

test('hidden/disabled/absent detail all use service missing; list missing is an internal failure', async () => {
  const f = fixture();
  f.setDetail({ state: 'missing' });
  for (const alias of ['hidden', 'disabled', 'absent']) {
    const body = await safe(await f.handle(request(`/${alias}`)), 404);
    assert.equal(body.error.code, 'unknown_model');
  }
  f.setList({ state: 'missing' });
  await safe(await f.handle(request()), 503);
});

test('service failures map to fixed no-store errors without private data', async () => {
  const f = fixture();
  for (const [state, status, code] of [
    ['unauthenticated', 401, 'unauthorized'],
    ['unavailable', 503, 'catalog_unavailable'],
    ['audit_unavailable', 503, 'audit_unavailable'],
  ] as const) {
    f.setList({ state });
    f.setDetail({ state });
    for (const suffix of ['', '/team%2Fchat']) {
      const response = await f.handle(request(suffix));
      if (status === 401) assert.equal(response.headers.get('www-authenticate'), 'Bearer');
      assert.equal((await safe(response, status)).error.code, code);
    }
  }
});

test('missing/malformed Bearer is delegated as empty input for audited denial; cookie is not authentication', async () => {
  const f = fixture();
  f.setList({ state: 'unauthenticated' });
  for (const header of [null, 'Basic secret', 'Bearer two tokens', 'Bearer a,Bearer b', 'Bearer']) {
    await safe(await f.handle(request('', header)), 401);
    assert.deepEqual(f.calls.at(-1), ['list', '', 'server-1']);
  }
  const cookie = new Request(`http://localhost${path}`, {
    headers: { cookie: 'session=private-secret' },
  });
  await safe(await f.handle(cookie), 401);
  assert.deepEqual(f.calls.at(-1), ['list', '', 'server-1']);
});

test('an invalid service cannot return data for missing bearer', async () => {
  const f = fixture();
  await safe(await f.handle(request('', null)), 503);
  await safe(await f.handle(request('/team%2Fchat', null)), 503);
});

test('query, malformed encoding, literal slash, empty/unsafe/overlong aliases fail before service work', async () => {
  const f = fixture();
  for (const suffix of [
    '?actor=admin',
    '/',
    '/team/chat',
    '/%ZZ',
    '/%252F',
    '/%00',
    '/%20',
    '/%5C',
    '/team%2F..',
    `/${'x'.repeat(513)}`,
  ])
    await safe(await f.handle(request(suffix)), 400);
  assert.deepEqual(f.calls, []);
});

test('unmounted paths and non-GET never perform service work', async () => {
  const f = fixture();
  for (const method of ['POST', 'HEAD', 'OPTIONS', 'DELETE'])
    await safe(await f.handle(new Request(`http://localhost${path}`, { method })), 404);
  for (const uri of [
    '/v1/models',
    '/api/v1/models',
    '/management/v1/models-other',
    '/management/v1/proxy-tokens',
  ])
    await safe(await f.handle(new Request(`http://localhost${uri}`)), 404);
  assert.deepEqual(f.calls, []);
});

test('invalid/throwing request-ID generator fails safely before service, never trusts client ID', async () => {
  for (const newRequestId of [
    () => '',
    () => 'bad id',
    () => 'x'.repeat(257),
    () => {
      throw Error('private-error');
    },
  ]) {
    const f = fixture();
    const handle = createSsoModelCatalogHandler({ ...f.ports, newRequestId });
    const response = await handle(request());
    assert.equal(response.headers.get('x-request-id'), null);
    await safe(response, 503);
    assert.deepEqual(f.calls, []);
  }
});

test('service exceptions and invalid/mismatched projections never leak data', async () => {
  const f = fixture();
  for (const value of [
    { ...model, created: -1 },
    { ...model, object: 'private-secret' },
    { ...model, id: 'bad%' },
  ]) {
    f.setList({ state: 'ready', data: [value as SsoCatalogModel] });
    await safe(await f.handle(request()), 503);
  }
  f.setDetail({ state: 'ready', data: { ...model, id: 'other' } });
  await safe(await f.handle(request('/team%2Fchat')), 503);
  const handle = createSsoModelCatalogHandler({
    ...f.ports,
    catalog: {
      ...f.ports.catalog,
      list: async () => {
        throw Error('private-error');
      },
    },
  });
  await safe(await handle(request()), 503);
});

test('awaits service completion; abort after service starts suppresses late data', async () => {
  let release: ((value: SsoCatalogResult<readonly SsoCatalogModel[]>) => void) | undefined;
  const f = fixture();
  const handle = createSsoModelCatalogHandler({
    ...f.ports,
    catalog: {
      ...f.ports.catalog,
      list: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
  });
  const controller = new AbortController();
  let settled = false;
  const pending = handle(
    new Request(`http://localhost${path}`, {
      headers: { authorization: 'Bearer signed-access-token' },
      signal: controller.signal,
    }),
  ).then((response) => {
    settled = true;
    return response;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  controller.abort();
  assert.ok(release);
  release({ state: 'ready', data: [model] });
  await safe(await pending, 400);
  await safe(
    await handle(new Request(`http://localhost${path}`, { signal: controller.signal })),
    400,
  );
});

test('real loopback Node + signed JWT + migrated PGlite: role IAM, live deny/revoke, required audit', async () => {
  const jwt = await createSsoAccessTokenFixture();
  const token = await jwt.token();
  const db = new PGlite();
  const events: SsoCatalogAuditEvent[] = [];
  let auditFailure = false;
  let server: ReturnType<typeof createSsoModelCatalogServer> | undefined;
  try {
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
    const audit = createPostgresSsoCatalogAuditStore(
      { query: (sql, params) => db.query(sql, [...params]) },
      () => 1000,
    );
    const catalog = createPostgresSsoModelCatalog({
      ...jwt.config,
      client: { query: (sql, params) => db.query(sql, [...params]) },
      writeAudit: async (event) => {
        if (auditFailure) throw Error('private-error');
        await audit.append(event);
        events.push(event);
      },
    });
    let requestId = 0;
    server = createSsoModelCatalogServer({ newRequestId: () => `http-${++requestId}`, catalog });
    assert.equal(server.listening, false);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const get = (suffix = '', authenticated = true) =>
      fetch(`${origin}${path}${suffix}`, {
        headers: {
          ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
          'x-request-id': 'client-forged',
        },
        redirect: 'error',
      });
    // Trusted server-side test transport only, never browser bearer storage.
    const client = createSsoManagementCatalogClient((path, init) =>
      fetch(origin + path, {
        ...init,
        headers: { ...init.headers, authorization: 'Bearer ' + token },
      }),
    );
    assert.deepEqual(await client.list(), { state: 'ready', data: [model] });
    assert.deepEqual(await client.detail('team/chat'), { state: 'ready', data: model });
    assert.equal(events[0]?.principalId, 'human');
    assert.equal(events[0]?.requestId, 'http-1');
    assert.deepEqual(events[0]?.policyVersions, [{ id: 'allow', version: 'v1' }]);
    assert.doesNotMatch(JSON.stringify(events), /credential|token|private-secret|team\/chat/u);
    await db.exec(`UPDATE iam_policies SET version = 'v2', statements =
      '[{"effect":"Deny","actions":["llm:InvokeModel"],"resources":["model:*"]}]' WHERE policy_id = 'allow'`);
    assert.deepEqual(await client.list(), { state: 'ready', data: [] });
    assert.deepEqual(await client.detail('team/chat'), { state: 'missing' });
    assert.deepEqual(events.at(-1)?.policyVersions, [{ id: 'allow', version: 'v2' }]);
    await db.exec("UPDATE iam_principals SET active = false WHERE principal_id = 'human'");
    assert.deepEqual(await client.list(), { state: 'unauthenticated' });
    assert.equal(events.at(-1)?.principalId, null);
    await safe(await get('', false), 401);
    assert.equal(events.at(-1)?.outcome, 'unauthenticated');
    const persisted = await db.query<Record<string, unknown>>(
      'SELECT principal_id, policy_versions, outcome FROM sso_catalog_audit_events ORDER BY event_id',
    );
    assert.equal(persisted.rows.length, 6);
    assert.equal(persisted.rows[0]?.principal_id, 'human');
    assert.deepEqual(persisted.rows[3]?.policy_versions, [{ id: 'allow', version: 'v2' }]);
    assert.equal(persisted.rows[5]?.outcome, 'unauthenticated');
    await db.exec("UPDATE iam_principals SET active = true WHERE principal_id = 'human'");
    await db.exec('DROP TABLE sso_catalog_audit_events');
    assert.deepEqual(await client.list(), { state: 'unavailable' });
    auditFailure = true;
    await safe(await get('', false), 503);
  } finally {
    if (server?.listening)
      await new Promise<void>((resolve, reject) =>
        server?.close((error) => (error ? reject(error) : resolve())),
      );
    await db.close();
  }
});
