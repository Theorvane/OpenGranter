import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import {
  geminiProbabilityFixture,
  geminiProbabilityGroups,
  nativeProbabilityResult,
} from './gemini-logprobs-fixture.ts';
import { probabilityPrivacy, probabilityTools } from './nonstream-logprobs-fixture.ts';

for (const base of ['/v1', '/api/v1'])
  for (const mode of ['text', 'function', 'signed', 'candidate-safety', 'prompt-safety'] as const)
    for (const missingUsage of [false, true])
      test(`Gemini ${mode}: nonstream probability data survives both actual SDKs ${base}, missingUsage=${missingUsage}`, async () => {
        const f = geminiProbabilityFixture(nativeProbabilityResult, { mode, missingUsage }),
          server = createNodeChatServer(f.ports);
        const functions = mode === 'function' || mode === 'signed',
          safety = mode.includes('safety');
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
            ...(functions ? { tools: probabilityTools } : {}),
          });
          assert.deepEqual(
            result.choices[0]?.logprobs,
            safety ? undefined : geminiProbabilityGroups,
          );
          assert.equal(result.usage?.total_tokens, missingUsage ? undefined : 3);
          if (mode === 'signed') {
            const extra = result.choices[0]?.message.tool_calls?.[0] as unknown as {
              extra_content?: { google: { thought_signature: string } };
            };
            assert.equal(extra.extra_content?.google.thought_signature, 'private-signature');
          }
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
              ...(functions ? { tools: probabilityTools } : {}),
            },
          });
          assert.ok('choices' in compatible);
          assert.deepEqual(
            compatible.choices[0]?.logprobs,
            safety
              ? undefined
              : {
                  content: geminiProbabilityGroups.content.map(({ top_logprobs, ...token }) => ({
                    ...token,
                    topLogprobs: top_logprobs,
                  })),
                },
          );
          assert.equal(compatible.usage?.totalTokens, missingUsage ? undefined : 3);
          if (mode === 'signed')
            assert.equal(
              Object.hasOwn(compatible.choices[0]?.message.toolCalls?.[0] ?? {}, 'extraContent'),
              false,
            );
          assert.equal(f.sent.length, 2);
          assert.ok(
            f.sent.every((body) => {
              const config = body.generationConfig as Record<string, unknown>;
              return config.responseLogprobs === true && config.logprobs === 20;
            }),
          );
          assert.equal(f.records.length, 2);
          assert.ok(
            f.records.every(
              (r) => r.outcome === 'succeeded' && r.usage.totalTokens === (missingUsage ? null : 3),
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
