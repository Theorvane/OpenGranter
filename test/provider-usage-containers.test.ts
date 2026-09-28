import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import { createOpenRouterChatInvoker } from '../src/providers/openrouter-chat.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

const scenarios = [
  { name: 'string', value: 'private-container-value', invalid: true },
  {
    name: 'array',
    value: [{ content: 'private-container-value', prompt_tokens: 2 }],
    invalid: true,
  },
  { name: 'number', value: 1, invalid: true },
  { name: 'boolean', value: false, invalid: true },
  { name: 'absent', value: undefined, invalid: false },
  { name: 'null', value: null, invalid: false },
  { name: 'empty object', value: {}, invalid: false },
  { name: 'unrecognized object', value: { extra: 'private-container-value' }, invalid: false },
] as const;

for (const kind of ['openai', 'anthropic', 'google', 'openrouter'] as const) {
  for (const scenario of scenarios) {
    test(`${kind} gateway classifies ${scenario.name} usage container`, async () => {
      const records: UsageRecord[] = [];
      const audit: unknown[] = [];
      const body =
        kind === 'anthropic'
          ? {
              content: [{ type: 'text', text: 'Hi' }],
              stop_reason: 'end_turn',
              usage: scenario.value,
            }
          : kind === 'google'
            ? {
                candidates: [{ content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' }],
                usageMetadata: scenario.value,
              }
            : {
                id: 'generation',
                created: 100,
                model: 'openai/gpt',
                choices: [
                  {
                    index: 0,
                    message: { role: 'assistant', content: 'Hi' },
                    finish_reason: 'stop',
                  },
                ],
                usage: scenario.value,
              };
      const fetcher: typeof fetch = async () => Response.json(body);
      const resolveSecret = async () => 'fixture-key';
      const invokeDirect = createDirectChatInvoker({
        registrations:
          kind === 'openrouter'
            ? []
            : [
                {
                  providerId: 'provider',
                  kind,
                  credentialRef: 'fixture-ref',
                  maxOutputTokens: 128,
                },
              ],
        resolveSecret,
        fetcher,
      });
      const invokeDelegated = createOpenRouterChatInvoker({
        credentialRef: 'fixture-ref',
        resolveSecret,
        fetcher,
      });
      const handler = createChatHandler({
        newRequestId: () => 'container-request',
        authenticate: async () => ({
          id: 'user',
          active: true,
          credentialId: 'credential',
          policyVersions: [],
          statements: [{ effect: 'Allow', actions: ['llm:*'], resources: ['*'] }],
        }),
        resolveRoute: async () =>
          kind === 'openrouter'
            ? {
                kind: 'delegated',
                version: 'v1',
                credentialRef: 'fixture-ref',
                candidates: [
                  {
                    id: 'one',
                    kind: 'delegated',
                    upstreamModelId: 'openai/gpt',
                    providerId: 'provider',
                  },
                ],
              }
            : {
                version: 'v1',
                candidates: [
                  {
                    id: 'one',
                    kind: 'managed',
                    upstreamModelId: 'upstream',
                    providerId: 'provider',
                  },
                ],
              },
        resolveVerifiedProviderSlug: async () => 'OpenAI',
        checkLimit: async () => true,
        resolveSecret,
        invokeDirect,
        invokeOpenRouter: async (_ref, attempt, request) => invokeDelegated(attempt, request),
        writeUsage: async (record) => {
          records.push(record);
        },
        writeAudit: async (event) => {
          audit.push(event);
        },
      });
      const response = await handler(
        new Request('http://localhost/v1/chat/completions', {
          method: 'POST',
          headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'chat', messages: [{ role: 'user', content: 'Hello' }] }),
        }),
      );
      assert.equal(response.status, 200);
      const normalized = (await response.json()) as { usage?: unknown };
      assert.deepEqual(normalized.usage, scenario.invalid ? { total_tokens: null } : undefined);
      assert.equal(records.length, 1);
      assert.deepEqual(records[0]?.usage, {
        status: scenario.invalid ? 'invalid' : 'missing',
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      });
      assert.equal(records[0]?.outcome, 'succeeded');
      assert.equal(
        JSON.stringify({ normalized, records, audit }).includes('private-container-value'),
        false,
      );
    });
  }
}
