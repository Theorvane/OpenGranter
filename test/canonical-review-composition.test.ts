import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import {
  createPostgresSsoCanonicalReviewHandler,
  createPostgresSsoCanonicalReviewServer,
} from '../src/gateway/postgres-sso-canonical-review-http.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
async function fixture() {
  const db = new PGlite();
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
  await db.exec(`
    INSERT INTO iam_principals VALUES ('human','human',true),('foreign','human',true);
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
  let hook = async () => {};
  const client = {
    query: async (sql: string, params: readonly unknown[]) => {
      if (sql.includes('INSERT INTO sso_audit_history_access_events')) await hook();
      return db.query(sql, [...params]);
    },
  };
  const audit = createPostgresGatewayAuditStore(client, () => 100);
  const usage = createPostgresUsageLedger(client);
  for (const principalId of ['human', 'foreign']) {
    await audit.append({
      kind: 'models-listed',
      principalId,
      requestId: 'Trace:/A+1',
      credentialId: 'private-proxy',
      policyVersions: [],
      count: 1,
    });
    await usage(
      buildUsageRecord({
        principalId,
        attemptId: principalId,
        occurredAt: 100,
        requestId: 'Trace:/A+1',
        modelAlias: 'chat',
        credentialId: 'private-proxy',
        policyVersions: [],
        routeKind: 'managed',
        upstreamModelId: 'private-upstream',
        selectedCandidateId: 'one',
        latencyMs: 2,
        outcome: 'succeeded',
        possiblyBilled: true,
        possibleDuplicate: false,
      }),
    );
  }
  let ids = 0;
  const ports = {
    ...jwt.config,
    client,
    newRequestId: () => `review-${++ids}`,
    javascript: 'export {};',
  };
  const server = createPostgresSsoCanonicalReviewServer(ports);
  assert.equal(server.listening, false);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  return {
    db,
    ports,
    server,
    hook: (next: () => Promise<void>) => {
      hook = next;
    },
    get: (path: string, auth = true, init: RequestInit = {}) =>
      fetch(base + path, {
        ...init,
        headers: { ...(auth ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
      }),
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      await db.close();
    },
  };
}
async function text(response: Response, status = 200) {
  const body = await response.text();
  assert.equal(response.status, status, body);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(!body.includes(token));
  assert.doesNotMatch(body, /SELECT|INSERT/u);
  return body;
}

test('canonical review loopback serves catalog detail and scoped usage/audit JSON/CSV together', async () => {
  const f = await fixture();
  try {
    const models = JSON.parse(await text(await f.get('/management/v1/models')));
    assert.deepEqual(
      models.data.map((m: { id: string }) => m.id),
      ['chat'],
    );
    assert.equal(JSON.parse(await text(await f.get('/management/v1/models/chat'))).id, 'chat');
    for (const resource of ['usage', 'audit']) {
      const path =
        resource === 'audit'
          ? '/management/v1/audit?request_id=Trace%3A%2FA%2B1'
          : '/management/v1/usage?model=chat';
      const page = JSON.parse(await text(await f.get(path)));
      assert.equal(page.data.length, 1);
      assert.equal(page.data[0].principalId, 'human');
      const csv = await f.get(path + '&format=csv');
      assert.match(csv.headers.get('content-type') ?? '', /^text\/csv/u);
      assert.doesNotMatch(await text(csv), /foreign/u);
      assert.deepEqual(
        JSON.parse(
          await text(
            await f.get(
              `/management/v1/${resource}?${resource === 'audit' ? 'request_id' : 'model'}=absent`,
            ),
          ),
        ).data,
        [],
      );
      await text(await f.get(path + '&principal_id=foreign'), 403);
    }
    for (const table of [
      'sso_catalog_audit_events',
      'sso_usage_audit_events',
      'sso_audit_history_access_events',
    ]) {
      const rows = await f.db.query<{ principal_id: string }>(`SELECT principal_id FROM ${table}`);
      assert.ok(rows.rows.length >= 2);
      assert.ok(rows.rows.every((row) => row.principal_id === 'human'));
    }
  } finally {
    await f.close();
  }
});

test('public shell has no authority; exact routes never expose writes/proxy or trust cookies', async () => {
  const f = await fixture();
  try {
    assert.match(await text(await f.get('/management', false)), /OpenGranter management/u);
    assert.equal(await text(await f.get('/management/app.js', false)), 'export {};');
    for (const path of ['/management/v1/models', '/management/v1/usage', '/management/v1/audit']) {
      await text(await f.get(path, false, { headers: { cookie: 'session=untrusted' } }), 401);
      await text(await f.get(path, true, { method: 'POST' }), path.endsWith('models') ? 404 : 400);
    }
    for (const path of [
      '/management/v1/proxy-tokens',
      '/v1/chat/completions',
      '/management/v1/audit/',
      '/management/v1/usage/',
      '/management/unknown',
    ])
      await text(await f.get(path, true, { method: 'POST' }), 404);
    const withoutShell = createPostgresSsoCanonicalReviewHandler({
      ...jwt.config,
      client: f.ports.client,
      newRequestId: f.ports.newRequestId,
    });
    await text(await withoutShell(new Request('https://review.test/management')), 404);
    await f.db.exec('DELETE FROM iam_principal_policies');
    assert.deepEqual(JSON.parse(await text(await f.get('/management/v1/models'))).data, []);
    await text(await f.get('/management/v1/usage'), 403);
    await text(await f.get('/management/v1/audit'), 403);
    await f.db.exec('DELETE FROM iam_sso_identity_bindings');
    for (const path of [
      '/management/v1/models/chat',
      '/management/v1/usage',
      '/management/v1/audit',
    ])
      await text(await f.get(path), 401);
  } finally {
    await f.close();
  }
});

test('review awaits canonical durable audit and fails closed without each required table', async () => {
  const f = await fixture();
  try {
    let release = () => {};
    let entered = () => {};
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      entered = r;
    });
    f.hook(async () => {
      entered();
      await blocked;
    });
    let complete = false;
    const pending = f.get('/management/v1/audit?format=csv').then((r) => {
      complete = true;
      return r;
    });
    try {
      await Promise.race([
        started,
        pending.then(() => {
          throw new Error('Response preceded mandatory audit');
        }),
      ]);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(complete, false);
    } finally {
      release();
    }
    await text(await pending);
    f.hook(async () => {});
    for (const [table, path] of [
      ['sso_catalog_audit_events', 'models'],
      ['sso_usage_audit_events', 'usage'],
      ['sso_audit_history_access_events', 'audit'],
    ]) {
      await f.db.exec(`DROP TABLE ${table}`);
      const response = await f.get(`/management/v1/${path}`);
      assert.match(await text(response, 503), /audit_unavailable/u);
    }
  } finally {
    await f.close();
  }
});

test('invalid explicit public artifact is rejected; unknown override ports confer no authority', async () => {
  const f = await fixture();
  try {
    for (const javascript of ['', undefined, null, 1]) {
      assert.throws(() =>
        createPostgresSsoCanonicalReviewHandler({ ...f.ports, javascript } as unknown as Parameters<
          typeof createPostgresSsoCanonicalReviewHandler
        >[0]),
      );
    }
    const handler = createPostgresSsoCanonicalReviewHandler({
      ...f.ports,
      ...{ writeAudit: async () => {}, auditClient: { query: async () => ({ rows: [] }) } },
    });
    await f.db.exec('DROP TABLE sso_audit_history_access_events');
    await text(
      await handler(
        new Request('https://review.test/management/v1/audit', {
          headers: { authorization: `Bearer ${token}` },
        }),
      ),
      503,
    );
  } finally {
    await f.close();
  }
});
