import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { type ChatHandlerPorts, createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import { createOpenRouterTextStreamInvoker } from '../src/providers/openrouter-stream.ts';
import { encodeOpenRouterTextSse } from '../src/streaming/openrouter-client-sse.ts';
import type { OpenRouterTextStreamPayload } from '../src/streaming/openrouter-stream-chunks.ts';
import { decodeOpenRouterStreamPayload } from '../src/streaming/openrouter-stream-chunks.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

type Delta = Extract<OpenRouterTextStreamPayload, { kind: 'delta' }>;
const chat = {
  model: 'chat',
  messages: [{ role: 'user', content: 'private prompt' }],
  stream: true,
};
const delta = (finishReason: Delta['finishReason'] = null): Delta => ({
  kind: 'delta',
  id: 'gen-1',
  model: 'chat',
  created: 42,
  ...(finishReason === null ? { content: 'private answer', role: 'assistant' as const } : {}),
  finishReason,
});
function fixture() {
  const audit: unknown[] = [];
  const records: UsageRecord[] = [];
  let calls = 0;
  let callbacks = 0;
  const ports: ChatHandlerPorts<unknown> = {
    newRequestId: () => 'req-stream',
    authenticate: async () => ({
      id: 'user-1',
      active: true,
      credentialId: 'credential-1',
      policyVersions: [],
      statements: [
        { effect: 'Allow', actions: ['llm:InvokeModel', 'llm:UseProvider'], resources: ['*'] },
      ],
    }),
    resolveRoute: async () => ({
      kind: 'delegated',
      version: 'v1',
      credentialRef: 'secret/openrouter',
      candidates: [
        {
          id: 'candidate-1',
          kind: 'delegated',
          upstreamModelId: 'openai/example',
          providerId: 'openai',
        },
      ],
    }),
    resolveVerifiedProviderSlug: async () => 'OpenAI',
    checkLimit: async () => true,
    resolveSecret: async () => {
      assert.fail('unexpected Jev credential');
    },
    invokeDirect: async () => {
      assert.fail('unexpected direct call');
    },
    writeAudit: async (event) => {
      audit.push(event);
    },
    writeUsage: async (record) => {
      records.push(record);
    },
    invokeOpenRouterTextStream: async (ref, attempt, request, onDelta, signal) => {
      calls++;
      assert.equal(ref, 'secret/openrouter');
      assert.deepEqual(attempt.authorizedProviderSlugs, ['OpenAI']);
      assert.equal(request.model, 'chat');
      assert.ok(signal);
      callbacks++;
      await onDelta(delta());
      callbacks++;
      await onDelta(delta('stop'));
      return {
        status: 'complete',
        id: 'gen-1',
        model: 'chat',
        finishReason: 'stop',
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      };
    },
  };
  const request = (base = '/api/v1', body: unknown = chat, signal?: AbortSignal) =>
    new Request(`http://gateway${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer proxy-key', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  return { ports, audit, records, request, calls: () => calls, callbacks: () => callbacks };
}

const scope = { upstreamModelId: 'openai/example', clientModelAlias: 'chat' };
const marker = 'private-native 終了\n\ndata: forged';
function choice(native: unknown, finish: unknown = null, delta: unknown = {}) {
  return {
    index: 0,
    delta,
    finish_reason: finish,
    ...(native === undefined ? {} : { native_finish_reason: native }),
  };
}
function payload(choices: unknown[], extra: object = {}) {
  return JSON.stringify({
    id: 'gen-1',
    object: 'chat.completion.chunk',
    created: 42,
    model: 'openai/example',
    choices,
    ...extra,
  });
}
function nativePorts(
  f: ReturnType<typeof fixture>,
  final: unknown,
  options: {
    first?: unknown;
    invalidAt?: 'first' | 'terminal' | 'usage';
    usage?: unknown;
    empty?: boolean;
    finish?: string;
  } = {},
) {
  const bad = { secret: marker };
  const finish = options.finish ?? 'stop';
  const invoker = createOpenRouterTextStreamInvoker({
    credentialRef: 'secret/openrouter',
    resolveSecret: async () => 'fixture-key',
    fetcher: async () =>
      new Response(
        [
          payload([
            choice(options.invalidAt === 'first' ? bad : (options.first ?? marker), null, {
              content: 'text',
            }),
          ]),
          payload([
            choice(options.invalidAt === 'terminal' ? bad : 'private-native-terminal', finish),
          ]),
          payload(
            options.empty ? [] : [choice(options.invalidAt === 'usage' ? bad : final, finish)],
            {
              usage: Object.hasOwn(options, 'usage')
                ? options.usage
                : { prompt_tokens: 1, completion_tokens: 2 },
            },
          ),
          '[DONE]',
        ]
          .map((value) => `data: ${value}\n\n`)
          .join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  });
  let calls = 0;
  return {
    ...f.ports,
    invokeOpenRouterTextStream: (_ref: string, ...args: Parameters<typeof invoker>) => {
      calls++;
      return invoker(...args);
    },
    upstreamCalls: () => calls,
  };
}
function chunks(body: string): {
  choices: { native_finish_reason?: unknown; finish_reason: string }[];
  usage?: { total_tokens: number };
  error?: unknown;
}[] {
  return body
    .trim()
    .split('\n\n')
    .filter((value) => !value.includes('[DONE]'))
    .map((value) => JSON.parse(value.slice(6)));
}

test('decoder and encoder preserve native choice scalars without changing canonical reasons', () => {
  for (const native of [undefined, null, '', marker]) {
    for (const finish of [null, 'stop', 'length', 'content_filter']) {
      const event = decodeOpenRouterStreamPayload(
        payload([choice(native, finish, { refusal: null })]),
        scope,
      );
      const frame = encodeOpenRouterTextSse(event);
      assert.ok(frame);
      const value = JSON.parse(frame.slice(6)).choices[0];
      assert.equal(value.native_finish_reason, native);
      assert.equal(Object.hasOwn(value, 'native_finish_reason'), native !== undefined);
      assert.equal(value.finish_reason, finish);
      assert.equal(Object.hasOwn(value.delta, 'native_finish_reason'), false);
      assert.equal(frame.trim().split('\n\n').length, 1);
    }
  }
});

test('decoder and independent encoder reject malformed native metadata even with incomplete usage', () => {
  const ordinary = decodeOpenRouterStreamPayload(payload([choice(undefined)]), scope);
  const usage = decodeOpenRouterStreamPayload(
    payload([choice(undefined, 'stop')], { usage: {} }),
    scope,
  );
  for (const native of [true, 42, [], { secret: marker }]) {
    for (const extra of [{}, { usage: {} }, { usage: { total_tokens: 'invalid' } }]) {
      assert.throws(
        () => decodeOpenRouterStreamPayload(payload([choice(native, 'stop')], extra), scope),
        { message: 'Invalid OpenRouter stream chunk' },
      );
    }
    for (const event of [ordinary, usage]) {
      assert.throws(
        () => encodeOpenRouterTextSse({ ...event, nativeFinishReason: native } as never),
        { message: 'Unsupported OpenRouter text stream event' },
      );
    }
  }
});

test('native metadata does not legalize unknown canonical finishes or rich usage deltas', () => {
  for (const finish of ['error', 'unknown', 'tool_calls']) {
    assert.throws(() => decodeOpenRouterStreamPayload(payload([choice(marker, finish)]), scope));
  }
  for (const delta of [{ content: 'hidden' }, { refusal: marker }, { tool_calls: [] }]) {
    assert.throws(() =>
      decodeOpenRouterStreamPayload(payload([choice(marker, 'stop', delta)], { usage: {} }), scope),
    );
  }
});

test('both HTTP bases preserve actual usage native metadata independently from terminal values', async () => {
  for (const base of ['/v1', '/api/v1']) {
    for (const final of [undefined, null, '', marker]) {
      for (const finish of ['stop', 'length', 'content_filter']) {
        const f = fixture();
        f.ports = nativePorts(f, final, { finish });
        const response = await createChatHandler(f.ports)(f.request(base));
        assert.equal(response.status, 200);
        const body = await response.text();
        const frames = chunks(body);
        assert.equal(frames[0]?.choices[0]?.native_finish_reason, marker);
        assert.equal(frames[1]?.choices[0]?.native_finish_reason, 'private-native-terminal');
        assert.equal(frames[2]?.choices[0]?.native_finish_reason, final);
        assert.equal(
          Object.hasOwn(frames[2]?.choices[0] ?? {}, 'native_finish_reason'),
          final !== undefined,
        );
        assert.equal(frames[2]?.choices[0]?.finish_reason, finish);
        assert.ok(body.endsWith('data: [DONE]\n\n'));
        assert.equal(f.records.length, 1);
        assert.equal(f.records[0]?.outcome, 'succeeded');
        assert.equal(
          JSON.stringify({ audit: f.audit, usage: f.records }).includes('private-native'),
          false,
        );
      }
    }
  }
});

test('empty-choice final usage never inherits native metadata from terminal chunks', async () => {
  const f = fixture();
  f.ports = nativePorts(f, undefined, { empty: true });
  const response = await createChatHandler(f.ports)(f.request());
  const final = chunks(await response.text()).at(-1);
  assert.equal(Object.hasOwn(final?.choices[0] ?? {}, 'native_finish_reason'), false);
  assert.equal(final?.usage?.total_tokens, 3);
});

test('missing partial and invalid usage do not fabricate client usage frames', async () => {
  for (const [usage, status] of [
    [{}, 'missing'],
    [{ prompt_tokens: 1 }, 'partial'],
    [{ total_tokens: 'invalid' }, 'invalid'],
  ] as const) {
    const f = fixture();
    f.ports = nativePorts(f, marker, { usage });
    const response = await createChatHandler(f.ports)(f.request());
    const body = await response.text();
    assert.equal(chunks(body).length, 2);
    assert.equal(f.records[0]?.usage.status, status);
    assert.ok(body.endsWith('data: [DONE]\n\n'));
  }
});

test('malformed first terminal and usage metadata fail safely with possible-billing records', async () => {
  for (const base of ['/v1', '/api/v1']) {
    for (const invalidAt of ['first', 'terminal', 'usage'] as const) {
      const f = fixture();
      f.ports = nativePorts(f, undefined, { invalidAt, usage: {} });
      const response = await createChatHandler(f.ports)(f.request(base));
      assert.equal(response.status, invalidAt === 'first' ? 502 : 200);
      const body = await response.text();
      assert.equal(body.includes('[DONE]'), false);
      const last = invalidAt === 'first' ? JSON.parse(body) : chunks(body).at(-1);
      assert.ok(last?.error);
      assert.equal(JSON.stringify(last).includes('private-native'), false);
      assert.equal(f.records[0]?.outcome, 'failed');
      assert.equal(f.records[0]?.possiblyBilled, true);
      assert.equal(
        JSON.stringify({ audit: f.audit, usage: f.records }).includes('private-native'),
        false,
      );
    }
  }
});

test('authentication model provider explicit Deny limits and required selection audit gate native streams', async () => {
  for (const variant of ['auth', 'model', 'provider', 'deny', 'limit', 'audit'] as const) {
    const f = fixture();
    const ports = nativePorts(f, marker);
    f.ports = ports;
    if (variant === 'auth') f.ports = { ...ports, authenticate: async () => undefined };
    if (['model', 'provider', 'deny'].includes(variant)) {
      const principal = await ports.authenticate('fixture');
      assert.ok(principal);
      f.ports = {
        ...ports,
        authenticate: async () => ({
          ...principal,
          statements:
            variant === 'deny'
              ? [
                  ...principal.statements,
                  { effect: 'Deny', actions: ['llm:InvokeModel'], resources: ['*'] },
                ]
              : [
                  {
                    effect: 'Allow',
                    actions: [variant === 'model' ? 'llm:UseProvider' : 'llm:InvokeModel'],
                    resources: ['*'],
                  },
                ],
        }),
      };
    }
    if (variant === 'limit') f.ports = { ...ports, checkLimit: async () => false };
    if (variant === 'audit')
      f.ports = {
        ...ports,
        writeAudit: async () => {
          throw new Error(marker);
        },
      };
    const response = await createChatHandler(f.ports)(f.request());
    assert.equal(
      response.status,
      variant === 'auth' ? 401 : variant === 'limit' ? 429 : variant === 'audit' ? 503 : 403,
    );
    assert.equal(ports.upstreamCalls(), 0);
    assert.equal((await response.text()).includes('private-native'), false);
    assert.equal(f.records.length, 0);
  }
});

test('required ledger and outcome audit failures suppress final usage metadata and DONE', async () => {
  for (const variant of ['usage', 'audit'] as const) {
    const f = fixture();
    f.ports = nativePorts(f, 'private-native-final');
    f.ports = {
      ...f.ports,
      ...(variant === 'usage'
        ? {
            writeUsage: async () => {
              throw new Error(marker);
            },
          }
        : {
            writeAudit: async (event: Parameters<ChatHandlerPorts<unknown>['writeAudit']>[0]) => {
              if (event.kind === 'delegated-attempt') throw new Error(marker);
              f.audit.push(event);
            },
          }),
    };
    const response = await createChatHandler(f.ports)(f.request());
    const body = await response.text();
    assert.equal(body.includes('[DONE]'), false);
    assert.equal(body.includes('private-native-final'), false);
    assert.equal(JSON.stringify(chunks(body).at(-1)).includes('private-native'), false);
    assert.equal(
      JSON.stringify({ audit: f.audit, usage: f.records }).includes('private-native'),
      false,
    );
  }
});

test('actual socket OpenAI SDK retains native reasons while pinned OpenRouter SDK omits them', {
  timeout: 10000,
}, async () => {
  for (const base of ['/v1', '/api/v1']) {
    for (const sdk of ['openai', 'openrouter'] as const) {
      const f = fixture();
      f.ports = nativePorts(f, marker);
      const server = createNodeChatServer(f.ports);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const address = server.address() as AddressInfo;
        const baseURL = `http://127.0.0.1:${address.port}${base}`;
        const stream =
          sdk === 'openai'
            ? await new OpenAI({ apiKey: 'fixture-key', baseURL }).chat.completions.create({
                model: 'chat',
                messages: [{ role: 'user', content: 'text' }],
                stream: true,
              })
            : await new OpenRouter({ apiKey: 'fixture-key', serverURL: baseURL }).chat.send({
                chatRequest: {
                  model: 'chat',
                  messages: [{ role: 'user', content: 'text' }],
                  stream: true,
                },
              });
        assert.ok(Symbol.asyncIterator in stream);
        const values: unknown[] = [];
        for await (const value of stream) values.push(value);
        assert.equal(values.length, 3);
        const first = values[0] as { choices: Record<string, unknown>[] };
        assert.equal(first.choices[0]?.native_finish_reason, sdk === 'openai' ? marker : undefined);
        assert.equal(Object.hasOwn(first.choices[0] ?? {}, 'nativeFinishReason'), false);
        assert.equal(f.records.length, 1);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  }
});

test('integrated streaming reasoning tier fingerprint and native choice metadata coexist on both bases', async () => {
  for (const base of ['/v1', '/api/v1']) {
    const f = fixture();
    const invoker = createOpenRouterTextStreamInvoker({
      credentialRef: 'secret/openrouter',
      resolveSecret: async () => 'fixture-key',
      fetcher: async () =>
        new Response(
          [
            payload([choice(marker, null, { content: 'text', reasoning: 'private-reasoning' })], {
              service_tier: 'private-tier',
              system_fingerprint: 'fp_private',
            }),
            payload([choice('private-native-terminal', 'stop')], { service_tier: 'terminal-tier' }),
            payload([choice(null, 'stop')], {
              service_tier: null,
              system_fingerprint: '',
              usage: { prompt_tokens: 1, completion_tokens: 2 },
            }),
            '[DONE]',
          ]
            .map((value) => `data: ${value}\n\n`)
            .join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    });
    f.ports = { ...f.ports, invokeOpenRouterTextStream: (_ref, ...args) => invoker(...args) };
    const response = await createChatHandler(f.ports)(f.request(base));
    assert.equal(response.status, 200);
    const body = await response.text();
    const frames = body
      .trim()
      .split('\n\n')
      .slice(0, -1)
      .map((frame) => JSON.parse(frame.slice(6)));
    assert.equal(frames[0].choices[0].delta.reasoning, 'private-reasoning');
    assert.equal(frames[0].choices[0].native_finish_reason, marker);
    assert.equal(frames[0].service_tier, 'private-tier');
    assert.equal(frames[0].system_fingerprint, 'fp_private');
    assert.equal(frames[1].choices[0].native_finish_reason, 'private-native-terminal');
    assert.equal(frames[2].choices[0].native_finish_reason, null);
    assert.equal(frames[2].service_tier, null);
    assert.equal(frames[2].system_fingerprint, '');
    assert.equal(frames[2].usage.total_tokens, 3);
    assert.equal(f.records[0]?.outcome, 'succeeded');
    assert.equal(JSON.stringify({ audit: f.audit, usage: f.records }).includes('private'), false);
    assert.ok(body.endsWith('data: [DONE]\n\n'));
  }
});
