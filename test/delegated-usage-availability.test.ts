import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createOpenRouterChatInvoker } from '../src/providers/openrouter-chat.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

const scenarios = [
  {
    name: 'complete',
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    expected: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    status: 'reported',
    counts: [3, 2, 5],
  },
  {
    name: 'derived total',
    usage: { prompt_tokens: 3, completion_tokens: 2 },
    expected: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    status: 'reported',
    counts: [3, 2, 5],
  },
  {
    name: 'missing',
    usage: undefined,
    expected: undefined,
    status: 'missing',
    counts: [null, null, null],
  },
  {
    name: 'zero prompt only',
    usage: { prompt_tokens: 0 },
    expected: { prompt_tokens: 0 },
    status: 'partial',
    counts: [0, null, null],
  },
  {
    name: 'completion only',
    usage: { completion_tokens: 2 },
    expected: { completion_tokens: 2 },
    status: 'partial',
    counts: [null, 2, null],
  },
  {
    name: 'total only',
    usage: { total_tokens: 7 },
    expected: { total_tokens: 7 },
    status: 'partial',
    counts: [null, null, 7],
  },
  {
    name: 'invalid component',
    usage: { prompt_tokens: 'private-invalid-counter', completion_tokens: 2 },
    expected: { prompt_tokens: null, completion_tokens: 2 },
    status: 'invalid',
    counts: [null, null, null],
  },
  {
    name: 'invalid supplied total',
    usage: {
      prompt_tokens: 3,
      completion_tokens: 2,
      total_tokens: { private: 'private-invalid-counter' },
    },
    expected: { prompt_tokens: 3, completion_tokens: 2, total_tokens: null },
    status: 'invalid',
    counts: [null, null, null],
  },
  {
    name: 'invalid negative total',
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: -1 },
    expected: { prompt_tokens: 3, completion_tokens: 2, total_tokens: null },
    status: 'invalid',
    counts: [null, null, null],
  },
  {
    name: 'unsafe derived total',
    usage: { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 1 },
    expected: { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 1, total_tokens: null },
    status: 'invalid',
    counts: [null, null, null],
  },
] as const;

for (const scenario of scenarios) {
  test(`delegated gateway retains ${scenario.name} usage availability`, async () => {
    const records: UsageRecord[] = [];
    const audit: unknown[] = [];
    let upstreamCalls = 0;
    const invokeOpenRouter = createOpenRouterChatInvoker({
      credentialRef: 'fixture-ref',
      resolveSecret: async () => 'fixture-key',
      fetcher: async (_url, init) => {
        upstreamCalls++;
        assert.deepEqual(JSON.parse(String(init?.body)).provider, { only: ['OpenAI'] });
        return Response.json({
          id: 'generation',
          created: 100,
          model: 'openai/gpt',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' },
          ],
          usage: scenario.usage,
        });
      },
    });
    const handler = createChatHandler({
      newRequestId: () => 'delegated-usage',
      authenticate: async () => ({
        id: 'user',
        active: true,
        credentialId: 'credential',
        policyVersions: [],
        statements: [{ effect: 'Allow', actions: ['llm:*'], resources: ['*'] }],
      }),
      resolveRoute: async () => ({
        kind: 'delegated',
        version: 'v1',
        credentialRef: 'fixture-ref',
        candidates: [
          { id: 'one', kind: 'delegated', upstreamModelId: 'openai/gpt', providerId: 'openai' },
        ],
      }),
      resolveVerifiedProviderSlug: async () => 'OpenAI',
      checkLimit: async () => true,
      resolveSecret: async () => {
        throw new Error('unexpected direct secret');
      },
      invokeDirect: async () => {
        throw new Error('unexpected direct inference');
      },
      invokeOpenRouter: async (_ref, attempt, chat) => invokeOpenRouter(attempt, chat),
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
    const body = (await response.json()) as { usage?: unknown };
    assert.deepEqual(body.usage, scenario.expected);
    assert.equal(upstreamCalls, 1);
    assert.equal(records.length, 1);
    assert.deepEqual(records[0]?.usage, {
      status: scenario.status,
      promptTokens: scenario.counts[0],
      completionTokens: scenario.counts[1],
      totalTokens: scenario.counts[2],
    });
    assert.equal(records[0]?.routeKind, 'delegated');
    assert.equal(records[0]?.outcome, 'succeeded');
    assert.equal(
      JSON.stringify({ body, records, audit }).includes('private-invalid-counter'),
      false,
    );
  });
}
