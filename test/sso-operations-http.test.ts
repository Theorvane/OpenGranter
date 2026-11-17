import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import { createPostgresProxyCredentialStore } from '../src/gateway/postgres-proxy-credentials.ts';
import { createPostgresSsoCanonicalReviewHandler } from '../src/gateway/postgres-sso-canonical-review-http.ts';
import {
  createPostgresSsoOperationsHandler,
  createPostgresSsoOperationsServer,
} from '../src/gateway/postgres-sso-operations-http.ts';
import { createProxyTokenService } from '../src/gateway/proxy-tokens.ts';
import { createAuditReview } from '../src/management/audit-review.ts';
import type { CatalogRequest } from '../src/management/catalog-client.ts';
import { createUsageReview } from '../src/management/usage-review.ts';
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
    INSERT INTO iam_policies VALUES ('manager','v1','[{"effect":"Allow","actions":["iam:Manage"],"resources":["principal:*"]}]');
    INSERT INTO iam_principal_policies VALUES ('human','manager');
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
  let hook = async (_sql: string) => {};
  const client = {
    query: async (sql: string, params: readonly unknown[]) => {
      await hook(sql);
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
  const server = createPostgresSsoOperationsServer(ports);
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
    tokens: createProxyTokenService({
      store: createPostgresProxyCredentialStore(client),
      now: jwt.config.now,
    }),
    hook: (next: (sql: string) => Promise<void>) => {
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
  assert.ok(!body.includes(token));
  assert.doesNotMatch(body, /SELECT|INSERT/u);
  return body;
}

const issuePath = '/management/v1/proxy-tokens';
const revokePath = `${issuePath}/revoke`;
const issueBody = { principalId: 'human', expiresAt: jwt.config.now() + 86400000 };
function post(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
async function issue(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await f.get(issuePath, true, post(issueBody));
  assert.equal(response.status, 201, await response.clone().text());
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return (await response.json()) as { credentialId: string; token: string };
}

test('one loopback operations boundary serves actual SQL reads and issue/revoke', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(
      JSON.parse(await text(await f.get('/management/v1/models'))).data.map(
        (m: { id: string }) => m.id,
      ),
      ['chat'],
    );
    assert.equal(JSON.parse(await text(await f.get('/management/v1/models/chat'))).id, 'chat');
    for (const resource of ['usage', 'audit']) {
      const path = `/management/v1/${resource}?${resource === 'audit' ? 'request_id=Trace%3A%2FA%2B1' : 'model=chat'}`;
      const page = JSON.parse(await text(await f.get(path)));
      assert.equal(page.data.length, 1);
      assert.equal(page.data[0].principalId, 'human');
      assert.doesNotMatch(await text(await f.get(`${path}&format=csv`)), /foreign/u);
    }
    const issued = await issue(f);
    assert.equal((await f.tokens.verifyCredential(issued.token))?.principalId, 'human');
    const stored = await f.db.query<{ principal_id: string }>(
      'SELECT principal_id FROM proxy_credentials WHERE credential_id=$1',
      [issued.credentialId],
    );
    assert.equal(stored.rows[0]?.principal_id, 'human');
    assert.deepEqual(
      JSON.parse(
        await text(await f.get(revokePath, true, post({ credentialId: issued.credentialId }))),
      ),
      { revoked: true },
    );
    assert.equal(await f.tokens.verifyCredential(issued.token), undefined);
    assert.deepEqual(
      JSON.parse(
        await text(await f.get(revokePath, true, post({ credentialId: issued.credentialId }))),
      ),
      { revoked: false },
    );
    assert.equal((await f.db.query('SELECT * FROM token_management_decisions')).rows.length, 3);
    const history = await text(await f.get('/management/v1/audit'));
    assert.ok(!history.includes(issued.token));
  } finally {
    await f.close();
  }
});

test('operations preserves fresh Deny and disabled identity on reads and writes', async () => {
  const f = await fixture();
  try {
    const issued = await issue(f);
    await f.db.exec(
      `UPDATE iam_policies SET version='v2', statements='[{"effect":"Deny","actions":["iam:Manage"],"resources":["*"]}]' WHERE policy_id='manager'`,
    );
    await text(await f.get(issuePath, true, post(issueBody)), 403);
    await text(await f.get(revokePath, true, post({ credentialId: issued.credentialId })), 403);
    await f.db.exec("UPDATE iam_principals SET active=false WHERE principal_id='human'");
    for (const path of ['/management/v1/models', '/management/v1/usage', '/management/v1/audit'])
      await text(await f.get(path), 401);
    await text(await f.get(issuePath, true, post(issueBody)), 401);
  } finally {
    await f.close();
  }
});

test('operations never treats shell, cookies or proxy credentials as SSO authority', async () => {
  const f = await fixture();
  try {
    const issued = await issue(f);
    await text(await f.get('/management', false));
    for (const path of [
      '/management/v1/models',
      '/management/v1/usage',
      '/management/v1/audit',
      issuePath,
    ]) {
      const init = path === issuePath ? post(issueBody) : {};
      await text(
        await f.get(path, false, {
          ...init,
          headers: { ...init.headers, cookie: 'session=not-authority' },
        }),
        401,
      );
      await text(
        await f.get(path, false, {
          ...init,
          headers: { ...init.headers, authorization: `Bearer ${issued.token}` },
        }),
        401,
      );
    }
  } finally {
    await f.close();
  }
});

test('operations mandatory durable decision audit failure blocks issuance', async () => {
  const f = await fixture();
  try {
    f.hook(async (sql) => {
      if (sql.includes('INSERT INTO token_management_decisions'))
        throw new Error('private SQL diagnostics');
    });
    await text(await f.get(issuePath, true, post(issueBody)), 503);
    assert.equal((await f.db.query('SELECT * FROM proxy_credentials')).rows.length, 0);
  } finally {
    await f.close();
  }
});

test('operations keeps invalid bodies and unknown methods/paths closed', async () => {
  const f = await fixture();
  try {
    await text(
      await f.get(issuePath, true, post({ ...issueBody, authenticatedActorId: 'foreign' })),
      400,
    );
    await text(await f.get(`${issuePath}?actor=foreign`, true, post(issueBody)), 400);
    await text(await f.get(issuePath), 404);
    await text(await f.get('/v1/chat/completions', true, post({})), 404);
    await text(await f.get(`${issuePath}/extra`, true, post(issueBody)), 404);
    assert.equal((await f.db.query('SELECT * FROM proxy_credentials')).rows.length, 0);
  } finally {
    await f.close();
  }
});

test('operations Fetch factory without shell leaves public entry closed and requires SSO', async () => {
  const f = await fixture();
  try {
    const { javascript: _javascript, ...ports } = f.ports;
    const handler = createPostgresSsoOperationsHandler(ports);
    await text(await handler(new Request('http://local/management')), 404);
    await text(await handler(new Request(`http://local${issuePath}`, post(issueBody))), 401);
    assert.throws(() => createPostgresSsoOperationsHandler({ ...ports, javascript: '' }));
  } finally {
    await f.close();
  }
});

test('read-only canonical review does not gain token mutation routes', async () => {
  const f = await fixture();
  try {
    const read = createPostgresSsoCanonicalReviewHandler(f.ports);
    await text(
      await read(
        new Request(`http://local${issuePath}`, {
          ...post(issueBody),
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        }),
      ),
      404,
    );
    assert.equal((await f.db.query('SELECT * FROM proxy_credentials')).rows.length, 0);
  } finally {
    await f.close();
  }
});

test('operations read access audits remain mandatory with no callback override', async () => {
  const f = await fixture();
  try {
    f.hook(async (sql) => {
      if (
        /INSERT INTO sso_(catalog_audit_events|usage_audit_events|audit_history_access_events)/u.test(
          sql,
        )
      )
        throw new Error('private SQL diagnostics');
    });
    for (const path of ['/management/v1/models', '/management/v1/usage', '/management/v1/audit']) {
      await text(await f.get(path), 503);
    }
    let called = false;
    const handler = createPostgresSsoOperationsHandler({
      ...f.ports,
      writeAudit: async () => {
        called = true;
      },
    } as typeof f.ports);
    await text(
      await handler(
        new Request('http://local/management/v1/usage', {
          headers: { authorization: `Bearer ${token}` },
        }),
      ),
      503,
    );
    assert.equal(called, false);
  } finally {
    await f.close();
  }
});

test('operations revoked-token audit failure preserves existing atomic outcome', async () => {
  const f = await fixture();
  try {
    const issued = await issue(f);
    f.hook(async (sql) => {
      if (sql.includes('INSERT INTO token_management_decisions'))
        throw new Error('private SQL diagnostics');
    });
    await text(await f.get(revokePath, true, post({ credentialId: issued.credentialId })), 503);
    assert.equal((await f.tokens.verifyCredential(issued.token))?.principalId, 'human');
    f.hook(async () => {});
    assert.deepEqual(
      JSON.parse(
        await text(await f.get(revokePath, true, post({ credentialId: issued.credentialId }))),
      ),
      { revoked: true },
    );
    assert.equal(await f.tokens.verifyCredential(issued.token), undefined);
  } finally {
    await f.close();
  }
});

test('canonical browser review controllers consume actual operations HTTP and clear revoked identity', async () => {
  const f = await fixture();
  const request: CatalogRequest = (path, init) => f.get(path, true, init);
  const usage = createUsageReview(request);
  const audit = createAuditReview(request);
  try {
    await usage.load({ model: 'chat', fromMs: 0, toMs: 101, limit: 1 });
    await audit.load({ requestId: 'Trace:/A+1', fromMs: 0, toMs: 101, limit: 1 });
    for (const review of [usage, audit]) {
      assert.equal(review.snapshot().state, 'ready');
      assert.equal(review.snapshot().data.length, 1);
      assert.equal(review.snapshot().data[0]?.principalId, 'human');
      const exported = await review.exportCsv();
      assert.equal(exported.state, 'ready');
      if (exported.state === 'ready') {
        assert.match(exported.csv, /human/u);
        assert.doesNotMatch(exported.csv, /foreign/u);
        assert.ok(!exported.csv.includes(token));
      }
    }
    await f.db.exec("UPDATE iam_principals SET active=false WHERE principal_id='human'");
    for (const review of [usage, audit]) {
      await review.retry();
      assert.equal(review.snapshot().state, 'unauthenticated');
      assert.deepEqual(review.snapshot().data, []);
      assert.equal((await review.exportCsv()).state, 'cancelled');
    }
  } finally {
    usage.dispose();
    audit.dispose();
    await f.close();
  }
});
