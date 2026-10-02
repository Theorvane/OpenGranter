import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { type ChatHandlerPorts, createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import { OpenRouterChatFailure } from '../src/providers/openrouter-chat.ts';
import type { OpenRouterTextStreamPayload } from '../src/streaming/openrouter-stream-chunks.ts';
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
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
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

test('both chat prefixes deliver controlled text SSE and account before final frames', async () => {
  for (const base of ['/v1', '/api/v1']) {
    const f = fixture();
    const response = await createChatHandler(f.ports)(
      f.request(base, { ...chat, stream_options: { include_usage: false } }),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    assert.equal(response.headers.get('x-request-id'), 'req-stream');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(f.callbacks(), 1);
    assert.equal(f.records.length, 0);
    const text = await response.text();
    assert.ok(text.includes('private answer'));
    assert.ok(text.includes('"model":"chat"'));
    assert.ok(text.endsWith('data: [DONE]\n\n'));
    assert.equal(f.records.length, 1);
    assert.equal(f.records[0]?.outcome, 'succeeded');
    assert.equal(f.calls(), 1);
    assert.equal(JSON.stringify({ audit: f.audit, records: f.records }).includes('private'), false);
  }
});

test('pre-frame authentication, IAM, limit and upstream failures remain safe JSON', async () => {
  for (const [variant, status] of [
    ['auth', 401],
    ['iam', 403],
    ['provider', 403],
    ['limit', 429],
    ['upstream', 502],
  ] as const) {
    const f = fixture();
    if (variant === 'auth') f.ports = { ...f.ports, authenticate: async () => undefined };
    if (variant === 'iam' || variant === 'provider')
      f.ports = {
        ...f.ports,
        authenticate: async () => ({
          id: 'user-1',
          active: true,
          credentialId: 'credential-1',
          policyVersions: [],
          statements: [
            {
              effect: 'Allow',
              actions: [variant === 'iam' ? 'llm:UseProvider' : 'llm:InvokeModel'],
              resources: ['*'],
            },
          ],
        }),
      };
    if (variant === 'limit') f.ports = { ...f.ports, checkLimit: async () => false };
    if (variant === 'upstream')
      f.ports = {
        ...f.ports,
        invokeOpenRouterTextStream: async () => {
          throw new OpenRouterChatFailure('upstream', true, true);
        },
      };
    const response = await createChatHandler(f.ports)(
      f.request('/api/v1', { ...chat, stream_options: { include_usage: false } }),
    );
    assert.equal(response.status, status);
    assert.ok(response.headers.get('content-type')?.includes('application/json'));
    assert.equal(((await response.json()) as { error: { code: number } }).error.code, status);
    if (variant !== 'upstream') assert.equal(f.calls(), 0);
  }
});

test('streaming tools and managed routes reject before inference', async () => {
  const f = fixture();
  for (const extra of [
    { tools: [] },
    { tool_choice: 'none' },
    { parallel_tool_calls: false },
    { stream_options: { include_usage: 'yes' } },
    {
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'call-1', content: 'result' },
      ],
    },
  ]) {
    const response = await createChatHandler(f.ports)(
      new Request('http://gateway/api/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: 'Bearer proxy-key', 'content-type': 'application/json' },
        body: JSON.stringify({ ...chat, ...extra }),
      }),
    );
    assert.equal(response.status, 400);
  }
  const managed = {
    ...f.ports,
    resolveRoute: async () => ({
      kind: 'managed' as const,
      version: 'v1',
      candidates: [
        { id: 'one', kind: 'managed' as const, upstreamModelId: 'example', providerId: 'openai' },
      ],
    }),
  };
  assert.equal((await createChatHandler(managed)(f.request())).status, 400);
  assert.equal(f.calls(), 0);
});

test('midstream upstream, usage and audit failures send one safe error without DONE', async () => {
  for (const base of ['/v1', '/api/v1']) {
    for (const variant of ['upstream', 'usage', 'audit'] as const) {
      const f = fixture();
      if (variant === 'upstream')
        f.ports = {
          ...f.ports,
          invokeOpenRouterTextStream: async (_ref, _attempt, _chat, onDelta) => {
            await onDelta(delta());
            throw new Error('private upstream details');
          },
        };
      if (variant === 'usage')
        f.ports = {
          ...f.ports,
          writeUsage: async () => {
            throw new Error('private ledger');
          },
        };
      if (variant === 'audit')
        f.ports = {
          ...f.ports,
          writeAudit: async (event) => {
            if (event.kind === 'delegated-attempt') throw new Error('private audit');
            f.audit.push(event);
          },
        };
      const response = await createChatHandler(f.ports)(
        f.request(base, { ...chat, stream_options: { include_usage: false } }),
      );
      const frames = (await response.text()).trim().split('\n\n');
      const error = JSON.parse(frames.at(-1)?.slice(6) ?? '{}');
      assert.ok(error.error);
      assert.equal(
        error.error.code,
        base === '/api/v1'
          ? variant === 'upstream'
            ? 502
            : 503
          : `${variant}_failed` === 'upstream_failed'
            ? 'upstream_failed'
            : `${variant}_unavailable`,
      );
      assert.equal(JSON.stringify(error).includes('private'), false);
      assert.equal(
        frames.some((frame) => frame.includes('[DONE]')),
        false,
      );
      assert.equal(
        f.audit.some((event) => (event as { kind: string }).kind === 'stream-interrupted'),
        true,
      );
      const interruption = f.audit.find(
        (event) => (event as { kind: string }).kind === 'stream-interrupted',
      );
      assert.equal(
        (interruption as { upstreamCompleted: boolean }).upstreamCompleted,
        variant !== 'upstream',
      );
    }
  }
});

test('body cancellation aborts upstream and records a failed attempt without replay', {
  timeout: 3000,
}, async () => {
  const f = fixture();
  const interrupted = deferred<void>();
  f.ports = {
    ...f.ports,
    writeAudit: async (event) => {
      f.audit.push(event);
      if (event.kind === 'stream-interrupted') interrupted.resolve();
    },
    invokeOpenRouterTextStream: async (_ref, _attempt, _chat, onDelta, signal) => {
      await onDelta(delta());
      assert.ok(signal);
      if (signal.aborted) throw new Error('private cancel');
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('private cancel')), { once: true });
      });
      assert.fail('cancelled stream completed');
    },
  };
  const response = await createChatHandler(f.ports)(f.request());
  const reader = response.body?.getReader();
  assert.ok(reader);
  await reader.read();
  await reader.cancel('private client reason');
  await interrupted.promise;
  assert.equal(f.records.length, 1);
  assert.equal(f.records[0]?.outcome, 'failed');
  assert.equal(f.records[0]?.possiblyBilled, true);
  assert.equal(JSON.stringify(f.audit).includes('private'), false);
});

test('post-accounting body cancellation preserves exactly one successful attempt', {
  timeout: 3000,
}, async () => {
  const f = fixture();
  const accounted = deferred<void>();
  const interrupted = deferred<void>();
  f.ports = {
    ...f.ports,
    writeAudit: async (event) => {
      f.audit.push(event);
      if (event.kind === 'delegated-attempt') accounted.resolve();
      if (event.kind === 'stream-interrupted') interrupted.resolve();
    },
  };
  const response = await createChatHandler(f.ports)(f.request());
  const reader = response.body?.getReader();
  assert.ok(reader);
  await reader.read();
  await reader.read();
  await accounted.promise;
  await new Promise((resolve) => setImmediate(resolve));
  await reader.cancel();
  await interrupted.promise;
  assert.equal(f.records.length, 1);
  assert.equal(f.records[0]?.outcome, 'succeeded');
  assert.equal((f.audit.at(-1) as { upstreamCompleted: boolean }).upstreamCompleted, true);
});

test('pinned SDK consumes delegated streaming over an actual socket', {
  timeout: 5000,
}, async () => {
  const f = fixture();
  const server = createNodeChatServer(f.ports);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    const client = new OpenAI({
      apiKey: 'proxy-key',
      baseURL: `http://127.0.0.1:${address.port}/api/v1`,
    });
    const stream = await client.chat.completions.create({
      model: 'chat',
      messages: [{ role: 'user', content: 'private prompt' }],
      stream: true,
      stream_options: { include_usage: true },
    });
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.equal(chunks[0]?.choices[0]?.delta.content, 'private answer');
    assert.equal(chunks.at(-1)?.usage?.total_tokens, 3);
    assert.equal(f.records.length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('request abort before first frame returns safe failure and one interruption event', {
  timeout: 3000,
}, async () => {
  const f = fixture();
  const cancellation = new AbortController();
  const entered = deferred<void>();
  f.ports = {
    ...f.ports,
    invokeOpenRouterTextStream: async (_ref, _scope, _chat, _delta, signal) => {
      assert.ok(signal);
      entered.resolve();
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new OpenRouterChatFailure('upstream', false, true)),
          { once: true },
        );
      });
      assert.fail('aborted invocation returned');
    },
  };
  const running = createChatHandler(f.ports)(f.request('/api/v1', chat, cancellation.signal));
  await entered.promise;
  cancellation.abort('private reason');
  const response = await running;
  assert.equal(response.status, 502);
  assert.equal(f.records.length, 1);
  assert.equal(
    f.audit.filter((event) => (event as { kind: string }).kind === 'stream-interrupted').length,
    1,
  );
  assert.equal(JSON.stringify(f.audit).includes('private'), false);
});

test('interruption audit failure replaces started error with audit_unavailable', async () => {
  const f = fixture();
  f.ports = {
    ...f.ports,
    invokeOpenRouterTextStream: async (_ref, _scope, _chat, onDelta) => {
      await onDelta(delta());
      throw new Error('private failure');
    },
    writeAudit: async (event) => {
      if (event.kind === 'stream-interrupted') throw new Error('private audit');
      f.audit.push(event);
    },
  };
  const response = await createChatHandler(f.ports)(f.request());
  const text = await response.text();
  assert.ok(text.includes('audit_unavailable'));
  assert.equal(text.includes('[DONE]'), false);
  assert.equal(text.includes('private audit'), false);
});

test('cancelling an error frame produces only one interruption audit', {
  timeout: 3000,
}, async () => {
  const f = fixture();
  const interrupted = deferred<void>();
  f.ports = {
    ...f.ports,
    invokeOpenRouterTextStream: async (_ref, _scope, _chat, onDelta) => {
      await onDelta(delta());
      throw new Error('private failure');
    },
    writeAudit: async (event) => {
      f.audit.push(event);
      if (event.kind === 'stream-interrupted') interrupted.resolve();
    },
  };
  const response = await createChatHandler(f.ports)(f.request());
  const reader = response.body?.getReader();
  assert.ok(reader);
  await reader.read();
  await interrupted.promise;
  await new Promise((resolve) => setImmediate(resolve));
  await reader.cancel();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    f.audit.filter((event) => (event as { kind: string }).kind === 'stream-interrupted').length,
    1,
  );
});

test('SDK abort reaches the upstream invocation through the socket bridge', {
  timeout: 5000,
}, async () => {
  const f = fixture();
  const interrupted = deferred<void>();
  f.ports = {
    ...f.ports,
    writeAudit: async (event) => {
      f.audit.push(event);
      if (event.kind === 'stream-interrupted') interrupted.resolve();
    },
    invokeOpenRouterTextStream: async (_ref, _scope, _chat, onDelta, signal) => {
      await onDelta(delta());
      assert.ok(signal);
      if (signal.aborted) throw new OpenRouterChatFailure('upstream', true, true);
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => reject(new OpenRouterChatFailure('upstream', true, true)),
          { once: true },
        ),
      );
      assert.fail('cancelled invocation succeeded');
    },
  };
  const server = createNodeChatServer(f.ports);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = new OpenAI({
      apiKey: 'proxy-key',
      baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`,
    });
    const stream = await client.chat.completions.create({
      model: 'chat',
      messages: [{ role: 'user', content: 'private prompt' }],
      stream: true,
    });
    const iterator = stream[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).value?.choices[0]?.delta.content, 'private answer');
    stream.controller.abort();
    await interrupted.promise;
    assert.equal(f.records.length, 1);
    assert.equal(f.records[0]?.outcome, 'failed');
    assert.equal((f.audit.at(-1) as { outcome: string }).outcome, 'cancelled');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('missing final usage stays unknown and emits no fabricated usage frame', async () => {
  const f = fixture();
  const original = f.ports.invokeOpenRouterTextStream;
  assert.ok(original);
  f.ports = {
    ...f.ports,
    invokeOpenRouterTextStream: async (...args) => ({
      ...(await original(...args)),
      usage: undefined,
    }),
  };
  const response = await createChatHandler(f.ports)(
    f.request('/api/v1', { ...chat, stream_options: { include_usage: false } }),
  );
  const text = await response.text();
  assert.ok(text.endsWith('data: [DONE]\n\n'));
  assert.equal(text.includes('"usage"'), false);
  assert.equal(f.records[0]?.usage.status, 'missing');
});

test('both bases accept nullable stream usage options without suppressing accounting', async () => {
  for (const base of ['/v1', '/api/v1']) {
    for (const options of [null, {}, { include_usage: true }, { include_usage: false }]) {
      const f = fixture();
      const payload = { ...chat, stream_options: options };
      const response = await createChatHandler(f.ports)(f.request(base, payload));
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.ok(text.includes('"total_tokens":3'));
      assert.ok(text.endsWith('data: [DONE]\n\n'));
      assert.equal(f.records.length, 1);
      assert.equal(f.records[0]?.usage.status, 'reported');
    }
  }
});

test('malformed and nonstream usage options fail before route or upstream work', async () => {
  for (const options of [
    true,
    'private invalid',
    [],
    { include_usage: null },
    { include_usage: 1 },
    { unknown: true },
    { include_usage: true, extra: 'private' },
  ]) {
    const f = fixture();
    let routes = 0;
    f.ports = {
      ...f.ports,
      resolveRoute: async () => {
        routes++;
        assert.fail('invalid options resolved route');
      },
    };
    const payload = { ...chat, stream_options: options };
    const response = await createChatHandler(f.ports)(f.request('/api/v1', payload));
    assert.equal(response.status, 400);
    assert.equal(routes, 0);
    assert.equal(f.calls(), 0);
    assert.equal((await response.text()).includes('private'), false);
  }
  const f = fixture();
  const nonstream = { ...chat, stream: false, stream_options: {} };
  assert.equal((await createChatHandler(f.ports)(f.request('/api/v1', nonstream))).status, 400);
});

test('native streamed fingerprints survive both client bases and remain outside accounting metadata', async () => {
  const { createOpenRouterTextStreamInvoker } = await import(
    '../src/providers/openrouter-stream.ts'
  );
  for (const base of ['/v1', '/api/v1']) {
    const f = fixture();
    const invoker = createOpenRouterTextStreamInvoker({
      credentialRef: 'secret/openrouter',
      resolveSecret: async () => 'fixture-key',
      fetcher: async () =>
        new Response(
          [
            {
              choices: [{ index: 0, delta: { content: 'text' }, finish_reason: null }],
              system_fingerprint: 'fp_private\n\ndata: forged',
            },
            {
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
              system_fingerprint: 'fp_terminal',
            },
            {
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1, completion_tokens: 2 },
              system_fingerprint: null,
            },
          ]
            .map(
              (value) =>
                `data: ${JSON.stringify({ id: 'gen-1', object: 'chat.completion.chunk', created: 42, model: 'openai/example', ...value })}\n\n`,
            )
            .join('') + 'data: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    });
    f.ports = { ...f.ports, invokeOpenRouterTextStream: (_ref, ...args) => invoker(...args) };
    const response = await createChatHandler(f.ports)(f.request(base));
    assert.equal(response.status, 200);
    const frames = (await response.text()).trim().split('\n\n');
    assert.equal(frames.length, 4);
    assert.equal(
      JSON.parse(frames[0]?.slice(6) ?? '{}').system_fingerprint,
      'fp_private\n\ndata: forged',
    );
    assert.equal(JSON.parse(frames[1]?.slice(6) ?? '{}').system_fingerprint, 'fp_terminal');
    assert.equal(JSON.parse(frames[2]?.slice(6) ?? '{}').system_fingerprint, null);
    assert.equal(f.records[0]?.usage.status, 'reported');
    assert.equal(JSON.stringify({ audit: f.audit, usage: f.records }).includes('fp_'), false);
  }
});

function nativeFingerprintPorts(
  f: ReturnType<typeof fixture>,
  first: unknown,
  final: unknown,
  invalidAt?: 'first' | 'later',
) {
  return import('../src/providers/openrouter-stream.ts').then(
    ({ createOpenRouterTextStreamInvoker }) => {
      const invoker = createOpenRouterTextStreamInvoker({
        credentialRef: 'secret/openrouter',
        resolveSecret: async () => 'fixture-key',
        fetcher: async () =>
          new Response(
            [
              {
                choices: [{ index: 0, delta: { content: 'text' }, finish_reason: null }],
                ...(first === undefined
                  ? {}
                  : {
                      system_fingerprint: invalidAt === 'first' ? { secret: 'fp_private' } : first,
                    }),
              },
              {
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                system_fingerprint: 'fp_terminal',
              },
              {
                choices: [],
                usage: { prompt_tokens: 1, completion_tokens: 2 },
                ...(final === undefined
                  ? {}
                  : {
                      system_fingerprint: invalidAt === 'later' ? { secret: 'fp_private' } : final,
                    }),
              },
            ]
              .map(
                (value) =>
                  `data: ${JSON.stringify({ id: 'gen-1', object: 'chat.completion.chunk', created: 42, model: 'openai/example', ...value })}\n\n`,
              )
              .join('') + 'data: [DONE]\n\n',
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      });
      return {
        ...f.ports,
        invokeOpenRouterTextStream: (_ref: string, ...args: Parameters<typeof invoker>) =>
          invoker(...args),
      };
    },
  );
}

test('malformed native fingerprints produce safe first/later failures with possible-billing accounting', async () => {
  for (const base of ['/v1', '/api/v1']) {
    for (const phase of ['first', 'later'] as const) {
      const f = fixture();
      f.ports = await nativeFingerprintPorts(f, 'fp_text', null, phase);
      const response = await createChatHandler(f.ports)(f.request(base));
      assert.equal(response.status, phase === 'first' ? 502 : 200);
      const body = await response.text();
      assert.equal(body.includes('[DONE]'), false);
      assert.equal(body.includes('fp_private'), false);
      assert.equal(f.records[0]?.outcome, 'failed');
      assert.equal(f.records[0]?.possiblyBilled, true);
      assert.equal(JSON.stringify({ audit: f.audit, usage: f.records }).includes('fp_'), false);
    }
  }
});

test('SDK sees exact streamed fingerprints on both socket bases and final omission stays omitted', {
  timeout: 10000,
}, async () => {
  for (const base of ['/v1', '/api/v1']) {
    for (const final of [undefined, null, 'fp_usage']) {
      const f = fixture();
      f.ports = await nativeFingerprintPorts(f, 'fp_text', final);
      const server = createNodeChatServer(f.ports);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const address = server.address() as AddressInfo;
        const client = new OpenAI({
          apiKey: 'fixture-key',
          baseURL: `http://127.0.0.1:${address.port}${base}`,
        });
        const stream = await client.chat.completions.create({
          model: 'chat',
          messages: [{ role: 'user', content: 'text' }],
          stream: true,
        });
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        assert.equal(chunks[0]?.system_fingerprint, 'fp_text');
        assert.equal(chunks[1]?.system_fingerprint, 'fp_terminal');
        assert.equal(chunks[2]?.system_fingerprint, final);
        assert.equal(Object.hasOwn(chunks[2] ?? {}, 'system_fingerprint'), final !== undefined);
        assert.equal(chunks[2]?.usage?.total_tokens, 3);
        assert.equal(f.records.length, 1);
        assert.equal(JSON.stringify({ audit: f.audit, usage: f.records }).includes('fp_'), false);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  }
});

test('compatible started error chunks retain delivered identity while legacy stays unchanged', async () => {
  for (const base of ['/v1', '/api/v1']) {
    for (const variant of ['upstream', 'usage', 'audit'] as const) {
      const f = fixture();
      if (variant === 'upstream')
        f.ports = {
          ...f.ports,
          invokeOpenRouterTextStream: async (_ref, _scope, _chat, onDelta) => {
            await onDelta(delta());
            throw new Error('private upstream');
          },
        };
      if (variant === 'usage')
        f.ports = {
          ...f.ports,
          writeUsage: async () => {
            throw new Error('private ledger');
          },
        };
      if (variant === 'audit')
        f.ports = {
          ...f.ports,
          writeAudit: async (event) => {
            if (event.kind === 'delegated-attempt') throw new Error('private audit');
            f.audit.push(event);
          },
        };
      const response = await createChatHandler(f.ports)(f.request(base));
      assert.equal(response.status, 200);
      const frames = (await response.text()).trim().split('\n\n');
      const first = JSON.parse(frames[0]?.slice(6) ?? '{}');
      const failure = JSON.parse(frames.at(-1)?.slice(6) ?? '{}');
      if (base === '/api/v1') {
        assert.equal(failure.id, first.id);
        assert.equal(failure.created, first.created);
        assert.equal(failure.model, 'chat');
        assert.equal(failure.object, 'chat.completion.chunk');
        assert.deepEqual(failure.choices, [
          { index: 0, delta: { content: '' }, finish_reason: 'error' },
        ]);
        assert.equal(failure.request_id, 'req-stream');
      } else {
        for (const key of ['id', 'created', 'model', 'object', 'choices'])
          assert.equal(Object.hasOwn(failure, key), false);
      }
      assert.equal(JSON.stringify(failure).includes('private'), false);
      assert.equal(
        frames.some((frame) => frame.includes('[DONE]')),
        false,
      );
      assert.equal(Object.hasOwn(failure, 'usage'), false);
    }
  }
});

test('invalid first/later frames cannot invent or replace compatible failure identity', async () => {
  for (const first of [true, false]) {
    const f = fixture();
    f.ports = {
      ...f.ports,
      invokeOpenRouterTextStream: async (_ref, _scope, _chat, onDelta) => {
        if (!first) await onDelta(delta());
        await onDelta({ ...delta(), id: 'private-invalid', created: -1, model: 'private-model' });
        assert.fail('invalid frame continued');
      },
    };
    const response = await createChatHandler(f.ports)(f.request());
    assert.equal(response.status, first ? 502 : 200);
    const text = await response.text();
    assert.equal(text.includes('private-invalid'), false);
    assert.equal(text.includes('private-model'), false);
    if (first) {
      const failure = JSON.parse(text);
      assert.equal(Object.hasOwn(failure, 'choices'), false);
      assert.equal(Object.hasOwn(failure, 'id'), false);
    } else {
      const failure = JSON.parse(text.trim().split('\n\n').at(-1)?.slice(6) ?? '{}');
      assert.equal(failure.id, 'gen-1');
      assert.equal(failure.created, 42);
      assert.equal(failure.model, 'chat');
      assert.equal(failure.choices[0].finish_reason, 'error');
    }
    assert.equal(f.records[0]?.outcome, 'failed');
    assert.equal(f.records[0]?.possiblyBilled, true);
  }
});

test('required interruption audit failure retains compatible chunk identity and safe replacement', async () => {
  const f = fixture();
  f.ports = {
    ...f.ports,
    invokeOpenRouterTextStream: async (_ref, _scope, _chat, onDelta) => {
      await onDelta(delta());
      throw new Error('private upstream');
    },
    writeAudit: async (event) => {
      if (event.kind === 'stream-interrupted') throw new Error('private audit');
      f.audit.push(event);
    },
  };
  const response = await createChatHandler(f.ports)(f.request());
  const text = await response.text();
  const failure = JSON.parse(text.trim().split('\n\n').at(-1)?.slice(6) ?? '{}');
  assert.equal(failure.id, 'gen-1');
  assert.equal(failure.error.code, 503);
  assert.equal(failure.error.metadata.opengranter_code, 'audit_unavailable');
  assert.equal(failure.choices[0].finish_reason, 'error');
  assert.equal(JSON.stringify(failure).includes('private'), false);
  assert.equal(text.includes('[DONE]'), false);
});

test('SDK socket fails safely on compatible error chunk and persists failed attempt', {
  timeout: 5000,
}, async () => {
  const f = fixture();
  f.ports = {
    ...f.ports,
    invokeOpenRouterTextStream: async (_ref, _scope, _chat, onDelta) => {
      await onDelta(delta());
      throw new Error('private provider');
    },
  };
  const server = createNodeChatServer(f.ports);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    const client = new OpenAI({
      apiKey: 'fixture-key',
      baseURL: `http://127.0.0.1:${address.port}/api/v1`,
    });
    const stream = await client.chat.completions.create({
      model: 'chat',
      messages: [{ role: 'user', content: 'text' }],
      stream: true,
    });
    const iterator = stream[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).value?.choices[0]?.delta.content, 'private answer');
    await assert.rejects(iterator.next(), (error: unknown) => {
      assert.ok(error instanceof OpenAI.APIError);
      assert.equal(error.message.includes('Upstream model request failed.'), true);
      assert.equal(error.message.includes('private provider'), false);
      assert.equal(error.code, 502);
      return true;
    });
    assert.equal(f.records.length, 1);
    assert.equal(f.records[0]?.outcome, 'failed');
    assert.equal(f.records[0]?.possiblyBilled, true);
    assert.equal(
      f.audit.some((event) => (event as { kind: string }).kind === 'stream-interrupted'),
      true,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

async function refusalPorts(
  f: ReturnType<typeof fixture>,
  options: { invalidAt?: 'first' | 'later'; missingUsage?: boolean } = {},
) {
  const { createOpenRouterTextStreamInvoker } = await import(
    '../src/providers/openrouter-stream.ts'
  );
  const invoker = createOpenRouterTextStreamInvoker({
    credentialRef: 'secret/openrouter',
    resolveSecret: async () => 'fixture-key',
    fetcher: async () =>
      new Response(
        [
          {
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  content: null,
                  refusal:
                    options.invalidAt === 'first'
                      ? { secret: 'private-refusal' }
                      : 'private-refusal\n\ndata: forged',
                },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              {
                index: 0,
                delta: { refusal: options.invalidAt === 'later' ? true : null },
                finish_reason: 'content_filter',
              },
            ],
          },
          {
            choices: [{ index: 0, delta: { refusal: '' }, finish_reason: 'content_filter' }],
            usage: options.missingUsage ? {} : { prompt_tokens: 1, completion_tokens: 2 },
          },
        ]
          .map(
            (value) =>
              `data: ${JSON.stringify({ id: 'gen-1', object: 'chat.completion.chunk', created: 42, model: 'openai/example', ...value })}\n\n`,
          )
          .join('') + 'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  });
  return {
    ...f.ports,
    invokeOpenRouterTextStream: (_ref: string, ...args: Parameters<typeof invoker>) =>
      invoker(...args),
  };
}

test('native refusal stream succeeds on both bases without metadata text or fallback', async () => {
  for (const base of ['/v1', '/api/v1']) {
    const f = fixture();
    f.ports = await refusalPorts(f);
    const response = await createChatHandler(f.ports)(f.request(base));
    assert.equal(response.status, 200);
    const frames = (await response.text()).trim().split('\n\n');
    assert.equal(frames.length, 4);
    assert.equal(
      JSON.parse(frames[0]?.slice(6) ?? '{}').choices[0].delta.refusal,
      'private-refusal\n\ndata: forged',
    );
    assert.equal(JSON.parse(frames[1]?.slice(6) ?? '{}').choices[0].delta.refusal, null);
    assert.equal(
      JSON.parse(frames[1]?.slice(6) ?? '{}').choices[0].finish_reason,
      'content_filter',
    );
    assert.equal(
      Object.hasOwn(JSON.parse(frames[2]?.slice(6) ?? '{}').choices[0].delta, 'refusal'),
      false,
    );
    assert.equal(f.records[0]?.outcome, 'succeeded');
    assert.equal(f.records[0]?.usage.status, 'reported');
    assert.equal(
      JSON.stringify({ audit: f.audit, usage: f.records }).includes('private-refusal'),
      false,
    );
  }
});

test('malformed refusal first/later chunks fail safely with possible billing', async () => {
  for (const base of ['/v1', '/api/v1']) {
    for (const invalidAt of ['first', 'later'] as const) {
      const f = fixture();
      f.ports = await refusalPorts(f, { invalidAt });
      const response = await createChatHandler(f.ports)(f.request(base));
      assert.equal(response.status, invalidAt === 'first' ? 502 : 200);
      const text = await response.text();
      assert.equal(text.includes('[DONE]'), false);
      if (invalidAt === 'first') assert.equal(text.includes('private-refusal'), false);
      else assert.equal(text.trim().split('\n\n').at(-1)?.includes('private-refusal'), false);
      assert.equal(f.records.length, 1);
      assert.equal(f.records[0]?.outcome, 'failed');
      assert.equal(f.records[0]?.possiblyBilled, true);
      assert.equal(
        JSON.stringify({ audit: f.audit, usage: f.records }).includes('private-refusal'),
        false,
      );
    }
  }
});

test('refusal streams retain authentication, IAM and limit denial before invocation', async () => {
  for (const [variant, status] of [
    ['auth', 401],
    ['iam', 403],
    ['limit', 429],
  ] as const) {
    const f = fixture();
    f.ports = await refusalPorts(f);
    f.ports = {
      ...f.ports,
      invokeOpenRouterTextStream: async () => assert.fail('denial reached upstream'),
    };
    if (variant === 'auth') f.ports = { ...f.ports, authenticate: async () => undefined };
    if (variant === 'iam')
      f.ports = {
        ...f.ports,
        authenticate: async () => ({
          id: 'user-1',
          active: true,
          credentialId: 'credential-1',
          policyVersions: [],
          statements: [],
        }),
      };
    if (variant === 'limit') f.ports = { ...f.ports, checkLimit: async () => false };
    const response = await createChatHandler(f.ports)(f.request());
    assert.equal(response.status, status);
    assert.equal(f.records.length, 0);
    assert.equal((await response.text()).includes('private-refusal'), false);
  }
});

test('refusal streams suppress terminal success on required ledger/audit failure', async () => {
  for (const failure of ['usage', 'audit'] as const) {
    const f = fixture();
    f.ports = await refusalPorts(f);
    if (failure === 'usage')
      f.ports = {
        ...f.ports,
        writeUsage: async () => {
          throw new Error('private-refusal ledger');
        },
      };
    else
      f.ports = {
        ...f.ports,
        writeAudit: async (event) => {
          if (event.kind === 'delegated-attempt') throw new Error('private-refusal audit');
          f.audit.push(event);
        },
      };
    const response = await createChatHandler(f.ports)(f.request());
    const text = await response.text();
    assert.equal(text.includes('[DONE]'), false);
    const last = JSON.parse(text.trim().split('\n\n').at(-1)?.slice(6) ?? '{}');
    assert.equal(last.error.code, 503);
    assert.equal(JSON.stringify(last).includes('private-refusal'), false);
    assert.equal(
      JSON.stringify({ audit: f.audit, usage: f.records }).includes('private-refusal'),
      false,
    );
  }
});

test('SDK receives refusal deltas and missing usage stays unknown on both bases', {
  timeout: 10000,
}, async () => {
  for (const base of ['/v1', '/api/v1']) {
    for (const missingUsage of [false, true]) {
      const f = fixture();
      f.ports = await refusalPorts(f, { missingUsage });
      const server = createNodeChatServer(f.ports);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const address = server.address() as AddressInfo;
        const client = new OpenAI({
          apiKey: 'fixture-key',
          baseURL: `http://127.0.0.1:${address.port}${base}`,
        });
        const stream = await client.chat.completions.create({
          model: 'chat',
          messages: [{ role: 'user', content: 'text' }],
          stream: true,
          stream_options: { include_usage: false },
        });
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        assert.equal(chunks[0]?.choices[0]?.delta.refusal, 'private-refusal\n\ndata: forged');
        assert.equal(chunks[1]?.choices[0]?.delta.refusal, null);
        assert.equal(chunks[1]?.choices[0]?.finish_reason, 'content_filter');
        assert.equal(chunks.length, missingUsage ? 2 : 3);
        assert.equal(chunks.at(-1)?.usage?.total_tokens, missingUsage ? undefined : 3);
        assert.equal(f.records[0]?.outcome, 'succeeded');
        assert.equal(f.records[0]?.usage.status, missingUsage ? 'missing' : 'reported');
        assert.equal(
          JSON.stringify({ audit: f.audit, usage: f.records }).includes('private-refusal'),
          false,
        );
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  }
});

async function reasoningPorts(
  f: ReturnType<typeof fixture>,
  options: { invalidAt?: 'first' | 'later'; missingUsage?: boolean; usageReasoning?: string } = {},
) {
  const { createOpenRouterTextStreamInvoker } = await import(
    '../src/providers/openrouter-stream.ts'
  );
  const invoker = createOpenRouterTextStreamInvoker({
    credentialRef: 'secret/openrouter',
    resolveSecret: async () => 'fixture-key',
    fetcher: async () =>
      new Response(
        [
          {
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  content: null,
                  reasoning:
                    options.invalidAt === 'first'
                      ? { secret: 'private-reasoning' }
                      : 'private-reasoning\n\ndata: forged',
                },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              {
                index: 0,
                delta: { reasoning: options.invalidAt === 'later' ? true : null },
                finish_reason: 'stop',
              },
            ],
          },
          {
            choices: [
              {
                index: 0,
                delta: { reasoning: options.usageReasoning ?? '' },
                finish_reason: 'stop',
              },
            ],
            usage: options.missingUsage ? {} : { prompt_tokens: 1, completion_tokens: 2 },
          },
        ]
          .map(
            (value) =>
              `data: ${JSON.stringify({ id: 'gen-1', object: 'chat.completion.chunk', created: 42, model: 'openai/example', ...value })}\n\n`,
          )
          .join('') + 'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  });
  return {
    ...f.ports,
    invokeOpenRouterTextStream: (_ref: string, ...args: Parameters<typeof invoker>) =>
      invoker(...args),
  };
}

test('official SDK receives reasoning deltas with complete or unknown usage on both bases', {
  timeout: 10000,
}, async () => {
  for (const base of ['/v1', '/api/v1']) {
    for (const missingUsage of [false, true]) {
      const f = fixture();
      f.ports = await reasoningPorts(f, { missingUsage });
      const server = createNodeChatServer(f.ports);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const address = server.address() as AddressInfo;
        const client = new OpenRouter({
          apiKey: 'fixture-key',
          serverURL: `http://127.0.0.1:${address.port}${base}`,
          retryConfig: { strategy: 'none' },
          timeoutMs: 3000,
        });
        const stream = await client.chat.send({
          chatRequest: {
            model: 'chat',
            messages: [{ role: 'user', content: 'text' }],
            stream: true,
            streamOptions: { includeUsage: false },
          },
        });
        assert.ok(Symbol.asyncIterator in stream);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        assert.equal(chunks[0]?.choices[0]?.delta.reasoning, 'private-reasoning\n\ndata: forged');
        assert.equal(chunks[1]?.choices[0]?.delta.reasoning, null);
        assert.equal(chunks[1]?.choices[0]?.finishReason, 'stop');
        assert.equal(chunks.length, missingUsage ? 2 : 3);
        assert.equal(chunks.at(-1)?.usage?.totalTokens, missingUsage ? undefined : 3);
        if (!missingUsage)
          assert.equal(Object.hasOwn(chunks[2]?.choices[0]?.delta ?? {}, 'reasoning'), false);
        assert.equal(f.records[0]?.outcome, 'succeeded');
        assert.equal(f.records[0]?.usage.status, missingUsage ? 'missing' : 'reported');
        assert.equal(
          JSON.stringify({ audit: f.audit, usage: f.records }).includes('private-reasoning'),
          false,
        );
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  }
});

test('native reasoning stream succeeds on both bases without metadata text or fallback', async () => {
  for (const base of ['/v1', '/api/v1']) {
    const f = fixture();
    f.ports = await reasoningPorts(f);
    const response = await createChatHandler(f.ports)(f.request(base));
    assert.equal(response.status, 200);
    const frames = (await response.text()).trim().split('\n\n');
    assert.equal(frames.length, 4);
    assert.equal(
      JSON.parse(frames[0]?.slice(6) ?? '{}').choices[0].delta.reasoning,
      'private-reasoning\n\ndata: forged',
    );
    assert.equal(JSON.parse(frames[1]?.slice(6) ?? '{}').choices[0].delta.reasoning, null);
    assert.equal(JSON.parse(frames[1]?.slice(6) ?? '{}').choices[0].finish_reason, 'stop');
    assert.equal(
      Object.hasOwn(JSON.parse(frames[2]?.slice(6) ?? '{}').choices[0].delta, 'reasoning'),
      false,
    );
    assert.equal(f.records[0]?.outcome, 'succeeded');
    assert.equal(f.records[0]?.usage.status, 'reported');
    assert.equal(
      JSON.stringify({ audit: f.audit, usage: f.records }).includes('private-reasoning'),
      false,
    );
  }
});

test('malformed reasoning first/later chunks fail safely with possible billing', async () => {
  for (const base of ['/v1', '/api/v1']) {
    for (const invalidAt of ['first', 'later'] as const) {
      const f = fixture();
      f.ports = await reasoningPorts(f, { invalidAt });
      const response = await createChatHandler(f.ports)(f.request(base));
      assert.equal(response.status, invalidAt === 'first' ? 502 : 200);
      const text = await response.text();
      assert.equal(text.includes('[DONE]'), false);
      if (invalidAt === 'first') assert.equal(text.includes('private-reasoning'), false);
      else assert.equal(text.trim().split('\n\n').at(-1)?.includes('private-reasoning'), false);
      assert.equal(f.records.length, 1);
      assert.equal(f.records[0]?.outcome, 'failed');
      assert.equal(f.records[0]?.possiblyBilled, true);
      assert.equal(
        JSON.stringify({ audit: f.audit, usage: f.records }).includes('private-reasoning'),
        false,
      );
    }
  }
});

test('reasoning streams retain authentication, IAM and limit denial before invocation', async () => {
  for (const [variant, status] of [
    ['auth', 401],
    ['iam', 403],
    ['limit', 429],
  ] as const) {
    const f = fixture();
    f.ports = await reasoningPorts(f);
    f.ports = {
      ...f.ports,
      invokeOpenRouterTextStream: async () => assert.fail('denial reached upstream'),
    };
    if (variant === 'auth') f.ports = { ...f.ports, authenticate: async () => undefined };
    if (variant === 'iam')
      f.ports = {
        ...f.ports,
        authenticate: async () => ({
          id: 'user-1',
          active: true,
          credentialId: 'credential-1',
          policyVersions: [],
          statements: [],
        }),
      };
    if (variant === 'limit') f.ports = { ...f.ports, checkLimit: async () => false };
    const response = await createChatHandler(f.ports)(f.request());
    assert.equal(response.status, status);
    assert.equal(f.records.length, 0);
    assert.equal((await response.text()).includes('private-reasoning'), false);
  }
});

test('reasoning streams suppress terminal success on required ledger/audit failure', async () => {
  for (const failure of ['usage', 'audit'] as const) {
    const f = fixture();
    f.ports = await reasoningPorts(f);
    if (failure === 'usage')
      f.ports = {
        ...f.ports,
        writeUsage: async () => {
          throw new Error('private-reasoning ledger');
        },
      };
    else
      f.ports = {
        ...f.ports,
        writeAudit: async (event) => {
          if (event.kind === 'delegated-attempt') throw new Error('private-reasoning audit');
          f.audit.push(event);
        },
      };
    const response = await createChatHandler(f.ports)(f.request());
    const text = await response.text();
    assert.equal(text.includes('[DONE]'), false);
    const last = JSON.parse(text.trim().split('\n\n').at(-1)?.slice(6) ?? '{}');
    assert.equal(last.error.code, 503);
    assert.equal(JSON.stringify(last).includes('private-reasoning'), false);
    assert.equal(
      JSON.stringify({ audit: f.audit, usage: f.records }).includes('private-reasoning'),
      false,
    );
  }
});

test('substantive reasoning in final usage fails safely instead of being discarded', async () => {
  for (const base of ['/v1', '/api/v1']) {
    const f = fixture();
    f.ports = await reasoningPorts(f, { usageReasoning: 'private usage reasoning' });
    const response = await createChatHandler(f.ports)(f.request(base));
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.equal(text.includes('[DONE]'), false);
    assert.equal(text.includes('private usage reasoning'), false);
    assert.equal(f.records.length, 1);
    assert.equal(f.records[0]?.outcome, 'failed');
    assert.equal(f.records[0]?.possiblyBilled, true);
    assert.equal(JSON.stringify({ audit: f.audit, usage: f.records }).includes('private'), false);
  }
});
