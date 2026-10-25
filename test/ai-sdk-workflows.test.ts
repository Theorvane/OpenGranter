import assert from 'node:assert/strict';
import test from 'node:test';
import { generateText, stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';
import { openCodeGatewayFixture } from '../scripts/opencode-gateway-fixture.ts';
import { aiSdkPrivacy, withAiSdkServer } from './ai-sdk-client-fixture.ts';
import { probabilityFixture, probabilityPrivacy } from './nonstream-logprobs-fixture.ts';

for (const base of ['/v1', '/api/v1'] as const)
  for (const kind of ['openrouter', 'openai', 'anthropic', 'google'] as const) {
    const route = kind === 'openrouter' ? 'delegated' : 'managed';
    const provider = kind === 'openrouter' ? 'openai' : kind;
    test(`AI SDK ${base} ${kind}: nonstream text over unchanged provider wire`, {
      timeout: 15000,
    }, async () => {
      const f = probabilityFixture(kind, undefined, {
        absent: true,
        ...(kind === 'google'
          ? {
              reply: () =>
                Response.json({
                  responseId: 'completion',
                  candidates: [{ content: { parts: [{ text: 'reply' }] }, finishReason: 'STOP' }],
                  usageMetadata: {
                    promptTokenCount: 2,
                    candidatesTokenCount: 1,
                    totalTokenCount: 3,
                  },
                }),
            }
          : {}),
      });
      await withAiSdkServer(f.ports, base, 'fixture-proxy-key', async (model) => {
        const result = await generateText({
          model,
          prompt: 'private prompt',
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(10000),
        });
        assert.equal(result.text, 'reply');
        assert.equal(result.usage.totalTokens, 3);
        assert.equal(result.finishReason, 'stop');
      });
      assert.equal(f.records.length, 1);
      assert.equal(f.records[0]?.usage.totalTokens, 3);
      probabilityPrivacy(f);
    });
    for (const tools of [false, true])
      test(`AI SDK ${base} ${kind}: streamed ${tools ? 'tool execution/result loop' : 'text'}`, {
        timeout: 15000,
      }, async () => {
        const f = openCodeGatewayFixture(tools ? 'tools' : 'text', route, provider);
        let executed = 0;
        await withAiSdkServer(f.ports, base, 'fixture-proxy-token', async (model) => {
          const result = streamText({
            model,
            prompt: 'private prompt',
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(10000),
            stopWhen: stepCountIs(2),
            onError: () => {},
            ...(tools
              ? {
                  tools: {
                    read: tool({
                      inputSchema: z.object({ filePath: z.literal('fixture.txt') }),
                      execute: async ({ filePath }) => {
                        assert.equal(filePath, 'fixture.txt');
                        executed++;
                        return 'fixture-tool-result';
                      },
                    }),
                  },
                }
              : {}),
          });
          for await (const part of result.fullStream) if (part.type === 'error') throw part.error;
          assert.equal(await result.text, 'fixture-final-answer');
          assert.equal((await result.steps).length, tools ? 2 : 1);
          assert.equal((await result.totalUsage).totalTokens, tools ? 10 : 5);
        });
        assert.equal(executed, tools ? 1 : 0);
        assert.equal(f.sent.length, tools ? 2 : 1);
        assert.equal(f.usage.length, tools ? 2 : 1);
        assert.ok(f.usage.every((r) => r.outcome === 'succeeded' && r.usage.totalTokens === 5));
        assert.equal(f.counts().authenticated, tools ? 2 : 1);
        assert.equal(f.counts().secrets, tools ? 2 : 1);
        aiSdkPrivacy(f.audit, f.usage);
      });
  }
