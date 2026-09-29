import assert from 'node:assert/strict';
import { test } from 'node:test';
import OpenAI from 'openai';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import { createOpenRouterChatInvoker } from '../src/providers/openrouter-chat.ts';

function fixture(
  kind: 'openai' | 'openrouter',
  content: unknown,
  refusal: unknown,
  finish: unknown = 'stop',
  gate = '',
) {
  let calls = 0;
  const audits: unknown[] = [];
  const usage: unknown[] = [];
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json({
      id: 'completion',
      created: 1,
      model: 'model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content, ...(refusal === undefined ? {} : { refusal }) },
          finish_reason: finish,
        },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    });
  };
  const candidate = {
    id: 'candidate',
    kind: 'managed' as const,
    providerId: 'provider',
    upstreamModelId: 'model',
  };
  const resolveSecret = async () => 'fixture-key';
  const direct = createDirectChatInvoker({
    registrations: [{ providerId: 'provider', kind: 'openai', credentialRef: 'secret/reference' }],
    resolveSecret,
    fetcher,
  });
  const delegated = createOpenRouterChatInvoker({
    credentialRef: 'secret/reference',
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
              { effect: 'Allow', actions: ['*'], resources: ['*'] },
              ...(gate === 'explicit'
                ? [{ effect: 'Deny' as const, actions: ['*'], resources: ['*'] }]
                : []),
            ],
    }),
    resolveRoute: async () =>
      kind === 'openai'
        ? { version: 'v1', candidates: [candidate] }
        : {
            kind: 'delegated',
            version: 'v1',
            credentialRef: 'secret/reference',
            candidates: [{ ...candidate, kind: 'delegated' }],
          },
    checkLimit: async () => gate !== 'limit',
    resolveSecret,
    writeAudit: async (event) => {
      if (gate === 'audit') throw new Error('private audit');
      audits.push(event);
    },
    writeUsage: async (record) => {
      usage.push(record);
    },
    invokeDirect: async (_, request) => direct(candidate, request),
    invokeOpenRouter: async (_, __, request) =>
      delegated({ upstreamModelId: 'model', authorizedProviderSlugs: ['provider'] }, request),
    resolveVerifiedProviderSlug: async () => 'provider',
  });
  return { handler, audits, usage, calls: () => calls };
}
const input = { model: 'chat', messages: [{ role: 'user', content: 'private prompt' }] };
function request(path: string) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}
// JSON encoding omits the Symbol-valued property, exercising a missing upstream field.
const invalids: readonly unknown[] = [
  Symbol('missing finish reason'),
  'error',
  'tool_calls',
  'function_call',
  'private-invalid-reason',
  true,
  4,
  [],
  { private: 'private-invalid-reason' },
];
for (const kind of ['openai', 'openrouter'] as const) {
  test(`${kind}: invalid finish reasons fail safely with possibly-billed accounting on both prefixes`, async () => {
    for (const finish of invalids)
      for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
        const f = fixture(kind, 'private response', undefined, finish);
        const response = await f.handler(request(path));
        assert.equal(response.status, 502);
        assert.equal(f.calls(), 1);
        assert.equal(f.usage.length, 1);
        assert.equal((f.usage[0] as { possiblyBilled: boolean }).possiblyBilled, true);
        assert.doesNotMatch(
          await response.text(),
          /private-invalid-reason|private response|fixture-key/u,
        );
        assert.doesNotMatch(
          JSON.stringify([f.audits, f.usage]),
          /private-invalid-reason|private response|fixture-key/u,
        );
      }
  });
  test(`${kind}: supported finish reasons retain exact values and normal/refusal/filter outcomes`, async () => {
    for (const finish of ['stop', 'length', 'content_filter', null])
      for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
        const f = fixture(kind, finish === 'content_filter' ? null : 'reply', undefined, finish);
        const response = await f.handler(request(path));
        assert.equal(response.status, 200);
        const body = (await response.json()) as { choices: { finish_reason: unknown }[] };
        assert.equal(body.choices[0]?.finish_reason, finish);
        assert.equal(f.usage.length, 1);
        const refusal = fixture(kind, null, 'refusal', finish);
        assert.equal((await refusal.handler(request(path))).status, 200);
      }
  });
  test(`${kind}: actual SDK retains null and rejects error finish reasons on both bases`, async () => {
    for (const finish of [null, 'error']) {
      const f = fixture(kind, 'private response', undefined, finish);
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
          const call = () =>
            sdk.chat.completions.create(input as OpenAI.ChatCompletionCreateParamsNonStreaming);
          if (finish === null) assert.equal((await call()).choices[0]?.finish_reason, null);
          else
            await assert.rejects(
              call,
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
    }
  });
  test(`${kind}: finish failures never bypass IAM limits or required audit`, async () => {
    for (const [gate, status] of [
      ['deny', 403],
      ['explicit', 403],
      ['limit', 429],
      ['audit', 503],
    ] as const)
      for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
        const f = fixture(kind, 'private response', undefined, 'error', gate);
        assert.equal((await f.handler(request(path))).status, status);
        assert.equal(f.calls(), 0);
        assert.equal(f.usage.length, 0);
      }
  });
}
