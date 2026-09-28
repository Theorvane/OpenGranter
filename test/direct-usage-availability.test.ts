import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

const cases = [
  {
    name: 'complete',
    p: 3,
    c: 2,
    t: 5,
    normalized: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    status: 'reported',
    counts: [3, 2, 5],
  },
  { name: 'missing', normalized: undefined, status: 'missing', counts: [null, null, null] },
  {
    name: 'prompt zero only',
    p: 0,
    normalized: { prompt_tokens: 0 },
    status: 'partial',
    counts: [0, null, null],
  },
  {
    name: 'completion only',
    c: 2,
    normalized: { completion_tokens: 2 },
    status: 'partial',
    counts: [null, 2, null],
  },
  {
    name: 'total only',
    t: 7,
    normalized: { total_tokens: 7 },
    status: 'partial',
    counts: [null, null, 7],
  },
  {
    name: 'invalid component',
    p: 'private-invalid-counter',
    c: 2,
    normalized: { prompt_tokens: null, completion_tokens: 2 },
    status: 'invalid',
    counts: [null, null, null],
  },
  {
    name: 'invalid total',
    p: 3,
    c: 2,
    t: { content: 'private-invalid-counter' },
    normalized: { prompt_tokens: 3, completion_tokens: 2, total_tokens: null },
    status: 'invalid',
    counts: [null, null, null],
  },
  {
    name: 'unsafe sum',
    p: Number.MAX_SAFE_INTEGER,
    c: 1,
    normalized: {
      prompt_tokens: Number.MAX_SAFE_INTEGER,
      completion_tokens: 1,
      total_tokens: null,
    },
    status: 'invalid',
    counts: [null, null, null],
  },
] as const;

for (const kind of ['openai', 'anthropic', 'google'] as const) {
  for (const scenario of cases) {
    if (kind === 'anthropic' && ['total only', 'invalid total'].includes(scenario.name)) continue;
    test(`${kind} gateway preserves ${scenario.name} usage availability`, async () => {
      const values = scenario as { p?: unknown; c?: unknown; t?: unknown };
      const responseBody =
        kind === 'openai'
          ? {
              choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
              usage: {
                prompt_tokens: values.p,
                completion_tokens: values.c,
                total_tokens: values.t,
              },
            }
          : kind === 'anthropic'
            ? {
                content: [{ type: 'text', text: 'Hi' }],
                stop_reason: 'end_turn',
                usage: { input_tokens: values.p, output_tokens: values.c },
              }
            : {
                candidates: [{ content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' }],
                usageMetadata: {
                  promptTokenCount: values.p,
                  candidatesTokenCount: values.c,
                  totalTokenCount: values.t,
                },
              };
      const invokeDirect = createDirectChatInvoker({
        registrations: [
          { providerId: 'provider', kind, credentialRef: 'fixture-ref', maxOutputTokens: 128 },
        ],
        resolveSecret: async () => 'fixture-key',
        fetcher: async () => Response.json(responseBody),
      });
      const records: UsageRecord[] = [];
      const audit: unknown[] = [];
      const handler = createChatHandler({
        newRequestId: () => 'usage-request',
        authenticate: async () => ({
          id: 'user',
          active: true,
          credentialId: 'credential',
          policyVersions: [],
          statements: [{ effect: 'Allow', actions: ['llm:*'], resources: ['*'] }],
        }),
        resolveRoute: async () => ({
          version: 'v1',
          candidates: [
            { id: 'one', kind: 'managed', upstreamModelId: 'upstream', providerId: 'provider' },
          ],
        }),
        checkLimit: async () => true,
        resolveSecret: async () => 'fixture-key',
        writeUsage: async (record) => {
          records.push(record);
        },
        writeAudit: async (event) => {
          audit.push(event);
        },
        invokeDirect,
      });
      const response = await handler(
        new Request('http://localhost/v1/chat/completions', {
          method: 'POST',
          headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'chat', messages: [{ role: 'user', content: 'Hello' }] }),
        }),
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as { usage?: unknown };
      assert.deepEqual(body.usage, scenario.normalized);
      assert.equal(records.length, 1);
      assert.deepEqual(records[0]?.usage, {
        status: scenario.status,
        promptTokens: scenario.counts[0],
        completionTokens: scenario.counts[1],
        totalTokens: scenario.counts[2],
      });
      assert.equal(records[0]?.outcome, 'succeeded');
      assert.equal(
        JSON.stringify({ body, records, audit }).includes('private-invalid-counter'),
        false,
      );
    });
  }
}
