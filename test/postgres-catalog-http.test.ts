import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresCatalogServer } from '../src/gateway/postgres-catalog-http.ts';
import { createPostgresProxyCredentialStore } from '../src/gateway/postgres-proxy-credentials.ts';
import { createProxyTokenService } from '../src/gateway/proxy-tokens.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';

async function json(
  response: Response,
): Promise<{ id: string; data: { id: string }[] & { count: number } }> {
  return JSON.parse(await response.text());
}

async function fixture() {
  const db = new PGlite();
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
  await db.exec(`
    INSERT INTO iam_principals VALUES ('reader', 'human', true);
    INSERT INTO iam_policies VALUES ('read', 'v1',
      '[{"effect":"Allow","actions":["llm:InvokeModel","llm:UseProvider"],"resources":["model:*","provider:openai"]}]');
    INSERT INTO iam_principal_policies VALUES ('reader', 'read');
    INSERT INTO catalog_models (alias, created_at_seconds, enabled) VALUES ('team/chat', 1000, true), ('router', 2000, true);
    INSERT INTO catalog_routes (route_id, alias, kind, version, credential_ref, candidates) VALUES
      ('direct', 'team/chat', 'managed', 'v1', NULL,
       '[{"id":"one","kind":"managed","providerId":"openai","upstreamModelId":"private-direct-model"}]'),
      ('delegated', 'router', 'delegated', 'v1', 'private-router-secret',
       '[{"id":"two","kind":"delegated","providerId":"openai","upstreamModelId":"private-router-model"}]');
    UPDATE catalog_models SET active_route_id = 'direct' WHERE alias = 'team/chat';
    UPDATE catalog_models SET active_route_id = 'delegated' WHERE alias = 'router';
  `);
  let now = 1000;
  let queries = 0;
  let auditFails = false;
  const client = {
    query: async (sql: string, params: readonly unknown[]) => {
      queries++;
      if (auditFails && sql.includes('INSERT INTO gateway_audit_events'))
        throw new Error('private SQL');
      return db.query(sql, [...params]);
    },
  };
  const tokens = createProxyTokenService({
    store: createPostgresProxyCredentialStore(client),
    now: () => now,
  });
  const issued = await tokens.issue({
    principalId: 'reader',
    actorId: 'admin',
    requestId: 'issue',
    expiresAt: 5000,
  });
  const server = createPostgresCatalogServer({
    client,
    now: () => now,
    newRequestId: () => 'catalog-request',
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    db,
    tokens,
    issued,
    queries: () => queries,
    expire: () => {
      now = 5000;
    },
    failAudit: () => {
      auditFails = true;
    },
    request: (path = '/api/v1/models', token = issued.token, method = 'GET') =>
      fetch(origin + path, {
        method,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await db.close();
    },
  };
}

test('standalone catalog serves SQL-backed managed/delegated list/detail/count/search with fresh Deny', async () => {
  const f = await fixture();
  try {
    const response = await f.request();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.text();
    assert.deepEqual(
      JSON.parse(body)
        .data.map((m: { id: string }) => m.id)
        .sort(),
      ['router', 'team/chat'],
    );
    assert.equal(body.includes('private-'), false);
    assert.equal(body.includes(f.issued.token), false);
    for (const path of ['/api/v1/models/team%2Fchat', '/v1/models/team%2Fchat']) {
      const detail = await f.request(path);
      assert.equal(detail.status, 200);
      assert.equal((await json(detail)).id, 'team/chat');
    }
    assert.equal((await json(await f.request('/api/v1/models/count'))).data.count, 0);
    assert.equal(
      (await json(await f.request('/api/v1/models/count?output_modalities=all'))).data.count,
      2,
    );
    assert.equal(
      (await json(await f.request('/api/v1/models/user?output_modalities=all'))).data.length,
      2,
    );
    assert.deepEqual(
      (await json(await f.request('/api/v1/models?q=router'))).data.map(
        (m: { id: string }) => m.id,
      ),
      ['router'],
    );
    await f.db.exec(`INSERT INTO iam_policies VALUES ('deny', 'v2', '[{"effect":"Deny","actions":["llm:UseProvider"],"resources":["provider:openai"]}]');
      INSERT INTO iam_principal_policies VALUES ('reader', 'deny');`);
    assert.deepEqual((await json(await f.request())).data, []);
    assert.equal((await f.request('/api/v1/models/team%2Fchat')).status, 404);
    const audits = await f.db.query<{ kind: string }>('SELECT kind FROM gateway_audit_events');
    assert.ok(audits.rows.some((row) => row.kind === 'models-listed'));
    assert.ok(audits.rows.some((row) => row.kind === 'model-read'));
  } finally {
    await f.close();
  }
});

test('non-discovery routes and methods cannot reach SQL or mutation/inference', async () => {
  const f = await fixture();
  try {
    for (const [path, method] of [
      ['/api/v1/chat/completions', 'POST'],
      ['/v1/chat/completions', 'POST'],
      ['/v1/usage', 'GET'],
      ['/v1/audit', 'GET'],
      ['/management/v1/proxy-tokens', 'POST'],
      ['/api/v1/models', 'POST'],
      ['/api/v1/models', 'HEAD'],
      ['/other', 'GET'],
    ]) {
      const before = f.queries();
      const response = await f.request(path, f.issued.token, method);
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      await response.text();
      assert.equal(f.queries(), before);
    }
  } finally {
    await f.close();
  }
});

for (const cause of ['missing', 'disabled', 'revoked', 'expired'] as const) {
  test(`catalog denies ${cause} credential without disclosing models`, async () => {
    const f = await fixture();
    try {
      if (cause === 'disabled')
        await f.db.exec(`UPDATE iam_principals SET active = false WHERE principal_id = 'reader'`);
      if (cause === 'revoked')
        await f.tokens.revoke({
          credentialId: f.issued.credentialId,
          actorId: 'admin',
          requestId: 'revoke',
        });
      if (cause === 'expired') f.expire();
      const response = await f.request('/api/v1/models', cause === 'missing' ? '' : f.issued.token);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal((await response.text()).includes('team/chat'), false);
    } finally {
      await f.close();
    }
  });
}

test('query errors and mandatory audit failures remain private and fail closed', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/api/v1/models?unknown=1')).status, 400);
    f.failAudit();
    const response = await f.request();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.text();
    assert.equal(body.includes('audit_unavailable'), true);
    assert.equal(body.includes('team/chat'), false);
    assert.equal(body.includes('private SQL'), false);
  } finally {
    await f.close();
  }
});

for (const boundary of ['catalog', 'identity'] as const) {
  test(`${boundary} database outage returns a sanitized no-store error`, async () => {
    const f = await fixture();
    try {
      await f.db.exec(
        boundary === 'catalog'
          ? 'DROP TABLE catalog_routes CASCADE'
          : 'DROP TABLE iam_principal_policies',
      );
      const response = await f.request();
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.text();
      assert.equal(
        body.includes(
          boundary === 'catalog' ? 'catalog_unavailable' : 'authentication_unavailable',
        ),
        true,
      );
      assert.equal(body.includes('team/chat'), false);
      assert.equal(body.includes('does not exist'), false);
      assert.equal(body.includes(f.issued.token), false);
    } finally {
      await f.close();
    }
  });
}
