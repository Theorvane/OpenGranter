import assert from 'node:assert/strict';
import { type ChatHandlerPorts, createChatHandler } from '../src/gateway/chat-handler.ts';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import { createRegisteredDirectFunctionStreamInvoker } from '../src/providers/direct-function-stream.ts';
import { createRegisteredDirectTextStreamInvoker } from '../src/providers/direct-text-stream.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';
import {
  close,
  fragment,
  frames,
  start,
  stop,
  terminal,
  text,
  tool,
} from './anthropic-function-stream-fixture.ts';

export type AnthropicCacheMode = 'nonstream' | 'text-stream' | 'function-stream';
export const nativeCacheUsage = {
  input_tokens: 3,
  output_tokens: 2,
  cache_creation_input_tokens: 4,
  cache_read_input_tokens: 5,
};
export const expectedCacheUsage = {
  prompt_tokens: 12,
  completion_tokens: 2,
  total_tokens: 14,
  prompt_tokens_details: { cached_tokens: 5, cache_write_tokens: 4 },
};
export const cacheUsageInput = (mode: AnthropicCacheMode) => ({
  model: 'chat',
  messages: [{ role: 'user' as const, content: 'private prompt' }],
  ...(mode === 'nonstream'
    ? {}
    : { stream: true as const, stream_options: { include_usage: true } }),
  ...(mode === 'function-stream'
    ? {
        tools: [
          {
            type: 'function' as const,
            function: { name: 'lookup', parameters: { type: 'object' } },
          },
        ],
      }
    : {}),
});
export function cacheUsageFixture(
  mode: AnthropicCacheMode,
  usage: unknown = nativeCacheUsage,
  options: {
    final?: { usage: unknown };
    updates?: readonly unknown[];
    functions?: boolean;
    refusal?: boolean;
    gate?: 'auth' | 'model' | 'provider' | 'limit' | 'usage' | 'audit';
  } = {},
) {
  const records: UsageRecord[] = [],
    audits: unknown[] = [];
  let secrets = 0,
    calls = 0,
    limits = 0;
  const functions = mode === 'function-stream' || options.functions === true;
  const adapterPorts = {
    registrations: [
      {
        providerId: 'anthropic',
        kind: 'anthropic' as const,
        credentialRef: 'secret/anthropic',
        maxOutputTokens: 100,
      },
    ],
    resolveSecret: async (ref: string) => {
      assert.equal(ref, 'secret/anthropic');
      secrets++;
      return 'fixture-provider-key';
    },
    fetcher: (async (url, init) => {
      calls++;
      assert.equal(String(url), 'https://api.anthropic.com/v1/messages');
      assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).get('x-api-key'), 'fixture-provider-key');
      const content = options.refusal
        ? []
        : functions
          ? [{ type: 'tool_use', id: 'call', name: 'lookup', input: { q: 'private argument' } }]
          : [{ type: 'text', text: 'private answer' }];
      const reason = options.refusal ? 'refusal' : functions ? 'tool_use' : 'end_turn';
      if (mode === 'nonstream')
        return Response.json({
          id: 'gen',
          model: 'claude-exact',
          content,
          stop_reason: reason,
          usage,
        });
      const initial = start('claude-exact', usage);
      // Avoid the helper's default usage when this scenario explicitly omits it.
      initial.message.usage = usage;
      const final = options.final
        ? options.final.usage
        : typeof usage === 'object' && usage !== null && !Array.isArray(usage)
          ? { output_tokens: (usage as Record<string, unknown>).output_tokens }
          : undefined;
      const events = [
        initial,
        ...(functions
          ? [tool(0, 'call'), fragment(0, '{"q":"private argument"}'), close()]
          : text()),
        ...(options.updates ?? []).map((u) => terminal(null, u)),
        terminal(reason, final),
        stop,
      ];
      const last = events[events.length - 2];
      // Preserve a missing final output rather than the terminal helper's default estimate.
      if (last && 'usage' in last) last.usage = final;
      return new Response(frames(events), { headers: { 'content-type': 'text/event-stream' } });
    }) satisfies typeof fetch,
  };
  const ports: ChatHandlerPorts<unknown> = {
    newRequestId: () => 'request',
    authenticate: async () =>
      options.gate === 'auth'
        ? undefined
        : {
            id: 'principal',
            active: true,
            credentialId: 'credential',
            policyVersions: [],
            statements: [
              { effect: 'Allow', actions: ['llm:*'], resources: ['*'] },
              ...(options.gate === 'model' || options.gate === 'provider'
                ? [
                    {
                      effect: 'Deny' as const,
                      actions: ['llm:*'],
                      resources: [options.gate === 'model' ? 'model:chat' : 'provider:anthropic'],
                    },
                  ]
                : []),
            ],
          },
    resolveRoute: async () => ({
      kind: 'managed',
      version: 'v',
      candidates: [
        { id: 'one', kind: 'managed', providerId: 'anthropic', upstreamModelId: 'claude-exact' },
      ],
    }),
    checkLimit: async () => {
      limits++;
      return options.gate !== 'limit';
    },
    resolveSecret: async () => {
      assert.fail('unexpected Jev key');
    },
    invokeDirect: createDirectChatInvoker(adapterPorts),
    invokeDirectTextStream: createRegisteredDirectTextStreamInvoker(adapterPorts),
    invokeDirectFunctionStream: createRegisteredDirectFunctionStreamInvoker(adapterPorts),
    writeUsage: async (r) => {
      if (options.gate === 'usage') throw Error('private ledger');
      records.push(r);
    },
    writeAudit: async (e) => {
      if (options.gate === 'audit' && e.kind === 'attempt') throw Error('private audit');
      audits.push(e);
    },
  };
  return {
    ports,
    handler: createChatHandler(ports),
    records,
    audits,
    counts: () => ({ secrets, calls, limits }),
    request: (base: string) =>
      new Request(`http://gateway${base}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer fixture-proxy-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          ...cacheUsageInput(mode),
          ...(options.functions && mode === 'nonstream'
            ? { tools: cacheUsageInput('function-stream').tools }
            : {}),
        }),
      }),
  };
}
export async function cacheUsageOutput(
  response: Response,
  mode: AnthropicCacheMode,
): Promise<Record<string, unknown>> {
  if (mode === 'nonstream') return response.json() as Promise<Record<string, unknown>>;
  const body = await response.text();
  assert.ok(body.endsWith('data: [DONE]\n\n'));
  const events = body
    .split('\n\n')
    .filter((f) => f.startsWith('data: ') && !f.includes('[DONE]'))
    .map((f) => JSON.parse(f.slice(6)) as Record<string, unknown>);
  return { usage: events.reverse().find((f) => f.usage !== undefined && f.usage !== null)?.usage };
}
