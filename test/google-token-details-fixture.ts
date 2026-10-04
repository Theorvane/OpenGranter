import assert from 'node:assert/strict';
import { type ChatHandlerPorts, createChatHandler } from '../src/gateway/chat-handler.ts';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import { createRegisteredDirectFunctionStreamInvoker } from '../src/providers/direct-function-stream.ts';
import { createRegisteredDirectTextStreamInvoker } from '../src/providers/direct-text-stream.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

export type GoogleDetailMode = 'nonstream' | 'text-stream' | 'function-stream';
export const googleDetailCounts = {
  promptTokenCount: 3,
  candidatesTokenCount: 2,
  totalTokenCount: 9,
};
export const googleDetailUsage = {
  prompt_tokens: 3,
  completion_tokens: 2,
  total_tokens: 9,
  prompt_tokens_details: { cached_tokens: 1 },
  completion_tokens_details: { reasoning_tokens: 4 },
};
export const googleDetailInput = (mode: GoogleDetailMode) => ({
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
export function googleDetailNative(usage: unknown, functions = false, safety = false) {
  return {
    responseId: 'gen',
    modelVersion: 'gemini-exact',
    candidates: [
      {
        index: 0,
        content: {
          role: 'model',
          parts: safety
            ? []
            : functions
              ? [{ functionCall: { id: 'call', name: 'lookup', args: { q: 'private argument' } } }]
              : [{ text: 'private answer' }],
        },
        finishReason: safety ? 'SAFETY' : 'STOP',
      },
    ],
    ...(usage === undefined ? {} : { usageMetadata: usage }),
  };
}
export function googleDetailsFixture(
  mode: GoogleDetailMode,
  usage: unknown,
  options: {
    tail?: { usage: unknown };
    early?: unknown;
    functions?: boolean;
    safety?: boolean;
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
      { providerId: 'google', kind: 'google' as const, credentialRef: 'secret/google' },
    ],
    resolveSecret: async (ref: string) => {
      assert.equal(ref, 'secret/google');
      secrets++;
      return 'fixture-provider-key';
    },
    fetcher: (async (url, init) => {
      calls++;
      assert.equal(
        String(url),
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-exact:${mode === 'nonstream' ? 'generateContent' : 'streamGenerateContent?alt=sse'}`,
      );
      assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'fixture-provider-key');
      const native = googleDetailNative(usage, functions, options.safety);
      if (mode === 'nonstream') return Response.json(native);
      const events: object[] = [];
      if (options.early !== undefined)
        events.push({
          responseId: 'gen',
          modelVersion: 'gemini-exact',
          candidates: [
            { index: 0, content: { role: 'model', parts: [{ text: 'private early' }] } },
          ],
          usageMetadata: options.early,
        });
      events.push(native);
      if (options.tail) events.push({ responseId: 'gen', usageMetadata: options.tail.usage });
      return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
        headers: { 'content-type': 'text/event-stream' },
      });
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
                      resources: [options.gate === 'model' ? 'model:chat' : 'provider:google'],
                    },
                  ]
                : []),
            ],
          },
    resolveRoute: async () => ({
      kind: 'managed',
      version: 'v',
      candidates: [
        { id: 'one', kind: 'managed', providerId: 'google', upstreamModelId: 'gemini-exact' },
      ],
    }),
    checkLimit: async () => {
      limits++;
      return options.gate !== 'limit';
    },
    resolveSecret: async () => {
      assert.fail('unexpected Jev credential');
    },
    invokeDirect: createDirectChatInvoker(adapterPorts),
    invokeDirectTextStream: createRegisteredDirectTextStreamInvoker(adapterPorts),
    invokeDirectFunctionStream: createRegisteredDirectFunctionStreamInvoker(adapterPorts),
    writeUsage: async (record) => {
      if (options.gate === 'usage') throw Error('private ledger');
      records.push(record);
    },
    writeAudit: async (event) => {
      if (options.gate === 'audit' && event.kind === 'attempt') throw Error('private audit');
      audits.push(event);
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
          ...googleDetailInput(mode),
          ...(options.functions && mode === 'nonstream'
            ? { tools: googleDetailInput('function-stream').tools }
            : {}),
        }),
      }),
  };
}
export async function googleDetailOutput(
  response: Response,
  mode: GoogleDetailMode,
): Promise<Record<string, unknown>> {
  if (mode === 'nonstream') return response.json() as Promise<Record<string, unknown>>;
  const body = await response.text();
  assert.ok(body.endsWith('data: [DONE]\n\n'));
  const frames = body
    .split('\n\n')
    .filter((f) => f.startsWith('data: ') && !f.includes('[DONE]'))
    .map((f) => JSON.parse(f.slice(6)) as Record<string, unknown>);
  return { usage: frames.reverse().find((f) => f.usage !== undefined && f.usage !== null)?.usage };
}
