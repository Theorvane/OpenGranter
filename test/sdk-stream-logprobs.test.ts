import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import {
  probabilityGroups,
  probabilityPrivacy,
  probabilityTools,
} from './nonstream-logprobs-fixture.ts';
import { finalProbabilities, streamProbabilityFixture } from './stream-logprobs-fixture.ts';

function camelGroups(groups: typeof probabilityGroups) {
  return {
    content: groups.content.map(({ top_logprobs, ...token }) => ({
      ...token,
      topLogprobs: top_logprobs,
    })),
    refusal: null,
  };
}
for (const kind of ['openai', 'openrouter'] as const)
  for (const base of ['/v1', '/api/v1'])
    for (const mode of ['text', 'refusal', 'function'] as const)
      for (const missingUsage of [false, true])
        test(`${kind} ${mode}: streamed probabilities survive both actual SDK sockets ${base} missingUsage=${missingUsage}`, async () => {
          const f = streamProbabilityFixture(kind, { mode, missingUsage }),
            server = createNodeChatServer(f.ports);
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
              stream: true,
              stream_options: { include_usage: true },
              ...(mode === 'function' ? { tools: probabilityTools } : {}),
            });
            const chunks = [];
            for await (const chunk of result) chunks.push(chunk);
            assert.equal(chunks.length, missingUsage && kind === 'openai' ? 2 : 3);
            assert.deepEqual(chunks[0]?.choices[0]?.logprobs, probabilityGroups);
            assert.equal(chunks[1]?.choices[0]?.logprobs, null);
            assert.deepEqual(
              chunks[2]?.choices[0]?.logprobs,
              kind === 'openrouter' ? finalProbabilities : undefined,
            );
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
                stream: true,
                streamOptions: { includeUsage: true },
                ...(mode === 'function' ? { tools: probabilityTools } : {}),
              },
            });
            assert.ok(Symbol.asyncIterator in compatible);
            const frames = [];
            for await (const chunk of compatible) frames.push(chunk);
            assert.equal(frames.length, missingUsage && kind === 'openai' ? 2 : 3);
            assert.deepEqual(frames[0]?.choices[0]?.logprobs, camelGroups(probabilityGroups));
            assert.equal(frames[1]?.choices[0]?.logprobs, null);
            assert.deepEqual(
              frames[2]?.choices[0]?.logprobs,
              kind === 'openrouter' ? camelGroups(finalProbabilities) : undefined,
            );
            assert.equal(f.sent.length, 2);
            assert.ok(f.sent.every((body) => body.logprobs === true && body.top_logprobs === 20));
            assert.equal(f.records.length, 2);
            assert.ok(
              f.records.every(
                (r) =>
                  r.outcome === 'succeeded' && r.usage.totalTokens === (missingUsage ? null : 3),
              ),
            );
            probabilityPrivacy(f);
          } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
              server.close((e) => (e ? reject(e) : resolve())),
            );
          }
        });
