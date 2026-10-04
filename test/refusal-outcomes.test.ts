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
  finish = 'stop',
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
for (const kind of ['openai', 'openrouter'] as const) {
  test(`${kind}: preserve refusal/filter outcomes and usage through both HTTP prefixes`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      for (const [content, refusal, finish] of [
        [null, 'private refusal', 'stop'],
        [null, undefined, 'stop'],
        [null, '', 'stop'],
        [undefined, 'private refusal', 'stop'],
        [null, undefined, 'content_filter'],
        ['private response', 'private refusal', 'stop'],
        ['private response', null, 'content_filter'],
        ['', undefined, 'content_filter'],
      ] as const) {
        const f = fixture(kind, content, refusal, finish);
        const response = await f.handler(request(path));
        assert.equal(response.status, 200);
        const body = (await response.json()) as { choices: unknown[]; usage: unknown };
        assert.deepEqual(body.choices[0], {
          index: 0,
          message: {
            role: 'assistant',
            content: content ?? null,
            ...(refusal === undefined ? {} : { refusal }),
          },
          finish_reason: finish,
        });
        assert.deepEqual(body.usage, { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 });
        assert.equal(f.calls(), 1);
        assert.equal(f.usage.length, 1);
        assert.doesNotMatch(
          JSON.stringify([f.audits, f.usage]),
          /private prompt|private refusal|private response|fixture-key/u,
        );
      }
    }
  });
  test(`${kind}: actual SDK reads null refusal and content_filter`, async () => {
    for (const [refusal, finish] of [
      ['private refusal', 'stop'],
      [undefined, 'content_filter'],
    ] as const) {
      const f = fixture(kind, null, refusal, finish);
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
          const result = await sdk.chat.completions.create(
            input as OpenAI.ChatCompletionCreateParamsNonStreaming,
          );
          assert.equal(result.choices[0]?.message.content, null);
          assert.equal(result.choices[0]?.message.refusal, refusal);
          assert.equal(result.choices[0]?.finish_reason, finish);
        }
        assert.equal(f.calls(), 2);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  });
  test(`${kind}: malformed refusal responses fail safely and retain possible billing`, async () => {
    for (const [content, refusal, finish] of [
      ['private response', 1, 'stop'],
      [null, {}, 'content_filter'],
    ] as const) {
      const f = fixture(kind, content, refusal, finish);
      const response = await f.handler(request('/api/v1/chat/completions'));
      assert.equal(response.status, 502);
      assert.equal(f.calls(), 1);
      assert.equal(f.usage.length, 1);
      assert.equal((f.usage[0] as { possiblyBilled: boolean }).possiblyBilled, true);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
      assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private|fixture-key/u);
    }
  });
  test(`${kind}: refusal handling retains IAM, limits and required audit gates`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      for (const [gate, status] of [
        ['deny', 403],
        ['explicit', 403],
        ['limit', 429],
        ['audit', 503],
      ] as const) {
        const f = fixture(kind, null, 'private refusal', 'stop', gate);
        assert.equal((await f.handler(request(path))).status, status);
        assert.equal(f.calls(), 0);
        assert.equal(f.usage.length, 0);
      }
    }
  });
}
