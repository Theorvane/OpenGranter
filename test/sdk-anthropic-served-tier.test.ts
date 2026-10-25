import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import { servedTierFixture, servedTierPrivacy } from './anthropic-served-tier-fixture.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';

for (const base of ['/v1', '/api/v1'])
  for (const stream of [false, true])
    for (const mode of ['text', 'refusal', 'function'] as const)
      test(`Anthropic ${base} ${mode} stream=${stream}: actual SDKs preserve reported tier without enum narrowing`, async () => {
        for (const tier of ['standard', 'priority', 'batch', 'future-tier', null, undefined]) {
          const f = servedTierFixture({ stream, mode, ...(tier === undefined ? {} : { tier }) });
          const server = createNodeChatServer(f.ports);
          await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
          try {
            const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${base}`;
            const fields = {
              model: 'chat',
              messages: [{ role: 'user' as const, content: 'private prompt' }],
              stream,
              ...(mode === 'function' ? { tools: probabilityTools } : {}),
            };
            const raw = new OpenAI({
              apiKey: 'fixture-proxy-key',
              baseURL: url,
              maxRetries: 0,
              timeout: 3000,
            });
            const result = await raw.chat.completions.create(fields);
            if (Symbol.asyncIterator in result) {
              const chunks = [];
              for await (const c of result) chunks.push(c);
              assert.equal(chunks.at(-1)?.service_tier, tier);
            } else assert.equal(result.service_tier, tier);
            const client = new OpenRouter({
              apiKey: 'fixture-proxy-key',
              serverURL: url,
              retryConfig: { strategy: 'none' },
              timeoutMs: 3000,
            });
            const other = await client.chat.send({ chatRequest: fields });
            if (Symbol.asyncIterator in other) {
              const chunks = [];
              for await (const c of other) chunks.push(c);
              assert.equal(chunks.at(-1)?.serviceTier, tier);
            } else {
              assert.ok('choices' in other);
              assert.equal(other.serviceTier, tier);
            }
            assert.equal(f.records.length, 2);
            assert.ok(f.records.every((r) => r.usage.totalTokens === 5));
            servedTierPrivacy(f);
          } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
              server.close((e) => (e ? reject(e) : resolve())),
            );
          }
        }
      });
