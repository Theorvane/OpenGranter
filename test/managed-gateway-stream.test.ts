import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { type ChatHandlerPorts, createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import { createDirectOpenAITextStreamInvoker } from '../src/providers/direct-openai-stream.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

const chat = {
  model: 'alias',
  messages: [{ role: 'user', content: 'private prompt' }],
  stream: true,
};
function nativeSse(usage: unknown = { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }) {
  const identity = { id: 's', created: 4, model: 'native', object: 'chat.completion.chunk' };
  return (
    [
      {
        ...identity,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'private answer' },
            finish_reason: null,
          },
        ],
        usage: null,
      },
      { ...identity, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: null },
      { ...identity, choices: [], usage },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join('') + 'data: [DONE]\n\n'
  );
}
function fixture() {
  const records: UsageRecord[] = [];
  const audits: unknown[] = [];
  let secrets = 0;
  let calls = 0;
  const adapter = createDirectOpenAITextStreamInvoker({
    registrations: [{ providerId: 'openai', kind: 'openai', credentialRef: 'secret/openai' }],
    resolveSecret: async (ref) => {
      secrets++;
      assert.equal(ref, 'secret/openai');
      return 'fixture-native-key';
    },
    fetcher: async (url, init) => {
      calls++;
      assert.equal(String(url), 'https://api.openai.com/v1/chat/completions');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, 'native');
      assert.equal(body.stream, true);
      assert.deepEqual(body.stream_options, { include_usage: true });
      return new Response(nativeSse(), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  const ports: ChatHandlerPorts<unknown> = {
    newRequestId: () => 'r',
    authenticate: async () => ({
      id: 'p',
      active: true,
      credentialId: 'c',
      policyVersions: [],
      statements: [{ effect: 'Allow', actions: ['llm:*'], resources: ['*'] }],
    }),
    resolveRoute: async () => ({
      kind: 'managed',
      version: 'v',
      candidates: [{ id: 'one', kind: 'managed', providerId: 'openai', upstreamModelId: 'native' }],
    }),
    checkLimit: async () => true,
    resolveSecret: async () => {
      assert.fail('unexpected Jev secret');
    },
    invokeDirect: async () => {
      assert.fail('unexpected nonstream call');
    },
    invokeDirectTextStream: adapter,
    writeUsage: async (record) => {
      records.push(record);
    },
    writeAudit: async (event) => {
      audits.push(event);
    },
  };
  const request = (body: unknown = chat, base = '/v1') =>
    new Request(`http://gateway${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer proxy', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { ports, request, records, audits, secrets: () => secrets, calls: () => calls };
}
for (const base of ['/v1', '/api/v1'])
  test(`managed gateway native stream success ${base}`, async () => {
    const f = fixture();
    const response = await createChatHandler(f.ports)(f.request(chat, base));
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(body.includes('private answer'));
    assert.ok(body.includes('"model":"alias"'));
    assert.ok(body.endsWith('data: [DONE]\n\n'));
    assert.equal(f.calls(), 1);
    assert.equal(f.records[0]?.actualInferenceProviderId, 'openai');
    assert.equal(f.records[0]?.outcome, 'succeeded');
    assert.ok(!JSON.stringify([...f.records, ...f.audits]).includes('private'));
  });
for (const reason of ['auth', 'model', 'provider', 'limit', 'missing-port'] as const)
  test(`managed gateway stream blocks ${reason} before secrets`, async () => {
    const f = fixture();
    const ports = { ...f.ports };
    if (reason === 'auth') ports.authenticate = async () => undefined;
    if (reason === 'model' || reason === 'provider')
      ports.authenticate = async () => ({
        id: 'p',
        active: true,
        credentialId: 'c',
        policyVersions: [],
        statements: [
          { effect: 'Allow', actions: ['llm:*'], resources: ['*'] },
          {
            effect: 'Deny',
            actions: ['llm:*'],
            resources: [reason === 'model' ? 'model:alias' : 'provider:openai'],
          },
        ],
      });
    if (reason === 'limit') ports.checkLimit = async () => false;
    if (reason === 'missing-port') delete ports.invokeDirectTextStream;
    const response = await createChatHandler(ports)(f.request());
    assert.equal(
      response.status,
      reason === 'auth' ? 401 : reason === 'limit' ? 429 : reason === 'missing-port' ? 400 : 403,
    );
    assert.equal(f.secrets(), 0);
    assert.equal(f.calls(), 0);
  });
for (const extra of [
  { tools: [] },
  { tool_choice: 'none' },
  { parallel_tool_calls: false },
  {
    messages: [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call', content: 'private result' },
    ],
  },
])
  test('managed dual boundary rejects tool streaming before native keys', async () => {
    const f = fixture();
    const response = await createChatHandler({
      ...f.ports,
      invokeOpenRouterFunctionStream: async () => {
        assert.fail('unexpected delegated call');
      },
    })(f.request({ ...chat, ...extra }));
    assert.equal(response.status, 400);
    assert.equal(f.secrets(), 0);
    assert.equal(f.calls(), 0);
  });
for (const kind of ['anthropic', 'google'] as const)
  test(`managed stream rejects ${kind} registration before native keys`, async () => {
    const f = fixture();
    let secrets = 0;
    const response = await createChatHandler({
      ...f.ports,
      invokeDirectTextStream: createDirectOpenAITextStreamInvoker({
        registrations: [
          { providerId: 'openai', kind, maxOutputTokens: 100, credentialRef: 'secret/other' },
        ],
        resolveSecret: async () => {
          secrets++;
          return 'fixture-key';
        },
      }),
    })(f.request());
    assert.equal(response.status, 502);
    assert.equal(secrets, 0);
  });
for (const failure of ['usage', 'audit'] as const)
  test(`managed public stream fails closed at required ${failure}`, async () => {
    const f = fixture();
    const ports = { ...f.ports };
    if (failure === 'usage')
      ports.writeUsage = async () => {
        throw Error('private ledger');
      };
    if (failure === 'audit')
      ports.writeAudit = async (event) => {
        if (event.kind === 'attempt') throw Error('private audit');
        f.audits.push(event);
      };
    const response = await createChatHandler(ports)(f.request());
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.ok(!body.includes('[DONE]'));
    assert.ok(body.includes(`${failure}_unavailable`));
    assert.ok(!body.includes(`private ${failure}`));
  });
for (const clientKind of ['openai-v1', 'openai-api', 'openrouter-v1', 'openrouter-api'] as const)
  test(`managed native streams through actual SDK ${clientKind}`, async () => {
    const f = fixture();
    const server = createNodeChatServer(f.ports);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${clientKind.endsWith('-v1') ? '/v1' : '/api/v1'}`;
      const chunks: unknown[] = [];
      if (clientKind.startsWith('openrouter')) {
        const stream = await new OpenRouter({ apiKey: 'proxy', serverURL: base }).chat.send({
          chatRequest: {
            model: 'alias',
            messages: [{ role: 'user', content: 'private prompt' }],
            stream: true,
          },
        });
        assert.ok(Symbol.asyncIterator in stream);
        for await (const chunk of stream) chunks.push(chunk);
      } else {
        const stream = await new OpenAI({ apiKey: 'proxy', baseURL: base }).chat.completions.create(
          { ...chat, stream: true, messages: [{ role: 'user', content: 'private prompt' }] },
        );
        for await (const chunk of stream) chunks.push(chunk);
      }
      assert.ok(JSON.stringify(chunks).includes('private answer'));
      assert.ok(JSON.stringify(chunks).includes('alias'));
      assert.equal(f.calls(), 1);
      assert.equal(f.records[0]?.outcome, 'succeeded');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
test('managed native missing usage stays unavailable without fabricated client counters', async () => {
  const f = fixture();
  const response = await createChatHandler({
    ...f.ports,
    invokeDirectTextStream: createDirectOpenAITextStreamInvoker({
      registrations: [{ providerId: 'openai', kind: 'openai', credentialRef: 'secret/openai' }],
      resolveSecret: async () => 'fixture-key',
      fetcher: async () =>
        new Response(nativeSse(null), { headers: { 'content-type': 'text/event-stream' } }),
    }),
  })(f.request());
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.ok(body.endsWith('data: [DONE]\n\n'));
  assert.ok(!body.includes('prompt_tokens'));
  assert.equal(f.records[0]?.usage.status, 'missing');
});
test('actual SDK abort cancels native body and records a failed billed managed attempt', {
  timeout: 5000,
}, async () => {
  const f = fixture();
  let interrupted!: () => void;
  const done = new Promise<void>((resolve) => {
    interrupted = resolve;
  });
  let cancelled = false;
  const adapter = createDirectOpenAITextStreamInvoker({
    registrations: [{ providerId: 'openai', kind: 'openai', credentialRef: 'secret/openai' }],
    resolveSecret: async () => 'fixture-key',
    fetcher: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(nativeSse().split('\n\n')[0] + '\n\n'));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  });
  const server = createNodeChatServer({
    ...f.ports,
    invokeDirectTextStream: adapter,
    writeAudit: async (event) => {
      f.audits.push(event);
      if (event.kind === 'stream-interrupted') interrupted();
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = new OpenAI({
      apiKey: 'proxy',
      baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      maxRetries: 0,
    });
    const stream = await client.chat.completions.create({
      ...chat,
      stream: true,
      messages: [{ role: 'user', content: 'private prompt' }],
    });
    const iterator = stream[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).value?.choices[0]?.delta.content, 'private answer');
    stream.controller.abort();
    await done;
    assert.equal(cancelled, true);
    assert.equal(f.records.length, 1);
    assert.equal(f.records[0]?.outcome, 'failed');
    assert.equal(f.records[0]?.possiblyBilled, true);
    assert.ok(!JSON.stringify([...f.records, ...f.audits]).includes('private'));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
