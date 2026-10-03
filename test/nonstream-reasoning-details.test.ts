import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { type ChatHandlerPorts, createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import { normalizeAssistantResponse } from '../src/providers/assistant-response.ts';
import { type ChatCompletion, createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import { createOpenRouterChatInvoker } from '../src/providers/openrouter-chat.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

type Kind = 'managed' | 'delegated';
type Gate = 'auth' | 'model' | 'provider' | 'limit' | 'selection' | 'outcome' | 'usage';
const text = 'private reasoning 思考\n\ndata: forged';
function fixture(
  kind: Kind,
  message: object,
  finish: string = 'stop',
  gate?: Gate,
  missingUsage = false,
) {
  const audit: Parameters<ChatHandlerPorts<unknown>['writeAudit']>[0][] = [];
  const usage: UsageRecord[] = [];
  let calls = 0;
  let secrets = 0;
  const transport = {
    resolveSecret: async () => {
      secrets++;
      return 'fixture-upstream-key';
    },
    fetcher: async (url: string | URL | Request) => {
      assert.equal(
        String(url),
        kind === 'managed'
          ? 'https://api.openai.com/v1/chat/completions'
          : 'https://openrouter.ai/api/v1/chat/completions',
      );
      calls++;
      return Response.json({
        id: 'completion',
        created: 42,
        model: 'upstream-model',
        system_fingerprint: 'fp_fixture',
        choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finish }],
        ...(missingUsage ? {} : { usage: { prompt_tokens: 2, completion_tokens: 1 } }),
      });
    },
  };
  const candidate = {
    id: 'candidate',
    kind,
    providerId: 'openai',
    upstreamModelId: 'upstream-model',
  };
  const direct = createDirectChatInvoker({
    ...transport,
    registrations: [{ providerId: 'openai', kind: 'openai', credentialRef: 'secret/direct' }],
  });
  const delegated = createOpenRouterChatInvoker({
    ...transport,
    credentialRef: 'secret/openrouter',
  });
  const ports: ChatHandlerPorts<unknown> = {
    newRequestId: () => 'req-reasoning',
    authenticate: async (token) =>
      gate === 'auth' || token !== 'fixture-proxy-key'
        ? undefined
        : {
            id: 'user-1',
            active: true,
            credentialId: 'proxy-1',
            policyVersions: [],
            statements: [
              { effect: 'Allow', actions: ['*'], resources: ['*'] },
              ...(gate === 'model' || gate === 'provider'
                ? [
                    {
                      effect: 'Deny' as const,
                      actions: [gate === 'model' ? 'llm:InvokeModel' : 'llm:UseProvider'],
                      resources: [gate === 'model' ? 'model:chat' : 'provider:openai'],
                    },
                  ]
                : []),
            ],
          },
    resolveRoute: async () =>
      kind === 'delegated'
        ? { kind, version: 'v1', credentialRef: 'secret/openrouter', candidates: [candidate] }
        : { kind, version: 'v1', candidates: [candidate] },
    resolveVerifiedProviderSlug: async () => 'OpenAI',
    checkLimit: async () => gate !== 'limit',
    resolveSecret: async () => assert.fail('unexpected Jev secret'),
    invokeDirect: (selected, request) => direct(selected, request),
    invokeOpenRouter: (_ref, attempt, request) => delegated(attempt, request),
    writeAudit: async (event) => {
      if (
        (gate === 'selection' &&
          (event.kind === 'selection-started' || event.kind === 'delegated-selection')) ||
        (gate === 'outcome' && (event.kind === 'attempt' || event.kind === 'delegated-attempt'))
      )
        throw new Error('private reasoning audit');
      audit.push(event);
    },
    writeUsage: async (record) => {
      if (gate === 'usage') throw new Error('private reasoning usage');
      usage.push(record);
    },
  };
  const request = (base: string) =>
    new Request(`http://gateway${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer fixture-proxy-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'chat',
        messages: [{ role: 'user', content: 'private prompt' }],
      }),
    });
  return { ports, request, audit, usage, calls: () => calls, secrets: () => secrets };
}
function safe(f: ReturnType<typeof fixture>) {
  const value = JSON.stringify({ audit: f.audit, usage: f.usage });
  for (const forbidden of ['private', 'fixture-upstream-key', 'fixture-proxy-key', 'forged'])
    assert.equal(value.includes(forbidden), false);
}

const details = [
  { type: 'reasoning.summary', summary: text, id: null, index: -1, format: 'unknown' },
  {
    type: 'reasoning.text',
    text: null,
    signature: 'private signature',
    id: 'private id',
    index: 0,
    format: null,
  },
  { type: 'reasoning.text' },
  { type: 'reasoning.encrypted', data: 'private encrypted', format: 'future-opaque-format' },
];
for (const kind of ['managed', 'delegated'] as const) {
  test(`${kind}: nonstream reasoning details preserve omission empty arrays and opaque variants`, async () => {
    for (const base of ['/v1', '/api/v1'])
      for (const value of [undefined, [], details]) {
        const f = fixture(kind, {
          content: 'private answer',
          reasoning: text,
          ...(value === undefined ? {} : { reasoning_details: value }),
        });
        const response = await createChatHandler(f.ports)(f.request(base));
        assert.equal(response.status, 200);
        const body = (await response.json()) as ChatCompletion;
        assert.deepEqual(body.choices[0].message.reasoning_details, value);
        assert.equal(
          Object.hasOwn(body.choices[0].message, 'reasoning_details'),
          value !== undefined,
        );
        assert.equal(body.choices[0].message.reasoning, text);
        assert.equal(f.usage[0]?.outcome, 'succeeded');
        safe(f);
      }
  });
  test(`${kind}: malformed and unsupported detail semantics fail safely after dispatch`, async () => {
    const bad = [
      null,
      true,
      {},
      'private data',
      [null],
      [{ type: 'reasoning.unknown' }],
      [
        {
          type: 'reasoning.server_tool_call',
          tool_name: 'private tool',
          arguments: '{}',
          result: '{}',
        },
      ],
      [{ type: 'reasoning.summary' }],
      [{ type: 'reasoning.summary', summary: null }],
      [{ type: 'reasoning.encrypted', data: null }],
      [{ type: 'reasoning.text', text: 1 }],
      [{ type: 'reasoning.text', signature: {} }],
      [{ type: 'reasoning.text', index: 0.5 }],
      [{ type: 'reasoning.text', index: 9007199254740992 }],
      [{ type: 'reasoning.text', id: false }],
      [{ type: 'reasoning.text', format: 42 }],
      [{ type: 'reasoning.text', unknown: 'private value' }],
    ];
    for (const base of ['/v1', '/api/v1'])
      for (const value of bad) {
        const f = fixture(kind, { content: 'private answer', reasoning_details: value });
        const response = await createChatHandler(f.ports)(f.request(base));
        assert.equal(response.status, 502);
        assert.doesNotMatch(await response.text(), /private|signature|encrypted/u);
        assert.equal(f.calls(), 1);
        assert.equal(f.usage[0]?.outcome, 'failed');
        assert.equal(f.usage[0]?.possiblyBilled, true);
        safe(f);
      }
  });
  test(`${kind}: reasoning details preserve filter refusal and function completion rules`, async () => {
    const calls = [{ id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } }];
    for (const [message, finish] of [
      [{ content: null, refusal: 'private refusal' }, 'stop'],
      [{ content: null }, 'content_filter'],
      [{ content: '' }, 'length'],
      [{ tool_calls: calls }, 'tool_calls'],
    ] as const) {
      const f = fixture(kind, { ...message, reasoning_details: details }, finish);
      const response = await createChatHandler(f.ports)(f.request('/api/v1'));
      assert.equal(response.status, 200);
      const body = (await response.json()) as ChatCompletion;
      assert.deepEqual(body.choices[0].message.reasoning_details, details);
      assert.equal(body.choices[0].finish_reason, finish);
      if ('tool_calls' in message) assert.deepEqual(body.choices[0].message.tool_calls, calls);
      safe(f);
    }
    const f = fixture(kind, { content: null, reasoning_details: details });
    assert.equal((await createChatHandler(f.ports)(f.request('/api/v1'))).status, 502);
    assert.equal(f.usage[0]?.outcome, 'failed');
  });
  test(`${kind}: reasoning details do not fabricate missing usage`, async () => {
    const f = fixture(
      kind,
      { content: 'private answer', reasoning_details: details },
      'stop',
      undefined,
      true,
    );
    const response = await createChatHandler(f.ports)(f.request('/api/v1'));
    assert.equal(response.status, 200);
    const body = (await response.json()) as ChatCompletion;
    assert.deepEqual(body.choices[0].message.reasoning_details, details);
    assert.equal(body.usage, undefined);
    assert.equal(f.usage[0]?.usage.status, 'missing');
    assert.equal(f.usage[0]?.usage.totalTokens, null);
    safe(f);
  });
  test(`${kind}: reasoning details retain denial and required persistence gates`, async () => {
    for (const base of ['/v1', '/api/v1'])
      for (const [gate, status, dispatched] of [
        ['auth', 401, false],
        ['model', 403, false],
        ['provider', 403, false],
        ['limit', 429, false],
        ['selection', 503, false],
        ['outcome', 503, true],
        ['usage', 503, true],
      ] as const) {
        const f = fixture(
          kind,
          { content: 'private answer', reasoning_details: details },
          'stop',
          gate,
        );
        const response = await createChatHandler(f.ports)(f.request(base));
        assert.equal(response.status, status);
        assert.equal(f.calls(), dispatched ? 1 : 0);
        assert.equal(f.secrets(), dispatched ? 1 : 0);
        assert.doesNotMatch(await response.text(), /private|encrypted|signature/u);
        safe(f);
      }
  });
  test(`${kind}: both official SDKs receive details over both socket bases`, async () => {
    const sdkDetails = [
      { type: 'reasoning.summary', summary: text },
      { type: 'reasoning.text', text, signature: null },
      { type: 'reasoning.encrypted', data: 'private encrypted' },
    ];
    const f = fixture(kind, { content: 'private answer', reasoning_details: sdkDetails });
    const server = createNodeChatServer(f.ports);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address() as AddressInfo;
      for (const base of ['/v1', '/api/v1']) {
        const client = new OpenRouter({
          apiKey: 'fixture-proxy-key',
          serverURL: `http://127.0.0.1:${address.port}${base}`,
          retryConfig: { strategy: 'none' },
          timeoutMs: 3000,
        });
        const result = await client.chat.send({
          chatRequest: {
            model: 'chat',
            messages: [{ role: 'user', content: 'private prompt' }],
            stream: false,
          },
        });
        assert.ok('choices' in result);
        assert.deepEqual(result.choices[0]?.message.reasoningDetails, sdkDetails);
        const openai = new OpenAI({
          apiKey: 'fixture-proxy-key',
          baseURL: `http://127.0.0.1:${address.port}${base}`,
          maxRetries: 0,
        });
        const raw = await openai.chat.completions.create({
          model: 'chat',
          messages: [{ role: 'user', content: 'private prompt' }],
        });
        assert.deepEqual(
          (raw.choices[0]?.message as unknown as { reasoning_details: unknown } | undefined)
            ?.reasoning_details,
          sdkDetails,
        );
        safe(f);
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}
test('detail normalization copies immutable data and captures the message field once', () => {
  const mutable: unknown[] = structuredClone(details);
  let reads = 0;
  const message = Object.defineProperty(
    { role: 'assistant', content: 'private answer' },
    'reasoning_details',
    {
      get: () => {
        reads++;
        return mutable;
      },
    },
  );
  const normalized = normalizeAssistantResponse(message, 'stop');
  assert.ok(normalized);
  mutable[0] = { type: 'reasoning.text', text: 'mutated' };
  assert.deepEqual(normalized.reasoning_details, details);
  assert.equal(reads, 1);
});
test('own undefined detail fields and sparse arrays are malformed', () => {
  for (const value of [
    undefined,
    [{ type: 'reasoning.text', signature: undefined }],
    [{ type: 'reasoning.text', index: Infinity }],
    Array(1),
  ])
    assert.equal(
      normalizeAssistantResponse(
        { role: 'assistant', content: 'answer', reasoning_details: value },
        'stop',
      ),
      undefined,
    );
});
