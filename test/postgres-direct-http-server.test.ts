import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createNodePostgresDirectChatServer } from '../src/gateway/node-postgres-chat-server.ts';
import { createPostgresProxyCredentialStore } from '../src/gateway/postgres-proxy-credentials.ts';
import { createProxyTokenService } from '../src/gateway/proxy-tokens.ts';
import { DirectProviderStoreUnavailable } from '../src/providers/postgres-direct-providers.ts';
import { applyPostgresMigrations } from '../src/storage/postgres-migrations.ts';

const directory = new URL('../migrations/', import.meta.url);
const sources = await Promise.all(
  (await readdir(directory)).sort().map(async (name) => ({
    version: name.slice(0, 3),
    sql: await readFile(new URL(name, directory), 'utf8'),
  })),
);

test('persisted direct server authenticates, invokes its stored registration, and records history', async () => {
  const db = new PGlite();
  try {
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
        VALUES ('route-v1', 'chat', 'managed', 'v1',
          '[{"id":"one","kind":"managed","providerId":"openai","upstreamModelId":"gpt"}]');
      UPDATE catalog_models SET active_route_id = 'route-v1' WHERE alias = 'chat';
      INSERT INTO direct_provider_registrations VALUES ('openai', 'openai', 'secret/openai', true, NULL);
    `);
    const client = {
      query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]),
    };
    const tokens = createProxyTokenService({
      store: createPostgresProxyCredentialStore(client),
      now: () => 1000,
      random: (bytes) => Buffer.alloc(bytes, 255),
    });
    const issued = await tokens.issue({
      principalId: 'service-1',
      actorId: 'admin-1',
      requestId: 'issue-1',
      expiresAt: 10000,
    });
    let upstreamCalls = 0;
    let secretCalls = 0;
    const resolveSecret = async (reference: string) => {
      secretCalls++;
      assert.equal(reference, 'secret/openai');
      return 'fixture-provider-key';
    };
    const fetcher: typeof fetch = async (url, init) => {
      upstreamCalls++;
      assert.equal(String(url), 'https://api.openai.com/v1/chat/completions');
      assert.equal(JSON.parse(String(init?.body)).model, 'gpt');
      return Response.json({
        id: 'completion',
        created: 1000,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'private response' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      });
    };
    let sequence = 0;
    const server = await createNodePostgresDirectChatServer({
      client,
      now: () => 1000,
      newRequestId: () => `socket-${++sequence}`,
      checkLimit: async () => true,
      resolveSecret,
      fetcher,
    });
    assert.equal(secretCalls, 0);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const headers = {
        authorization: `Bearer ${issued.token}`,
        'content-type': 'application/json',
      };
      const models = await fetch(`${base}/v1/models`, { headers });
      assert.equal(models.status, 200);
      assert.equal(((await models.json()) as { data: { id: string }[] }).data[0]?.id, 'chat');
      const chatOptions = {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'chat',
          messages: [{ role: 'user', content: 'private prompt' }],
        }),
      };
      const chat = await fetch(`${base}/v1/chat/completions`, chatOptions);
      assert.equal(chat.status, 200);
      assert.equal(chat.headers.get('x-request-id'), 'socket-2');
      await chat.json();
      for (const path of ['/v1/usage', '/v1/audit']) {
        const history = await fetch(`${base}${path}`, { headers });
        assert.equal(history.status, 200);
        const body = await history.text();
        assert.equal(JSON.parse(body).data.length > 0, true);
        for (const secret of [
          'private prompt',
          'private response',
          'fixture-provider-key',
          issued.token,
        ]) {
          assert.equal(body.includes(secret), false);
        }
      }
      await db.exec(`
        INSERT INTO iam_policies VALUES ('deny', 'v1',
          '[{"effect":"Deny","actions":["llm:InvokeModel"],"resources":["model:chat"]}]');
        INSERT INTO iam_principal_policies VALUES ('service-1', 'deny');
      `);
      const forbidden = await fetch(`${base}/v1/chat/completions`, chatOptions);
      assert.equal(forbidden.status, 403);
      await forbidden.text();
      assert.equal(secretCalls, 1);
      await tokens.revoke({
        credentialId: issued.credentialId,
        actorId: 'admin-1',
        requestId: 'revoke-1',
      });
      const denied = await fetch(`${base}/v1/chat/completions`, chatOptions);
      assert.equal(denied.status, 401);
      await denied.text();
      assert.equal(upstreamCalls, 1);
      assert.equal(secretCalls, 1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  } finally {
    await db.close();
  }
});

test('registration bootstrap failures are safe and retrieve no secret or upstream', async () => {
  for (const client of [
    {
      query: async () => {
        throw new Error('private credential SQL');
      },
    },
    {
      query: async () => ({
        rows: [
          {
            provider_id: 'openai',
            kind: 'unknown',
            enabled: true,
            credential_ref: 'secret/ref',
            max_output_tokens: null,
          },
        ],
      }),
    },
  ]) {
    let calls = 0;
    await assert.rejects(
      createNodePostgresDirectChatServer({
        client,
        now: () => 1,
        newRequestId: () => 'request',
        checkLimit: async () => true,
        resolveSecret: async () => {
          calls++;
          return 'fixture-key';
        },
        fetcher: async () => {
          calls++;
          throw new Error('unexpected upstream');
        },
      }),
      (error) =>
        error instanceof DirectProviderStoreUnavailable && !String(error).includes('private'),
    );
    assert.equal(calls, 0);
  }
});

test('empty registration configuration returns an unbound server without retrieving secrets', async () => {
  let calls = 0;
  const server = await createNodePostgresDirectChatServer({
    client: { query: async () => ({ rows: [] }) },
    now: () => 1,
    newRequestId: () => 'request',
    checkLimit: async () => true,
    resolveSecret: async () => {
      calls++;
      return undefined;
    },
    fetcher: async () => {
      calls++;
      throw new Error('unexpected upstream');
    },
  });
  assert.equal(server.listening, false);
  assert.equal(calls, 0);
});
