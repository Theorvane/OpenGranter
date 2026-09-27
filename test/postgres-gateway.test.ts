import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresChatHandler } from '../src/gateway/postgres-chat-handler.ts';
import { createPostgresProxyCredentialStore } from '../src/gateway/postgres-proxy-credentials.ts';
import { createProxyTokenService } from '../src/gateway/proxy-tokens.ts';
import { applyPostgresMigrations } from '../src/storage/postgres-migrations.ts';

const migrationDirectory = new URL('../migrations/', import.meta.url);
const sources = await Promise.all(
  (await readdir(migrationDirectory)).sort().map(async (name) => ({
    version: name.slice(0, 3),
    sql: await readFile(new URL(name, migrationDirectory), 'utf8'),
  })),
);

async function fixture(entropyByte = 255) {
  const db = new PGlite();
  await applyPostgresMigrations(
    {
      transaction: (callback) =>
        db.transaction((tx) =>
          callback({
            exec: (sql) => tx.exec(sql),
            query: (sql, params) => tx.query(sql, [...params]),
          }),
        ),
    },
    sources,
    () => 1000,
  );
  await db.exec(`
    INSERT INTO iam_principals VALUES ('service-1', 'service', true);
    INSERT INTO iam_policies VALUES ('allow', 'v1',
      '[{"effect":"Allow","actions":["llm:InvokeModel","llm:UseProvider","usage:ReadSelf","audit:Read"],"resources":["model:chat","provider:openai","principal:service-1"]}]');
    INSERT INTO iam_principal_policies VALUES ('service-1', 'allow');
    INSERT INTO catalog_models VALUES ('chat', 1000, true, NULL);
    INSERT INTO catalog_routes (route_id, alias, kind, version, candidates)
      VALUES ('ordered-v1', 'chat', 'managed', 'v1',
        '[{"id":"openai","kind":"managed","providerId":"openai","upstreamModelId":"gpt"}]');
    UPDATE catalog_models SET active_route_id = 'ordered-v1' WHERE alias = 'chat';
  `);
  const client = { query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]) };
  const tokens = createProxyTokenService({
    store: createPostgresProxyCredentialStore(client),
    now: () => 1000,
    random: (bytes) => Buffer.alloc(bytes, entropyByte),
  });
  const issued = await tokens.issue({
    principalId: 'service-1',
    actorId: 'admin-1',
    requestId: 'issue-1',
    expiresAt: 10000,
  });
  let requestNumber = 0;
  const calls: string[] = [];
  const handler = createPostgresChatHandler({
    client,
    now: () => 1000,
    newRequestId: () => `request-${++requestNumber}`,
    checkLimit: async () => true,
    resolveSecret: async () => {
      throw new Error('unexpected Jev secret');
    },
    invokeDirect: async (candidate) => {
      calls.push(candidate.id);
      return {
        id: 'completion',
        choices: [{ message: { role: 'assistant', content: 'private response' } }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      };
    },
  });
  const request = (path: string, method = 'GET') =>
    new Request(`http://localhost${path}`, {
      method,
      headers: { authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' },
      ...(method === 'POST'
        ? {
            body: JSON.stringify({
              model: 'chat',
              messages: [{ role: 'user', content: 'private prompt' }],
            }),
          }
        : {}),
    });
  return { db, tokens, issued, handler, calls, request };
}

test('issued token reaches stored IAM/catalog and persisted audit/usage through HTTP', async () => {
  const { db, handler, calls, request } = await fixture();
  try {
    const models = await handler(request('/v1/models'));
    assert.equal(models.status, 200);
    assert.equal(((await models.json()) as { data: { id: string }[] }).data[0]?.id, 'chat');
    assert.equal((await handler(request('/v1/chat/completions', 'POST'))).status, 200);
    assert.deepEqual(calls, ['openai']);
    const usage = await handler(request('/v1/usage'));
    assert.equal(usage.status, 200);
    const usageBody = await usage.text();
    assert.equal(JSON.parse(usageBody).data[0].usage.totalTokens, 5);
    const audit = await handler(request('/v1/audit'));
    assert.equal(audit.status, 200);
    const auditBody = await audit.text();
    assert.equal(
      JSON.parse(auditBody).data.some((event: { kind: string }) => event.kind === 'decision'),
      true,
    );
    for (const body of [usageBody, auditBody]) {
      assert.equal(body.includes('private'), false);
      assert.equal(body.includes('og1_'), false);
    }
  } finally {
    await db.close();
  }
});

test('stored explicit/default Deny and revocation prevent inference', async () => {
  const { db, handler, calls, request, tokens, issued } = await fixture(251);
  assert.equal(issued.credentialId.startsWith('-'), true);
  try {
    await db.exec(`INSERT INTO iam_policies VALUES ('deny', 'v1', '[{"effect":"Deny","actions":["llm:UseProvider"],"resources":["provider:openai"]}]');
      INSERT INTO iam_principal_policies VALUES ('service-1', 'deny');`);
    assert.equal((await handler(request('/v1/chat/completions', 'POST'))).status, 403);
    await db.exec("DELETE FROM iam_principal_policies WHERE principal_id = 'service-1'");
    assert.equal((await handler(request('/v1/chat/completions', 'POST'))).status, 403);
    await tokens.revoke({
      credentialId: issued.credentialId,
      actorId: 'admin-1',
      requestId: 'revoke-1',
    });
    assert.equal((await handler(request('/v1/chat/completions', 'POST'))).status, 401);
    assert.deepEqual(calls, []);
  } finally {
    await db.close();
  }
});

test('unavailable IAM and required audit storage return safe failures before inference', async () => {
  const { db, handler, calls, request } = await fixture();
  try {
    await db.exec('DROP TABLE gateway_audit_events');
    const auditFailed = await handler(request('/v1/chat/completions', 'POST'));
    assert.equal(auditFailed.status, 503);
    assert.equal((await auditFailed.text()).includes('gateway_audit_events'), false);
    await db.exec(await readFile(new URL('003_gateway_audit.sql', migrationDirectory), 'utf8'));
    await db.exec('DROP TABLE iam_principals CASCADE');
    const unavailable = await handler(request('/v1/chat/completions', 'POST'));
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.text()).includes('iam_principals'), false);
    assert.deepEqual(calls, []);
  } finally {
    await db.close();
  }
});

test('usage storage failure after inference returns unavailable without replay', async () => {
  const { db, handler, calls, request } = await fixture();
  try {
    await db.exec('DROP TABLE usage_records');
    const response = await handler(request('/v1/chat/completions', 'POST'));
    assert.equal(response.status, 503);
    assert.deepEqual(calls, ['openai']);
    assert.equal((await response.text()).includes('usage_records'), false);
    const result = await db.query<{ kind: string }>(
      "SELECT kind FROM gateway_audit_events WHERE kind = 'usage-handoff-failed'",
    );
    assert.equal(result.rows.length, 1);
  } finally {
    await db.close();
  }
});
