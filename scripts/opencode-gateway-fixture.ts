import assert from 'node:assert/strict';
import type { ChatHandlerPorts } from '../src/gateway/chat-handler.ts';
import { createOpenRouterFunctionStreamInvoker } from '../src/providers/openrouter-function-stream.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

export function openCodeGatewayFixture() {
  let authenticated = 0,
    secrets = 0;
  const sent: Record<string, unknown>[] = [],
    audit: unknown[] = [],
    usage: UsageRecord[] = [];
  const invoker = createOpenRouterFunctionStreamInvoker({
    credentialRef: 'secret/openrouter',
    resolveSecret: async () => {
      secrets++;
      return 'fixture-upstream-key';
    },
    fetcher: async (url, init) => {
      assert.equal(String(url), 'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(init?.redirect, 'error');
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      sent.push(body);
      assert.equal(body.model, 'openai/example');
      assert.deepEqual(body.provider, { only: ['OpenAI'] });
      assert.equal(body.stream, true);
      const frame = (delta: object, finish: string | null, extra = {}) =>
        `data: ${JSON.stringify({
          id: 'gen-fixture',
          object: 'chat.completion.chunk',
          created: 42,
          model: 'openai/example',
          choices: [{ index: 0, delta, finish_reason: finish }],
          ...extra,
        })}\n\n`;
      return new Response(
        frame({ role: 'assistant', content: 'fixture-final-answer' }, null) +
          frame({}, 'stop') +
          frame({}, 'stop', {
            usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
          }) +
          'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  const ports: ChatHandlerPorts<unknown> = {
    newRequestId: () => `req-${authenticated}`,
    authenticate: async (token) => {
      authenticated++;
      if (token !== 'fixture-proxy-token') return undefined;
      return {
        id: 'user',
        active: true,
        credentialId: 'proxy',
        policyVersions: [],
        statements: [
          { effect: 'Allow', actions: ['llm:InvokeModel', 'llm:UseProvider'], resources: ['*'] },
        ],
      };
    },
    resolveRoute: async () => ({
      kind: 'delegated',
      version: 'fixture-v1',
      credentialRef: 'secret/openrouter',
      candidates: [
        {
          id: 'candidate',
          kind: 'delegated',
          upstreamModelId: 'openai/example',
          providerId: 'openai',
        },
      ],
    }),
    resolveVerifiedProviderSlug: async () => 'OpenAI',
    checkLimit: async () => true,
    resolveSecret: async () => assert.fail('Unexpected direct credentials'),
    invokeDirect: async () => assert.fail('Unexpected direct invocation'),
    invokeOpenRouterFunctionStream: async (_ref, attempt, chat, onDelta, signal) =>
      invoker(attempt, chat, onDelta, signal),
    writeUsage: async (record) => {
      usage.push(record);
    },
    writeAudit: async (event) => {
      audit.push(event);
    },
  };
  return { ports, sent, audit, usage, counts: () => ({ authenticated, secrets }) };
}
