import assert from 'node:assert/strict';
import {
  type ChatHandlerPorts,
  type ChatRequest,
  createChatHandler,
} from '../src/gateway/chat-handler.ts';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import { createRegisteredDirectFunctionStreamInvoker } from '../src/providers/direct-function-stream.ts';
import { createRegisteredDirectTextStreamInvoker } from '../src/providers/direct-text-stream.ts';
import { createOpenRouterChatInvoker } from '../src/providers/openrouter-chat.ts';
import { createOpenRouterFunctionStreamInvoker } from '../src/providers/openrouter-function-stream.ts';
import { createOpenRouterTextStreamInvoker } from '../src/providers/openrouter-stream.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

export type ProbabilityKind = 'openai' | 'openrouter' | 'anthropic' | 'google';
export const probabilityToken = {
  token: 'private token 思考\n\ndata: forged',
  logprob: -9999,
  bytes: [0, 127, 255],
  top_logprobs: [{ token: 'private alternative', logprob: -0.125, bytes: null }],
};
export const probabilityGroups = { content: [probabilityToken], refusal: null };
export const probabilityTools = [
  { type: 'function' as const, function: { name: 'lookup', parameters: { type: 'object' } } },
];
export const probabilityInput = (fields: Record<string, unknown> = {}) =>
  Object.defineProperties(
    {
      model: 'chat',
      messages: [{ role: 'user' as const, content: 'private prompt' }],
    },
    Object.getOwnPropertyDescriptors(fields),
  );
export function probabilityFixture(
  kind: ProbabilityKind,
  probability: unknown = probabilityGroups,
  options: {
    reply?: (signal: AbortSignal | null | undefined) => Response;
    mode?: 'text' | 'refusal' | 'function';
    missingUsage?: boolean;
    absent?: boolean;
    raw?: boolean;
    transportFails?: boolean;
    mutate?: () => void;
    gate?: 'auth' | 'implicit' | 'model' | 'provider' | 'limit' | 'selection' | 'audit' | 'usage';
  } = {},
) {
  const records: UsageRecord[] = [],
    audits: unknown[] = [],
    sent: Record<string, unknown>[] = [];
  let secrets = 0,
    routes = 0;
  const mode = options.mode ?? 'text';
  const candidate = {
    id: 'candidate',
    kind: kind === 'openrouter' ? ('delegated' as const) : ('managed' as const),
    providerId: 'provider',
    upstreamModelId: 'upstream-model',
  };
  const transport = {
    resolveSecret: async () => {
      secrets++;
      options.mutate?.();
      return 'fixture-provider-key';
    },
    fetcher: (async (url, init) => {
      assert.equal(
        String(url),
        kind === 'openrouter'
          ? 'https://openrouter.ai/api/v1/chat/completions'
          : kind === 'openai'
            ? 'https://api.openai.com/v1/chat/completions'
            : kind === 'anthropic'
              ? 'https://api.anthropic.com/v1/messages'
              : 'https://generativelanguage.googleapis.com/v1beta/models/upstream-model:generateContent',
      );
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (options.transportFails) return new Response('private upstream error', { status: 500 });
      if (options.reply) return options.reply(init?.signal);
      if (kind === 'anthropic')
        return Response.json({
          id: 'completion',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'reply' }],
          usage: { input_tokens: 2, output_tokens: 1 },
        });
      if (kind === 'google')
        return Response.json({
          responseId: 'completion',
          candidates: [{ content: { parts: [{ text: 'reply' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 },
        });
      const payload = {
        id: 'completion',
        created: 42,
        model: 'upstream-model',
        system_fingerprint: null,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: mode === 'text' ? 'reply' : null,
              ...(mode === 'refusal' ? { refusal: 'private refusal' } : {}),
              ...(mode === 'function'
                ? {
                    tool_calls: [
                      {
                        id: 'call',
                        type: 'function',
                        function: { name: 'lookup', arguments: '{}' },
                      },
                    ],
                  }
                : {}),
            },
            finish_reason:
              mode === 'refusal' ? 'content_filter' : mode === 'function' ? 'tool_calls' : 'stop',
            ...(options.absent ? {} : { logprobs: probability }),
          },
        ],
        ...(options.missingUsage ? {} : { usage: { prompt_tokens: 2, completion_tokens: 1 } }),
      };
      const response = options.raw ? new Response('{}') : Response.json(payload);
      if (options.raw) Object.defineProperty(response, 'json', { value: async () => payload });
      return response;
    }) as typeof fetch,
  };
  const directPorts = {
    ...transport,
    registrations: [
      {
        providerId: 'provider',
        kind: kind === 'openrouter' ? ('openai' as const) : kind,
        credentialRef: 'secret/reference',
        ...(kind === 'anthropic' ? { maxOutputTokens: 128 } : {}),
      },
    ],
  };
  const delegatedPorts = { ...transport, credentialRef: 'secret/reference' };
  const direct = createDirectChatInvoker(directPorts),
    delegated = createOpenRouterChatInvoker(delegatedPorts);
  const directText = createRegisteredDirectTextStreamInvoker(directPorts),
    directFunction = createRegisteredDirectFunctionStreamInvoker(directPorts),
    delegatedText = createOpenRouterTextStreamInvoker(delegatedPorts),
    delegatedFunction = createOpenRouterFunctionStreamInvoker(delegatedPorts);
  const attempt = { upstreamModelId: 'upstream-model', authorizedProviderSlugs: ['provider'] };
  const ports: ChatHandlerPorts<unknown> = {
    newRequestId: () => 'req-probabilities',
    authenticate: async () =>
      options.gate === 'auth'
        ? undefined
        : {
            id: 'user',
            active: true,
            credentialId: 'credential',
            policyVersions: [],
            statements:
              options.gate === 'implicit'
                ? []
                : [
                    { effect: 'Allow', actions: ['*'], resources: ['*'] },
                    ...(options.gate === 'model' || options.gate === 'provider'
                      ? [
                          {
                            effect: 'Deny' as const,
                            actions: ['llm:*'],
                            resources: [
                              options.gate === 'model' ? 'model:chat' : 'provider:provider',
                            ],
                          },
                        ]
                      : []),
                  ],
          },
    resolveRoute: async () => {
      routes++;
      return candidate.kind === 'delegated'
        ? {
            kind: 'delegated',
            version: 'v1',
            credentialRef: 'secret/reference',
            candidates: [candidate],
          }
        : { kind: 'managed', version: 'v1', candidates: [candidate] };
    },
    resolveVerifiedProviderSlug: async () => 'provider',
    checkLimit: async () => options.gate !== 'limit',
    resolveSecret: async () => assert.fail('unexpected Jev secret'),
    invokeDirect: (selected, request) => direct(selected, request),
    invokeOpenRouter: (_ref, selected, request) => delegated(selected, request),
    invokeDirectTextStream: directText,
    invokeDirectFunctionStream: directFunction,
    invokeOpenRouterTextStream: (_ref, selected, request, callback, signal) =>
      delegatedText(selected, request, callback, signal),
    invokeOpenRouterFunctionStream: (_ref, selected, request, callback, signal) =>
      delegatedFunction(selected, request, callback, signal),
    writeUsage: async (r) => {
      if (options.gate === 'usage') throw Error('private ledger error');
      records.push(r);
    },
    writeAudit: async (e) => {
      if (
        (options.gate === 'selection' &&
          (e.kind === 'selection-started' || e.kind === 'delegated-selection')) ||
        (options.gate === 'audit' && (e.kind === 'attempt' || e.kind === 'delegated-attempt'))
      )
        throw Error('private audit error');
      audits.push(e);
    },
  };
  return {
    ports,
    handler: createChatHandler(ports),
    records,
    audits,
    sent,
    counts: () => ({ secrets, routes }),
    request: (base: string, fields: Record<string, unknown> = {}) =>
      new Request(`http://gateway${base}/chat/completions`, {
        method: 'POST',
        headers: { authorization: 'Bearer fixture-proxy-key', 'content-type': 'application/json' },
        body: JSON.stringify(probabilityInput(fields)),
      }),
    call: (fields: Record<string, unknown> = {}) =>
      kind === 'openrouter'
        ? delegated(attempt, probabilityInput(fields) as ChatRequest)
        : direct(candidate, probabilityInput(fields) as ChatRequest),
    stream: (functions: boolean, fields: Record<string, unknown>) => {
      const chat = probabilityInput(fields) as ChatRequest;
      if (kind === 'openrouter')
        return functions
          ? delegatedFunction(attempt, chat, () => {})
          : delegatedText(attempt, chat, () => {});
      return functions
        ? directFunction(candidate, chat, () => {})
        : directText(candidate, chat, () => {});
    },
  };
}
export function probabilityPrivacy(f: ReturnType<typeof probabilityFixture>) {
  assert.doesNotMatch(
    JSON.stringify({ records: f.records, audits: f.audits }),
    /private|forged|logprobs|top_logprobs|fixture-provider-key|fixture-proxy-key/u,
  );
}
