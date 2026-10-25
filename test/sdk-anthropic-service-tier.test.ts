import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import { anthropicTierFixture, anthropicTierPrivacy } from './anthropic-service-tier-fixture.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';

for (const kind of ['anthropic'] as const)
  for (const base of ['/v1', '/api/v1'])
    for (const stream of [false, true])
      for (const mode of ['text', 'refusal', 'function'] as const)
        test(`${kind} ${base} ${mode} stream=${stream}: installed SDKs carry supported tiers and null omission`, async () => {
          const f = anthropicTierFixture({ stream, mode });
          const server = createNodeChatServer(f.ports);
          await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
          try {
            const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${base}`;
            const raw = new OpenAI({
              apiKey: 'fixture-proxy-key',
              baseURL: url,
              maxRetries: 0,
              timeout: 3000,
            });
            const compatible = new OpenRouter({
              apiKey: 'fixture-proxy-key',
              serverURL: url,
              retryConfig: { strategy: 'none' },
              timeoutMs: 3000,
            });
            for (const tier of ['auto', 'default', null] as const) {
              const fields = {
                model: 'chat',
                messages: [{ role: 'user' as const, content: 'private prompt' }],
                stream,
                ...(mode === 'function' ? { tools: probabilityTools } : {}),
              };
              const response = await raw.chat.completions.create({ ...fields, service_tier: tier });
              if (Symbol.asyncIterator in response) {
                for await (const _chunk of response) {
                }
              } else assert.equal(response.choices[0]?.message.role, 'assistant');
              const other = await compatible.chat.send({
                chatRequest: { ...fields, serviceTier: tier },
              });
              if (Symbol.asyncIterator in other) {
                for await (const _chunk of other) {
                }
              } else assert.ok('choices' in other);
              for (const body of f.sent.slice(-2)) {
                assert.equal(
                  body.service_tier,
                  tier === null ? undefined : tier === 'default' ? 'standard_only' : 'auto',
                );
                assert.equal(Object.hasOwn(body, 'service_tier'), tier !== null);
                assert.equal(body.model, 'upstream-model');
                assert.equal(body.max_tokens, 128);
              }
            }
            assert.equal(f.sent.length, 6);
            assert.equal(f.records.length, f.sent.length);
            anthropicTierPrivacy(f);
            assert.doesNotMatch(JSON.stringify([f.records, f.audits]), /service_tier|serviceTier/u);
          } finally {
            server.closeAllConnections();
            await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
          }
        });
