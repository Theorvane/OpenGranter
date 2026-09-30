import assert from 'node:assert/strict';
import { test } from 'node:test';
import OpenAI from 'openai';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';

const kinds = ['anthropic', 'google'] as const;
function fixture(kind: (typeof kinds)[number], reason: unknown, gate = '') {
  let calls = 0;
  const audits: unknown[] = [];
  const usage: unknown[] = [];
  const candidate = {
    id: 'candidate',
    kind: 'managed' as const,
    providerId: 'provider',
    upstreamModelId: 'model',
  };
  const resolveSecret = async () => 'fixture-key';
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json(
      kind === 'anthropic'
        ? {
            id: 'completion',
            content: [{ type: 'text', text: 'private response' }],
            stop_reason: reason,
            usage: { input_tokens: 2, output_tokens: 1 },
          }
        : {
            responseId: 'completion',
            candidates: [
              {
                index: 0,
                content: { parts: [{ text: 'private response' }] },
                finishReason: reason,
              },
            ],
            usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
          },
    );
  };
  const invoke = createDirectChatInvoker({
    registrations: [
      {
        providerId: 'provider',
        kind,
        credentialRef: 'secret/reference',
        ...(kind === 'anthropic' ? { maxOutputTokens: 32 } : {}),
      },
    ],
    resolveSecret,
    fetcher,
  });
  const handler = createChatHandler({
    newRequestId: () => 'request',
    authenticate: async () => ({
      id: 'user',
      active: true,
      credentialId: 'credential',
      policyVersions: [],
      statements:
        gate === 'deny'
          ? []
          : [
              { effect: 'Allow' as const, actions: ['*'], resources: ['*'] },
              ...(gate === 'explicit'
                ? [{ effect: 'Deny' as const, actions: ['*'], resources: ['*'] }]
                : []),
            ],
    }),
    resolveRoute: async () => ({ version: 'v1', candidates: [candidate] }),
    checkLimit: async () => gate !== 'limit',
    resolveSecret,
    writeAudit: async (event) => {
      if (gate === 'audit') throw new Error('private audit');
      audits.push(event);
    },
    writeUsage: async (record) => {
      usage.push(record);
    },
    invokeDirect: invoke,
  });
  return { handler, calls: () => calls, audits, usage };
}
const input = { model: 'chat', messages: [{ role: 'user', content: 'private prompt' }] };
function request(path: string) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}
for (const kind of kinds) {
  test(`${kind}: unsupported, malformed and missing native reasons fail safely on both prefixes`, async () => {
    const invalid =
      kind === 'anthropic'
        ? [
            undefined,
            null,
            'tool_use',
            'pause_turn',
            'model_context_window_exceeded',
            'private-unknown',
            true,
            4,
            [],
            {},
          ]
        : [
            undefined,
            null,
            'RECITATION',
            'MALFORMED_FUNCTION_CALL',
            'OTHER',
            'private-unknown',
            true,
            4,
            [],
            {},
          ];
    for (const reason of invalid)
      for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
        const f = fixture(kind, reason);
        const response = await f.handler(request(path));
        assert.equal(response.status, 502);
        assert.equal(f.calls(), 1);
        assert.equal(f.usage.length, 1);
        assert.equal((f.usage[0] as { possiblyBilled: boolean }).possiblyBilled, true);
        assert.doesNotMatch(
          await response.text(),
          /private-unknown|private response|private prompt|fixture-key/u,
        );
        assert.doesNotMatch(
          JSON.stringify([f.audits, f.usage]),
          /private-unknown|private response|private prompt|fixture-key/u,
        );
      }
  });
  test(`${kind}: supported complete and truncated text reasons preserve exact compatible outcome`, async () => {
    const mappings =
      kind === 'anthropic'
        ? [
            ['end_turn', 'stop'],
            ['stop_sequence', 'stop'],
            ['max_tokens', 'length'],
          ]
        : [
            ['STOP', 'stop'],
            ['MAX_TOKENS', 'length'],
          ];
    for (const [reason, expected] of mappings)
      for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
        const f = fixture(kind, reason);
        const response = await f.handler(request(path));
        assert.equal(response.status, 200);
        const body = (await response.json()) as {
          choices: { finish_reason: string; message: { content: string } }[];
        };
        assert.equal(body.choices[0]?.finish_reason, expected);
        assert.equal(body.choices[0]?.message.content, 'private response');
        assert.equal(f.usage.length, 1);
      }
  });
  test(`${kind}: installed SDK gets safe error for unsupported native stop on both bases`, async () => {
    const f = fixture(kind, kind === 'anthropic' ? 'tool_use' : 'RECITATION');
    const server = createNodeRequestServer(f.handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      for (const base of ['/v1', '/api/v1']) {
        const sdk = new OpenAI({
          apiKey: 'fixture',
          baseURL: `http://127.0.0.1:${address.port}${base}`,
          maxRetries: 0,
        });
        await assert.rejects(
          () => sdk.chat.completions.create(input as OpenAI.ChatCompletionCreateParamsNonStreaming),
          (error) =>
            error instanceof OpenAI.APIError &&
            error.status === 502 &&
            !error.message.includes('private response'),
        );
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  test(`${kind}: IAM, limits and audit deny before calling native provider`, async () => {
    for (const [gate, status] of [
      ['deny', 403],
      ['explicit', 403],
      ['limit', 429],
      ['audit', 503],
    ] as const)
      for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
        const f = fixture(kind, 'private-unknown', gate);
        assert.equal((await f.handler(request(path))).status, status);
        assert.equal(f.calls(), 0);
        assert.equal(f.usage.length, 0);
      }
  });
}
