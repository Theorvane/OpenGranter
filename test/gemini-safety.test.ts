import assert from 'node:assert/strict';
import { test } from 'node:test';
import OpenAI from 'openai';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';

function fixture(body: unknown, gate = '') {
  let calls = 0;
  const audits: unknown[] = [];
  const usage: unknown[] = [];
  const candidates = ['primary', 'fallback'].map((id) => ({
    id,
    kind: 'managed' as const,
    providerId: id,
    upstreamModelId: 'model',
  }));
  const invoke = createDirectChatInvoker({
    registrations: candidates.map(({ providerId }) => ({
      providerId,
      kind: 'google',
      credentialRef: 'secret/reference',
    })),
    resolveSecret: async () => 'fixture-key',
    fetcher: async () => {
      calls++;
      return Response.json(body);
    },
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
    resolveRoute: async () => ({ version: 'v1', candidates }),
    checkLimit: async () => gate !== 'limit',
    resolveSecret: async () => 'unused',
    writeAudit: async (event) => {
      if (gate === 'audit') throw new Error('private audit');
      audits.push(event);
    },
    writeUsage: async (record) => {
      usage.push(record);
    },
    invokeDirect: invoke,
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
const blocked = [
  { promptFeedback: { blockReason: 'SAFETY', blockReasonMessage: 'private feedback' } },
  { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] },
  ...[undefined, {}, { role: 'model' }, { parts: [] }, { role: 'model', parts: [] }].map(
    (content) => ({
      candidates: [
        { index: 0, finishReason: 'SAFETY', ...(content === undefined ? {} : { content }) },
      ],
    }),
  ),
  { candidates: [{ finishReason: 'SAFETY' }] },
];
test('Gemini SAFETY blocks deliver compatible null content, usage and no fallback', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const body of blocked) {
      const f = fixture({
        ...body,
        responseId: 'completion',
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 0, totalTokenCount: 2 },
      });
      const response = await f.handler(request(path));
      assert.equal(response.status, 200);
      const result = (await response.json()) as {
        model: string;
        choices: unknown[];
        usage: unknown;
      };
      assert.equal(result.model, 'chat');
      assert.deepEqual(result.choices, [
        {
          index: 0,
          message: { role: 'assistant', content: null },
          finish_reason: 'content_filter',
        },
      ]);
      assert.deepEqual(result.usage, { prompt_tokens: 2, completion_tokens: 0, total_tokens: 2 });
      assert.equal(f.calls(), 1);
      assert.equal(f.usage.length, 1);
      assert.equal((f.usage[0] as { outcome: string }).outcome, 'succeeded');
      assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private|fixture-key/u);
    }
});
test('Gemini blocked responses preserve missing/invalid usage states', async () => {
  for (const usageMetadata of [
    undefined,
    { promptTokenCount: -1 },
    { promptTokenCount: 'private usage' },
  ]) {
    const f = fixture({ ...blocked[0], usageMetadata });
    assert.equal((await f.handler(request('/api/v1/chat/completions'))).status, 200);
    assert.equal(
      (f.usage[0] as { usage: { status: string } }).usage.status,
      usageMetadata === undefined ? 'missing' : 'invalid',
    );
    assert.doesNotMatch(JSON.stringify(f.usage), /private/u);
  }
});
test('actual SDK receives Gemini SAFETY prompt and candidate blocks through both prefixes', async () => {
  for (const body of [blocked[0], blocked[2]]) {
    const f = fixture(body);
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
        assert.equal(result.choices[0]?.finish_reason, 'content_filter');
      }
      assert.equal(f.calls(), 2);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
});
test('malformed or contradictory Gemini blocks retain safe failure and possible billing', async () => {
  const invalids = [
    {},
    { candidates: [] },
    { candidates: null },
    { promptFeedback: { blockReason: 'OTHER' } },
    { promptFeedback: { blockReason: 'SAFETY' }, candidates: null },
    { promptFeedback: { blockReason: 'SAFETY' }, candidates: {} },
    {
      promptFeedback: { blockReason: 'SAFETY' },
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'private response' }] } }],
    },
    { candidates: [{ index: 1, finishReason: 'SAFETY' }] },
    { candidates: [{ finishReason: 'SAFETY' }, { finishReason: 'SAFETY' }] },
    ...[
      null,
      [],
      { role: 'user' },
      { parts: null },
      { parts: [{ text: 'private response' }] },
      { parts: [{ functionCall: { name: 'private tool' } }] },
      { private: 'metadata' },
    ].map((content) => ({ candidates: [{ finishReason: 'SAFETY', content }] })),
  ];
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const body of invalids) {
      const f = fixture(body);
      const response = await f.handler(request(path));
      assert.equal(response.status, 502);
      assert.equal(f.calls(), 1);
      assert.equal((f.usage[0] as { possiblyBilled: boolean }).possiblyBilled, true);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
      assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private|fixture-key/u);
    }
});
test('Gemini safety mapping retains IAM, limits and required audit gates', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const [gate, status] of [
      ['deny', 403],
      ['explicit', 403],
      ['limit', 429],
      ['audit', 503],
    ] as const) {
      const f = fixture(blocked[0], gate);
      assert.equal((await f.handler(request(path))).status, status);
      assert.equal(f.calls(), 0);
      assert.equal(f.usage.length, 0);
    }
});
