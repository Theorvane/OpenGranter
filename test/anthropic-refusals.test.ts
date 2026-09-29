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
      kind: 'anthropic',
      maxOutputTokens: 128,
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
const refusals = [
  [],
  [{ type: 'text', text: '' }],
  [{ type: 'text', text: 'private partial' }],
  [
    { type: 'text', text: 'private partial' },
    { type: 'text', text: ' Ω ' },
  ],
];
function body(
  content: unknown,
  stop_reason = 'refusal',
  usage: unknown = { input_tokens: 2, output_tokens: 1 },
) {
  return {
    id: 'completion',
    role: 'assistant',
    content,
    stop_reason,
    stop_details: { explanation: 'private details', recommended_model: 'unapproved-model' },
    usage,
  };
}
test('Anthropic explicit refusals become null filtered output without fallback or leaked details', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const content of refusals) {
      const f = fixture(body(content));
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
          message: { role: 'assistant', content: null, refusal: null },
          finish_reason: 'content_filter',
        },
      ]);
      assert.deepEqual(result.usage, { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 });
      assert.equal(f.calls(), 1);
      assert.equal(f.usage.length, 1);
      assert.equal((f.usage[0] as { outcome: string }).outcome, 'succeeded');
      assert.doesNotMatch(
        JSON.stringify([f.audits, f.usage, result]),
        /private|fixture-key|unapproved-model/u,
      );
    }
});
test('Anthropic refusal usage preserves missing/invalid states rather than assuming zero', async () => {
  for (const usage of [undefined, { input_tokens: -1 }, { input_tokens: 'private usage' }]) {
    const payload = body([]);
    const f = fixture({ ...payload, usage });
    const response = await f.handler(request('/api/v1/chat/completions'));
    assert.equal(response.status, 200);
    assert.equal(
      (f.usage[0] as { usage: { status: string } }).usage.status,
      usage === undefined ? 'missing' : 'invalid',
    );
    assert.doesNotMatch(JSON.stringify(f.usage), /private/u);
  }
});
test('actual SDK reads Anthropic refusal outcomes through both prefixes', async () => {
  for (const content of [refusals[0], refusals[2]]) {
    const f = fixture(body(content));
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
        assert.equal(result.choices[0]?.message.refusal, null);
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
test('malformed and mixed Anthropic refusal content remains safe possibly-billed failure', async () => {
  const invalids = [
    undefined,
    null,
    {},
    [null],
    [{ type: 'text' }],
    [{ type: 'text', text: 1 }],
    [{ type: 'tool_use', id: 'private tool' }],
    [{ type: 'thinking', thinking: 'private thought' }],
    [
      { type: 'text', text: 'private partial' },
      { type: 'tool_use', id: 'private tool' },
    ],
  ];
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const content of invalids) {
      const f = fixture(body(content));
      const response = await f.handler(request(path));
      assert.equal(response.status, 502);
      assert.equal(f.calls(), 1);
      assert.equal((f.usage[0] as { possiblyBilled: boolean }).possiblyBilled, true);
      assert.doesNotMatch(await response.text(), /private|fixture-key|unapproved-model/u);
      assert.doesNotMatch(
        JSON.stringify([f.audits, f.usage]),
        /private|fixture-key|unapproved-model/u,
      );
    }
});
test('Anthropic normal text mappings and rejection of empty non-refusals remain intact', async () => {
  for (const [reason, finish] of [
    ['end_turn', 'stop'],
    ['stop_sequence', 'stop'],
    ['max_tokens', 'length'],
  ] as const) {
    const f = fixture(
      body(
        [
          { type: 'text', text: 'ordinary' },
          { type: 'text', text: ' text' },
        ],
        reason,
      ),
    );
    const response = await f.handler(request('/api/v1/chat/completions'));
    assert.equal(response.status, 200);
    const result = (await response.json()) as { choices: unknown[] };
    assert.deepEqual(result.choices, [
      { index: 0, message: { role: 'assistant', content: 'ordinary text' }, finish_reason: finish },
    ]);
    const empty = fixture(body([], reason));
    assert.equal((await empty.handler(request('/api/v1/chat/completions'))).status, 502);
  }
});
test('Anthropic refusals retain implicit/explicit Deny, limits and required audit', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const [gate, status] of [
      ['deny', 403],
      ['explicit', 403],
      ['limit', 429],
      ['audit', 503],
    ] as const) {
      const f = fixture(body([]), gate);
      assert.equal((await f.handler(request(path))).status, status);
      assert.equal(f.calls(), 0);
      assert.equal(f.usage.length, 0);
    }
});
