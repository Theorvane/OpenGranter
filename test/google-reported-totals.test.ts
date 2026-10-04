import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

for (const base of ['/v1', '/api/v1'])
  for (const outcome of ['text', 'prompt-safety', 'candidate-safety'] as const)
    for (const reported of [false, true])
      test(`Gemini nonstream ${base} ${outcome} preserves ${reported ? 'reported' : 'missing'} total including hidden thinking`, async () => {
        const records: UsageRecord[] = [],
          audits: unknown[] = [];
        let keys = 0,
          calls = 0;
        const completion = outcome === 'prompt-safety' ? 0 : 2,
          total = outcome === 'prompt-safety' ? 3 : 7;
        const body = {
          responseId: 'native',
          modelVersion: 'gemini-exact',
          ...(outcome === 'prompt-safety'
            ? { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }
            : {
                candidates: [
                  {
                    index: 0,
                    content: {
                      role: 'model',
                      parts: outcome === 'text' ? [{ text: 'private answer' }] : [],
                    },
                    finishReason: outcome === 'text' ? 'STOP' : 'SAFETY',
                  },
                ],
              }),
          usageMetadata: {
            promptTokenCount: 3,
            candidatesTokenCount: completion,
            thoughtsTokenCount: completion,
            ...(reported ? { totalTokenCount: total } : {}),
          },
        };
        const handler = createChatHandler({
          newRequestId: () => 'request',
          authenticate: async () => ({
            id: 'principal',
            active: true,
            credentialId: 'credential',
            policyVersions: [],
            statements: [{ effect: 'Allow', actions: ['llm:*'], resources: ['*'] }],
          }),
          resolveRoute: async () => ({
            kind: 'managed',
            version: 'v1',
            candidates: [
              { id: 'one', kind: 'managed', providerId: 'google', upstreamModelId: 'gemini-exact' },
            ],
          }),
          checkLimit: async () => true,
          resolveSecret: async () => {
            assert.fail('unexpected Jev key');
          },
          invokeDirect: createDirectChatInvoker({
            registrations: [
              { providerId: 'google', kind: 'google', credentialRef: 'secret/google' },
            ],
            resolveSecret: async () => {
              keys++;
              return 'fixture-provider-key';
            },
            fetcher: async (url, init) => {
              calls++;
              assert.equal(
                String(url),
                'https://generativelanguage.googleapis.com/v1beta/models/gemini-exact:generateContent',
              );
              assert.equal(
                new Headers(init?.headers).get('x-goog-api-key'),
                'fixture-provider-key',
              );
              return Response.json(body);
            },
          }),
          writeUsage: async (record) => {
            records.push(record);
          },
          writeAudit: async (event) => {
            audits.push(event);
          },
        });
        const response = await handler(
          new Request(`http://gateway${base}/chat/completions`, {
            method: 'POST',
            headers: { authorization: 'Bearer proxy', 'content-type': 'application/json' },
            body: JSON.stringify({
              model: 'chat',
              messages: [{ role: 'user', content: 'private prompt' }],
            }),
          }),
        );
        assert.equal(response.status, 200);
        const result = (await response.json()) as {
          usage: Record<string, unknown>;
          choices: { finish_reason: string }[];
        };
        assert.equal(
          result.choices[0]?.finish_reason,
          outcome === 'text' ? 'stop' : 'content_filter',
        );
        assert.deepEqual(
          result.usage,
          base === '/api/v1' && !reported
            ? undefined
            : {
                prompt_tokens: 3,
                completion_tokens: completion,
                ...(reported ? { total_tokens: total } : {}),
              },
        );
        assert.equal(records.length, 1);
        assert.deepEqual(records[0]?.usage, {
          status: reported ? 'reported' : 'partial',
          promptTokens: 3,
          completionTokens: completion,
          totalTokens: reported ? total : null,
        });
        assert.equal(records[0]?.actualInferenceProviderId, 'google');
        assert.equal(records[0]?.outcome, 'succeeded');
        assert.equal(records[0]?.upstreamBilledCost, null);
        assert.equal(records[0]?.estimatedCost, null);
        assert.equal(keys, 1);
        assert.equal(calls, 1);
        for (const privateValue of ['private prompt', 'private answer', 'fixture-provider-key'])
          assert.ok(!JSON.stringify([...records, ...audits]).includes(privateValue));
      });
