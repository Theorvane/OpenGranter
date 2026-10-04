import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import {
  probabilityFixture,
  probabilityGroups,
  probabilityPrivacy,
  probabilityTools,
} from './nonstream-logprobs-fixture.ts';

for (const kind of ['openai', 'openrouter'] as const)
  for (const base of ['/v1', '/api/v1'])
    for (const mode of ['text', 'refusal', 'function'] as const)
      test(`${kind} ${mode} probability data survives both actual SDKs ${base}`, async () => {
        const f = probabilityFixture(kind, probabilityGroups, { mode });
        const server = createNodeChatServer(f.ports);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        try {
          const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${base}`;
          const raw = new OpenAI({
            apiKey: 'fixture-proxy-key',
            baseURL: url,
            maxRetries: 0,
            timeout: 3000,
          });
          const result = await raw.chat.completions.create({
            model: 'chat',
            messages: [{ role: 'user', content: 'private prompt' }],
            logprobs: true,
            top_logprobs: 20,
            ...(mode === 'function' ? { tools: probabilityTools } : {}),
          });
          assert.deepEqual(result.choices[0]?.logprobs, probabilityGroups);
          const client = new OpenRouter({
            apiKey: 'fixture-proxy-key',
            serverURL: url,
            retryConfig: { strategy: 'none' },
            timeoutMs: 3000,
          });
          const compatible = await client.chat.send({
            chatRequest: {
              model: 'chat',
              messages: [{ role: 'user', content: 'private prompt' }],
              logprobs: true,
              topLogprobs: 20,
              stream: false,
              ...(mode === 'function' ? { tools: probabilityTools } : {}),
            },
          });
          assert.ok('choices' in compatible);
          assert.deepEqual(compatible.choices[0]?.logprobs, {
            content: probabilityGroups.content.map(({ top_logprobs, ...token }) => ({
              ...token,
              topLogprobs: top_logprobs,
            })),
            refusal: null,
          });
          assert.equal(f.sent.length, 2);
          assert.ok(f.sent.every((body) => body.logprobs === true && body.top_logprobs === 20));
          assert.equal(f.records.length, 2);
          assert.ok(f.records.every((r) => r.outcome === 'succeeded' && r.usage.totalTokens === 3));
          probabilityPrivacy(f);
        } finally {
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) =>
            server.close((e) => (e ? reject(e) : resolve())),
          );
        }
      });
