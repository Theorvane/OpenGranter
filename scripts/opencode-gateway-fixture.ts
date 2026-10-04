import assert from 'node:assert/strict';
import type { ChatHandlerPorts } from '../src/gateway/chat-handler.ts';
import type { DirectChatPorts } from '../src/providers/direct-chat.ts';
import { createDirectOpenAIFunctionStreamInvoker } from '../src/providers/direct-openai-function-stream.ts';
import { createOpenRouterFunctionStreamInvoker } from '../src/providers/openrouter-function-stream.ts';
import type { RouteKind } from '../src/routing/authorize-candidates.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

export type OpenCodeFixtureMode = 'text' | 'tools' | 'model-deny' | 'provider-deny' | 'cancel';
export function openCodeGatewayFixture(
  mode: OpenCodeFixtureMode = 'text',
  routeKind: RouteKind = 'delegated',
) {
  let authenticated = 0,
    secrets = 0,
    limits = 0,
    aborted = false;
  const sent: Record<string, unknown>[] = [],
    audit: unknown[] = [],
    usage: UsageRecord[] = [];
  const upstreamPorts: Pick<DirectChatPorts, 'resolveSecret' | 'fetcher' | 'timeoutMs'> = {
    timeoutMs: 15000,
    resolveSecret: async () => {
      secrets++;
      return 'fixture-upstream-key';
    },
    fetcher: async (url, init) => {
      assert.equal(
        String(url),
        routeKind === 'managed'
          ? 'https://api.openai.com/v1/chat/completions'
          : 'https://openrouter.ai/api/v1/chat/completions',
      );
      assert.equal(init?.redirect, 'error');
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      sent.push(body);
      assert.equal(body.model, routeKind === 'managed' ? 'gpt-exact' : 'openai/example');
      if (routeKind === 'managed') {
        assert.equal(body.provider, undefined);
        assert.deepEqual(body.stream_options, { include_usage: true });
      } else assert.deepEqual(body.provider, { only: ['OpenAI'] });
      assert.equal(body.stream, true);
      const frame = (delta: object, finish: string | null, extra = {}) =>
        `data: ${JSON.stringify({
          id: 'gen-fixture',
          object: 'chat.completion.chunk',
          created: 42,
          model: routeKind === 'managed' ? 'gpt-exact' : 'openai/example',
          choices: [{ index: 0, delta, finish_reason: finish }],
          ...(routeKind === 'managed' ? { usage: null } : {}),
          ...extra,
        })}\n\n`;
      if (mode === 'cancel') {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  frame({ role: 'assistant', content: 'fixture-partial' }, null),
                ),
              );
              init?.signal?.addEventListener(
                'abort',
                () => {
                  aborted = true;
                  controller.error(new Error('fixture transport interrupted'));
                },
                { once: true },
              );
            },
            cancel() {
              aborted = true;
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      }
      const history = body.messages as { role: string; tool_call_id?: string; content?: string }[];
      const answered = history.some((message) => message.role === 'tool');
      const toolTurn =
        mode === 'tools' && Array.isArray(body.tools) && body.tools.length > 0 && !answered;
      if (answered) {
        const result = history.find((message) => message.role === 'tool');
        assert.equal(result?.tool_call_id, 'call_read');
        assert.ok(result.content?.includes('fixture-tool-result'));
      }
      const finish = toolTurn ? 'tool_calls' : 'stop';
      const delta = toolTurn
        ? frame(
            {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_read',
                  type: 'function',
                  function: { name: 'read', arguments: '{"filePath":' },
                },
              ],
            },
            null,
          ) + frame({ tool_calls: [{ index: 0, function: { arguments: '"fixture.txt"}' } }] }, null)
        : frame({ role: 'assistant', content: 'fixture-final-answer' }, null);
      return new Response(
        delta +
          frame({}, finish) +
          frame({}, finish, {
            ...(routeKind === 'managed' ? { choices: [] } : {}),
            usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
          }) +
          'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  };
  const invoker = createOpenRouterFunctionStreamInvoker({
    ...upstreamPorts,
    credentialRef: 'secret/openrouter',
  });
  const native = createDirectOpenAIFunctionStreamInvoker({
    ...upstreamPorts,
    registrations: [{ providerId: 'openai', kind: 'openai', credentialRef: 'secret/openai' }],
  });
  const delegated: NonNullable<
    ChatHandlerPorts<unknown>['invokeOpenRouterFunctionStream']
  > = async (_ref, attempt, chat, onDelta, signal) => invoker(attempt, chat, onDelta, signal);
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
          ...(mode === 'model-deny' || mode === 'provider-deny'
            ? [
                {
                  effect: 'Deny' as const,
                  actions: [mode === 'model-deny' ? 'llm:InvokeModel' : 'llm:UseProvider'],
                  resources: ['*'],
                },
              ]
            : []),
        ],
      };
    },
    resolveRoute: async () =>
      routeKind === 'managed'
        ? {
            kind: 'managed' as const,
            version: 'fixture-v1',
            candidates: [
              {
                id: 'candidate',
                kind: 'managed' as const,
                upstreamModelId: 'gpt-exact',
                providerId: 'openai',
              },
            ],
          }
        : {
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
          },
    resolveVerifiedProviderSlug: async () => 'OpenAI',
    checkLimit: async () => {
      limits++;
      return true;
    },
    resolveSecret: async () => assert.fail('Unexpected direct credentials'),
    invokeDirect: async () => assert.fail('Unexpected direct invocation'),
    ...(routeKind === 'managed'
      ? { invokeDirectFunctionStream: native }
      : { invokeOpenRouterFunctionStream: delegated }),
    writeUsage: async (record) => {
      usage.push(record);
    },
    writeAudit: async (event) => {
      audit.push(event);
    },
  };
  return { ports, sent, audit, usage, counts: () => ({ authenticated, secrets, limits, aborted }) };
}
