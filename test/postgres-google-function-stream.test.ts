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
import { frames, native } from './google-function-stream-fixture.ts';

const directory = new URL('../migrations/', import.meta.url);
const sources = await Promise.all(
  (await readdir(directory)).sort().map(async (name) => ({
    version: name.slice(0, 3),
    sql: await readFile(new URL(name, directory), 'utf8'),
  })),
);
for (const mode of ['direct', 'dual'] as const)
  test(`persisted ${mode} generated Gemini function streams enforce both bases, failures and fresh provider Deny`, async () => {
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
 INSERT INTO iam_policies VALUES ('allow','v1','[{"effect":"Allow","actions":["llm:InvokeModel","llm:UseProvider","usage:ReadSelf","audit:Read"],"resources":["model:chat","provider:google","principal:service"]}]');
 INSERT INTO iam_principal_policies VALUES ('service','allow');
 INSERT INTO catalog_models VALUES ('chat',1000,true,NULL);
 INSERT INTO catalog_routes (route_id,alias,kind,version,candidates) VALUES ('route','chat','managed','v1','[{"id":"one","kind":"managed","providerId":"google","upstreamModelId":"gemini-exact"}]');
 UPDATE catalog_models SET active_route_id='route' WHERE alias='chat';
 INSERT INTO direct_provider_registrations VALUES ('google','google','secret/google',true,50);
 `);
      let failure: 'usage' | 'malformed' | undefined,
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
          assert.equal(ref, 'secret/google');
          return 'fixture-provider-key';
        },
        fetcher: async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          calls++;
          assert.equal(
            String(url),
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-exact:streamGenerateContent?alt=sse',
          );
          const body = JSON.parse(String(init?.body));
          assert.equal(body.model, undefined);
          assert.equal(body.stream, undefined);
          assert.deepEqual(body.toolConfig, { functionCallingConfig: { mode: 'ANY' } });
          assert.deepEqual(body.tools, [
            {
              functionDeclarations: [
                { name: 'lookup', description: '', parametersJsonSchema: { type: 'object' } },
              ],
            },
          ]);
          assert.equal(body.contents[2].parts[0].functionResponse.id, 'prior');
          assert.equal(body.generationConfig.maxOutputTokens, 50);
          const events: object[] = native();
          events[events.length - 1] = {
            ...events[events.length - 1],
            usageMetadata: {
              promptTokenCount: 2,
              candidatesTokenCount: 3,
              totalTokenCount: 7,
              cachedContentTokenCount: 1,
              thoughtsTokenCount: 2,
            },
          };
          if (failure === 'malformed')
            events[events.length - 1] = { error: { message: 'private upstream' } };
          return new Response(frames(events), { headers: { 'content-type': 'text/event-stream' } });
        },
        invokeDirectFunctionStream: async () => {
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
              stream: true,
              messages: [
                { role: 'user', content: 'private prompt' },
                {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'prior',
                      type: 'function',
                      function: { name: 'lookup', arguments: '{}' },
                    },
                  ],
                },
                { role: 'tool', tool_call_id: 'prior', content: 'private result' },
              ],
              tools: [
                { type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } },
              ],
              tool_choice: 'required',
              max_tokens: 100,
            }),
          });
        for (const prefix of ['/v1', '/api/v1']) {
          const result = await request(prefix);
          assert.equal(result.status, 200);
          const content = await result.text();
          assert.ok(content.includes('private 終'));
          assert.ok(content.includes('"model":"chat"'));
          assert.ok(content.includes('"prompt_tokens_details":{"cached_tokens":1}'));
          assert.ok(content.includes('"completion_tokens_details":{"reasoning_tokens":2}'));
          assert.ok(content.includes('"total_tokens":7'));
          assert.ok(content.includes('tool_calls'));
        }
        assert.equal(secrets, 2);
        assert.equal(calls, 2);
        const records = await db.query('SELECT record FROM usage_records');
        assert.equal(records.rows.length, 2);
        assert.ok(JSON.stringify(records.rows).includes('google'));
        assert.ok(!JSON.stringify(records.rows).includes('private'));
        assert.doesNotMatch(JSON.stringify(records.rows), /cached_tokens|reasoning_tokens/u);
        for (const reason of ['usage', 'malformed'] as const) {
          failure = reason;
          const result = await request('/v1');
          assert.equal(result.status, 200);
          const content = await result.text();
          assert.ok(!content.includes('[DONE]'));
          assert.ok(!content.includes('"total_tokens"'));
          assert.ok(!content.includes('private database'));
          assert.ok(!content.includes('private provider error'));
        }
        failure = undefined;
        await db.exec(
          `INSERT INTO iam_policies VALUES ('deny','v1','[{"effect":"Deny","actions":["llm:UseProvider"],"resources":["provider:google"]}]');INSERT INTO iam_principal_policies VALUES ('service','deny');`,
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
          assert.doesNotMatch(content, /cached_tokens|reasoning_tokens/u);
          for (const secret of [
            'private prompt',
            'private 終',
            'private result',
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
