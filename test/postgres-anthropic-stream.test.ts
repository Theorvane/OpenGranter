import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createNodePostgresDirectChatServer } from '../src/gateway/node-postgres-chat-server.ts';
import { createNodePostgresDualRouteChatServer } from '../src/gateway/node-postgres-dual-chat-server.ts';
import { createPostgresProxyCredentialStore } from '../src/gateway/postgres-proxy-credentials.ts';
import { createProxyTokenService } from '../src/gateway/proxy-tokens.ts';
import { applyPostgresMigrations } from '../src/storage/postgres-migrations.ts';

const directory = new URL('../migrations/', import.meta.url);
const sources = await Promise.all(
  (await readdir(directory)).sort().map(async (name) => ({
    version: name.slice(0, 3),
    sql: await readFile(new URL(name, directory), 'utf8'),
  })),
);
const native = () => [
  {
    type: 'message_start',
    message: {
      id: 'msg',
      type: 'message',
      role: 'assistant',
      model: 'claude-exact',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 2,
        output_tokens: 1,
        cache_creation_input_tokens: 4,
        cache_read_input_tokens: 5,
      },
    },
  },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'private answer' } },
  { type: 'content_block_stop', index: 0 },
  {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 3 },
  },
  { type: 'message_stop' },
];
for (const mode of ['direct', 'dual'] as const)
  test(`persisted ${mode} generated Anthropic streams enforce both bases, failures and fresh provider Deny`, async () => {
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
 INSERT INTO iam_principals VALUES ('service','service',true);
 INSERT INTO iam_policies VALUES ('allow','v1','[{"effect":"Allow","actions":["llm:InvokeModel","llm:UseProvider","usage:ReadSelf","audit:Read"],"resources":["model:chat","provider:anthropic","principal:service"]}]');
 INSERT INTO iam_principal_policies VALUES ('service','allow');
 INSERT INTO catalog_models VALUES ('chat',1000,true,NULL);
 INSERT INTO catalog_routes (route_id,alias,kind,version,candidates) VALUES ('route','chat','managed','v1','[{"id":"one","kind":"managed","providerId":"anthropic","upstreamModelId":"claude-exact"}]');
 UPDATE catalog_models SET active_route_id='route' WHERE alias='chat';
 INSERT INTO direct_provider_registrations VALUES ('anthropic','anthropic','secret/anthropic',true,50);
 `);
      let failure: 'usage' | 'mid' | undefined,
        sequence = 0,
        secrets = 0,
        calls = 0;
      const client = {
        query: (sql: string, params: readonly unknown[]) => {
          if (failure === 'usage' && sql.includes('INSERT INTO usage_records'))
            throw Error('private database');
          return db.query(sql, [...params]);
        },
      };
      const tokens = createProxyTokenService({
        store: createPostgresProxyCredentialStore(client),
        now: () => 1000,
        random: (bytes) => Buffer.alloc(bytes, 255),
      });
      const issued = await tokens.issue({
        principalId: 'service',
        actorId: 'admin',
        requestId: 'issue',
        expiresAt: 10000,
      });
      const ports = {
        client,
        now: () => 1000,
        newRequestId: () => `request-${++sequence}`,
        checkLimit: async () => true,
        resolveSecret: async (ref: string) => {
          secrets++;
          assert.equal(ref, 'secret/anthropic');
          return 'fixture-provider-key';
        },
        fetcher: async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          calls++;
          assert.equal(String(url), 'https://api.anthropic.com/v1/messages');
          const body = JSON.parse(String(init?.body));
          assert.equal(body.model, 'claude-exact');
          assert.equal(body.stream, true);
          assert.equal(body.max_tokens, 50);
          const events =
            failure === 'mid'
              ? [
                  ...native().slice(0, 3),
                  { type: 'error', error: { message: 'private provider error' } },
                ]
              : native();
          return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
            headers: { 'content-type': 'text/event-stream' },
          });
        },
        invokeDirectTextStream: async () => {
          assert.fail('runtime override must be replaced');
        },
      };
      const server = await (mode === 'direct'
        ? createNodePostgresDirectChatServer
        : createNodePostgresDualRouteChatServer)(ports);
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      try {
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const headers = {
          authorization: `Bearer ${issued.token}`,
          'content-type': 'application/json',
        };
        const request = (prefix: string) =>
          fetch(base + prefix + '/chat/completions', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: 'chat',
              messages: [{ role: 'user', content: 'private prompt' }],
              stream: true,
              max_tokens: 100,
            }),
          });
        for (const prefix of ['/v1', '/api/v1']) {
          const result = await request(prefix);
          assert.equal(result.status, 200);
          const content = await result.text();
          assert.ok(content.includes('private answer'));
          assert.ok(content.includes('"model":"chat"'));
          assert.ok(content.includes('"total_tokens":14'));
          assert.ok(content.includes('"prompt_tokens":11'));
          assert.ok(
            content.includes('"prompt_tokens_details":{"cached_tokens":5,"cache_write_tokens":4}'),
          );
          assert.ok(content.endsWith('data: [DONE]\n\n'));
        }
        assert.equal(secrets, 2);
        assert.equal(calls, 2);
        const records = await db.query<{ record: { usage: unknown } }>(
          'SELECT record FROM usage_records',
        );
        assert.equal(records.rows.length, 2);
        assert.ok(JSON.stringify(records.rows).includes('anthropic'));
        assert.ok(!JSON.stringify(records.rows).includes('private'));
        assert.doesNotMatch(JSON.stringify(records.rows), /cached_tokens|cache_write_tokens/u);
        assert.deepEqual(
          records.rows.map((row) => row.record.usage),
          [
            { status: 'reported', promptTokens: 11, completionTokens: 3, totalTokens: 14 },
            { status: 'reported', promptTokens: 11, completionTokens: 3, totalTokens: 14 },
          ],
        );
        for (const reason of ['usage', 'mid'] as const) {
          failure = reason;
          const result = await request('/v1');
          assert.equal(result.status, 200);
          const content = await result.text();
          assert.ok(content.includes('private answer'));
          assert.ok(!content.includes('[DONE]'));
          assert.ok(!content.includes('private database'));
          assert.ok(!content.includes('private provider error'));
        }
        failure = undefined;
        await db.exec(
          `INSERT INTO iam_policies VALUES ('deny','v1','[{"effect":"Deny","actions":["llm:UseProvider"],"resources":["provider:anthropic"]}]');INSERT INTO iam_principal_policies VALUES ('service','deny');`,
        );
        for (const prefix of ['/v1', '/api/v1']) {
          const result = await request(prefix);
          assert.equal(result.status, 403);
          await result.text();
        }
        assert.equal(secrets, 4);
        assert.equal(calls, 4);
        for (const path of ['/v1/usage', '/v1/audit']) {
          const result = await fetch(base + path, { headers });
          assert.equal(result.status, 200);
          const content = await result.text();
          assert.doesNotMatch(content, /cached_tokens|cache_write_tokens/u);
          for (const secret of [
            'private prompt',
            'private answer',
            'fixture-provider-key',
            issued.token,
          ])
            assert.ok(!content.includes(secret));
        }
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((e) => (e ? reject(e) : resolve())),
        );
      }
    } finally {
      await db.close();
    }
  });
