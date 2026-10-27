import assert from 'node:assert/strict';
import test from 'node:test';
import { generateText } from 'ai';
import { withAiSdkServer } from './ai-sdk-client-fixture.ts';
import { probabilityFixture, probabilityPrivacy } from './nonstream-logprobs-fixture.ts';

for (const base of ['/v1', '/api/v1'] as const) {
  for (const kind of ['openrouter', 'openai', 'anthropic', 'google'] as const)
    test(`AI SDK ${base} ${kind}: client zero defaults do not invent missing ledger usage`, async () => {
      const f = probabilityFixture(kind, undefined, {
        absent: true,
        missingUsage: true,
        ...(kind === 'anthropic'
          ? {
              reply: () =>
                Response.json({
                  id: 'completion',
                  stop_reason: 'end_turn',
                  content: [{ type: 'text', text: 'reply' }],
                }),
            }
          : {}),
        ...(kind === 'google'
          ? {
              reply: () =>
                Response.json({
                  responseId: 'completion',
                  candidates: [{ content: { parts: [{ text: 'reply' }] }, finishReason: 'STOP' }],
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
        assert.equal(result.usage.totalTokens, 0);
      });
      assert.equal(f.records[0]?.usage.status, 'missing');
      assert.equal(f.records[0]?.usage.totalTokens, null);
      probabilityPrivacy(f);
    });
  test(`AI SDK ${base}: incomplete native Google usage permits text without inventing ledger totals`, async () => {
    const f = probabilityFixture('google', undefined, { absent: true });
    await withAiSdkServer(f.ports, base, 'fixture-proxy-key', async (model) => {
      const result = await generateText({
        model,
        prompt: 'private prompt',
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(10000),
      });
      assert.equal(result.text, 'reply');
      assert.equal(result.usage.totalTokens, 0);
    });
    assert.equal(f.records[0]?.outcome, 'succeeded');
    assert.equal(f.records[0]?.usage.status, 'partial');
    assert.equal(f.records[0]?.usage.promptTokens, 2);
    assert.equal(f.records[0]?.usage.completionTokens, 1);
    assert.equal(f.records[0]?.usage.totalTokens, null);
    probabilityPrivacy(f);
  });
}
