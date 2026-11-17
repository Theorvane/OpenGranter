import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  createPostgresSsoModelCatalog,
  type SsoCatalogAuditEvent,
} from '../src/gateway/postgres-sso-model-catalog.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
async function fixture(auditHook?: (event: SsoCatalogAuditEvent) => Promise<void>) {
  const db = new PGlite();
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
  await db.exec(`
    INSERT INTO iam_principals VALUES ('human', 'human', true);
    INSERT INTO iam_policies VALUES ('allow', 'v1',
      '[{"effect":"Allow","actions":["llm:InvokeModel","llm:UseProvider"],"resources":["model:*","provider:openai"]}]');
    INSERT INTO iam_roles VALUES ('reader');
    INSERT INTO iam_principal_roles VALUES ('human', 'reader');
    INSERT INTO iam_role_policies VALUES ('reader', 'allow');
    INSERT INTO catalog_models (alias, created_at_seconds, enabled) VALUES
      ('team/chat', 1000, true), ('router', 2000, true), ('hidden', 3000, true), ('disabled', 0, false);
    INSERT INTO catalog_routes (route_id, alias, kind, version, credential_ref, candidates) VALUES
      ('direct', 'team/chat', 'managed', 'v1', NULL,
       '[{"id":"one","kind":"managed","providerId":"openai","upstreamModelId":"private-direct"}]'),
      ('delegated', 'router', 'delegated', 'v1', 'private-secret',
       '[{"id":"two","kind":"delegated","providerId":"openai","upstreamModelId":"private-router"}]'),
      ('blocked', 'hidden', 'managed', 'v1', NULL,
       '[{"id":"three","kind":"managed","providerId":"anthropic","upstreamModelId":"private-hidden"}]');
    UPDATE catalog_models SET active_route_id = 'direct' WHERE alias = 'team/chat';
    UPDATE catalog_models SET active_route_id = 'delegated' WHERE alias = 'router';
    UPDATE catalog_models SET active_route_id = 'blocked' WHERE alias = 'hidden';
  `);
  await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1, $2, $3)', [
    jwt.issuer,
    jwt.subject,
    'human',
  ]);
  const events: SsoCatalogAuditEvent[] = [];
  const sql: string[] = [];
  let auditFailure = false;
  const service = createPostgresSsoModelCatalog({
    ...jwt.config,
    client: {
      query: (query, params) => {
        sql.push(query);
        return db.query(query, [...params]);
      },
    },
    writeAudit: async (event) => {
      if (auditFailure) throw Error('private audit');
      await auditHook?.(event);
      events.push(event);
    },
  });
  return {
    db,
    events,
    sql,
    service,
    failAudit: () => {
      auditFailure = true;
    },
  };
}
const model = (id: string, created: number) => ({
  id,
  object: 'model',
  created,
  owned_by: 'opengranter',
});

test('signed SSO + persisted role IAM/catalog yields safe managed/delegated list and exact detail', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.service.list(token, 'list'), {
      state: 'ready',
      data: [model('router', 2000), model('team/chat', 1000)],
    });
    assert.deepEqual(await f.service.detail(token, 'detail', 'team/chat'), {
      state: 'ready',
      data: model('team/chat', 1000),
    });
    for (const alias of ['hidden', 'disabled', 'absent'])
      assert.deepEqual(await f.service.detail(token, 'missing', alias), { state: 'missing' });
    assert.equal(f.events.length, 5);
    assert.deepEqual(f.events[0], {
      operation: 'list',
      outcome: 'ready',
      requestId: 'list',
      principalId: 'human',
      policyVersions: [{ id: 'allow', version: 'v1' }],
      count: 2,
    });
    assert.doesNotMatch(
      JSON.stringify(f.events),
      /credential|private|token|issuer|subject|team\/chat/u,
    );
    assert.ok(
      f.sql.every((sql) => !/INSERT|UPDATE|DELETE|proxy_credentials|usage_records/u.test(sql)),
    );
  } finally {
    await f.db.close();
  }
});
test('fresh role policy version, explicit Deny and provider scope govern every subsequent read', async () => {
  const f = await fixture();
  try {
    await f.service.list(token, 'before');
    await f.db.exec(
      `UPDATE iam_policies SET version = 'v2', statements = statements || '[{"effect":"Deny","actions":["llm:UseProvider"],"resources":["provider:openai"]}]'::jsonb WHERE policy_id = 'allow'`,
    );
    assert.deepEqual(await f.service.list(token, 'after'), { state: 'ready', data: [] });
    assert.deepEqual(await f.service.detail(token, 'detail', 'router'), { state: 'missing' });
    assert.deepEqual(f.events[1]?.policyVersions, [{ id: 'allow', version: 'v2' }]);
  } finally {
    await f.db.close();
  }
});
for (const cause of [
  'token',
  'inactive',
  'kind',
  'binding',
  'catalog',
  'snapshot',
  'malformed',
  'expired',
  'audit',
] as const) {
  test(`SSO catalog fails closed for ${cause}, without releasing data or private error`, async () => {
    const f = await fixture();
    try {
      if (cause === 'inactive') await f.db.exec(`UPDATE iam_principals SET active = false`);
      if (cause === 'kind') await f.db.exec(`UPDATE iam_principals SET kind = 'service'`);
      if (cause === 'binding') await f.db.exec('DELETE FROM iam_sso_identity_bindings');
      if (cause === 'catalog') await f.db.exec('DROP TABLE catalog_routes CASCADE');
      if (cause === 'snapshot') await f.db.exec('DROP TABLE iam_role_policies');
      if (cause === 'malformed')
        await f.db.query('UPDATE catalog_routes SET candidates = $1::jsonb', ['[]']);
      if (cause === 'audit') f.failAudit();
      const state =
        cause === 'audit'
          ? 'audit_unavailable'
          : cause === 'catalog' || cause === 'snapshot' || cause === 'malformed'
            ? 'unavailable'
            : 'unauthenticated';
      assert.deepEqual(
        await f.service.list(
          cause === 'token'
            ? 'invalid'
            : cause === 'expired'
              ? await jwt.token({ exp: jwt.nowSeconds - 61 })
              : token,
          'request',
        ),
        { state },
      );
      assert.doesNotMatch(JSON.stringify(f.events), /credential|private|token|issuer|subject/u);
      if (cause === 'token') assert.equal(f.sql.length, 0);
    } finally {
      await f.db.close();
    }
  });
}

test('catalog data is withheld until mandatory audit resolves; output and attribution are immutable', async () => {
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(async (event) => {
    assert.ok(Object.isFrozen(event));
    assert.ok(Object.isFrozen(event.policyVersions));
    enter();
    await gate;
  });
  try {
    let settled = false;
    const pending = f.service.list(token, 'gated').then((value) => {
      settled = true;
      return value;
    });
    await entered;
    assert.equal(settled, false);
    release();
    const result = await pending;
    assert.equal(result.state, 'ready');
    if (result.state !== 'ready') assert.fail('unavailable');
    assert.ok(Object.isFrozen(result.data));
    assert.ok(Object.isFrozen(result.data[0]));
  } finally {
    release();
    await f.db.close();
  }
});
test('model Deny hides exact detail and missing audit configuration cannot construct service', async () => {
  const f = await fixture();
  try {
    await f.db.exec(
      `INSERT INTO iam_policies VALUES ('deny', 'v1', '[{"effect":"Deny","actions":["llm:InvokeModel"],"resources":["model:team/*"]}]'); INSERT INTO iam_principal_policies VALUES ('human', 'deny');`,
    );
    assert.deepEqual(await f.service.detail(token, 'denied', 'team/chat'), { state: 'missing' });
    assert.deepEqual(await f.service.list(token, 'list'), {
      state: 'ready',
      data: [model('router', 2000)],
    });
    f.failAudit();
    assert.deepEqual(await f.service.detail(token, 'audit', 'router'), {
      state: 'audit_unavailable',
    });
    assert.deepEqual(await f.service.list('invalid', 'auth-audit'), { state: 'audit_unavailable' });
    assert.throws(
      () =>
        createPostgresSsoModelCatalog({
          ...jwt.config,
          client: { query: async () => ({ rows: [] }) },
          writeAudit: undefined as never,
        }),
      { message: 'Invalid SSO access token configuration' },
    );
  } finally {
    await f.db.close();
  }
});

test('detail reads only its publication beyond the collection bound and unrelated invalid routes', async () => {
  const f = await fixture();
  try {
    await f.db.exec(`
      INSERT INTO catalog_models (alias, created_at_seconds, enabled)
      SELECT 'extra-' || n, 0, false FROM generate_series(1, 1001) AS n;
    `);
    assert.deepEqual(await f.service.list(token, 'large-list'), { state: 'unavailable' });
    assert.deepEqual(await f.service.detail(token, 'bounded-detail', 'team/chat'), {
      state: 'ready',
      data: model('team/chat', 1000),
    });
    await f.db.exec(`DELETE FROM catalog_models WHERE alias LIKE 'extra-%';
      UPDATE catalog_routes SET candidates = '[]'::jsonb WHERE route_id = 'blocked';`);
    assert.deepEqual(await f.service.list(token, 'invalid-list'), { state: 'unavailable' });
    assert.deepEqual(await f.service.detail(token, 'isolated-detail', 'team/chat'), {
      state: 'ready',
      data: model('team/chat', 1000),
    });
    for (const alias of ['absent', 'disabled']) {
      assert.deepEqual(await f.service.detail(token, 'missing-detail', alias), {
        state: 'missing',
      });
    }
    assert.equal(
      f.sql.filter(
        (sql) => sql.includes('FROM catalog_models') && sql.includes('WHERE m.alias = $1 LIMIT 2'),
      ).length,
      4,
    );
    assert.deepEqual(
      f.events.map(({ outcome }) => outcome),
      ['unavailable', 'ready', 'unavailable', 'ready', 'missing', 'missing'],
    );
    f.failAudit();
    assert.deepEqual(await f.service.detail(token, 'audit-failure', 'team/chat'), {
      state: 'audit_unavailable',
    });
  } finally {
    await f.db.close();
  }
});
