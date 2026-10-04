import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import type { ChatHandlerPorts } from '../src/gateway/chat-handler.ts';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import { createRegisteredDirectFunctionStreamInvoker } from '../src/providers/direct-function-stream.ts';
import type { FunctionCallFragment } from '../src/streaming/openrouter-stream-chunks.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';
import { frames, native } from './anthropic-function-stream-fixture.ts';

const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'lookup',
      parameters: { type: 'object', properties: { q: { type: 'string' } } },
      strict: true,
    },
  },
];
const expected = [
  {
    id: 'call_one',
    type: 'function' as const,
    function: { name: 'lookup', arguments: '{"q":"private 終"}' },
  },
  {
    id: 'call_two',
    type: 'function' as const,
    function: { name: 'lookup', arguments: '{"q":"private 😀"}' },
  },
];
type History =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: null; tool_calls: typeof expected }
  | { role: 'tool'; tool_call_id: string; content: string };
type Input = { messages: History[]; choice: 'required' | 'none'; parallel: boolean };
const first: Input = {
  messages: [{ role: 'user', content: 'private prompt' }],
  choice: 'required',
  parallel: true,
};
const continuation = (calls: typeof expected): Input => ({
  messages: [
    ...first.messages,
    { role: 'assistant', content: null, tool_calls: calls },
    ...calls.map((call) => ({
      role: 'tool' as const,
      tool_call_id: call.id,
      content: 'private result',
    })),
  ],
  choice: 'none',
  parallel: false,
});
type Failure =
  | 'auth'
  | 'model'
  | 'provider'
  | 'limit'
  | 'selection'
  | 'usage'
  | 'audit'
  | 'pre'
  | 'mid'
  | 'invalid'
  | 'missing'
  | 'cancel';
function fixture() {
  let failure: Failure | undefined,
    auth = 0,
    secrets = 0,
    aborted = false;
  const sent: Record<string, unknown>[] = [],
    audit: unknown[] = [],
    usage: UsageRecord[] = [];
  let interrupted!: () => void;
  const interruption = new Promise<void>((resolve) => {
    interrupted = resolve;
  });
  const invoker = createRegisteredDirectFunctionStreamInvoker({
    registrations: [
      {
        providerId: 'anthropic',
        kind: 'anthropic',
        credentialRef: 'secret/anthropic',
        maxOutputTokens: 100,
      },
    ],
    timeoutMs: 5000,
    resolveSecret: async () => {
      secrets++;
      return 'fixture-upstream-key';
    },
    fetcher: async (url, init) => {
      assert.equal(String(url), 'https://api.anthropic.com/v1/messages');
      assert.equal(init?.redirect, 'error');
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      sent.push(body);
      assert.equal(body.provider, undefined);
      assert.equal(body.stream_options, undefined);
      assert.deepEqual(body.tools, [
        { name: 'lookup', input_schema: tools[0]?.function.parameters, strict: true },
      ]);
      assert.equal(body.model, 'claude-exact');
      assert.equal(body.stream, true);
      if (failure === 'pre') return new Response('private error body', { status: 429 });
      const model = failure === 'invalid' ? 'other/unapproved' : 'claude-exact';
      const answered = (body.messages as { role: string; content: unknown }[]).some(
        (message) =>
          Array.isArray(message.content) &&
          message.content.some((block: { type?: string }) => block.type === 'tool_result'),
      );
      const events = native(answered, model, failure === 'missing');
      const initial = frames(events.slice(0, 3));
      if (failure === 'cancel') {
        const source = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(initial));
            init?.signal?.addEventListener(
              'abort',
              () => {
                aborted = true;
                controller.error(Error('private abort'));
              },
              { once: true },
            );
          },
          cancel() {
            aborted = true;
          },
        });
        return new Response(source, { headers: { 'content-type': 'text/event-stream' } });
      }
      const source =
        failure === 'mid'
          ? initial + frames([{ type: 'error', error: { message: 'private upstream error' } }])
          : frames(events);
      return new Response(source, { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  const ports: ChatHandlerPorts<unknown> = {
    newRequestId: () => `req-${auth}`,
    authenticate: async () => {
      auth++;
      if (failure === 'auth') return undefined;
      return {
        id: 'user',
        active: true,
        credentialId: 'proxy',
        policyVersions: [],
        statements: [
          { effect: 'Allow', actions: ['llm:InvokeModel', 'llm:UseProvider'], resources: ['*'] },
          ...(failure === 'model' || failure === 'provider'
            ? [
                {
                  effect: 'Deny' as const,
                  actions: [failure === 'model' ? 'llm:InvokeModel' : 'llm:UseProvider'],
                  resources: ['*'],
                },
              ]
            : []),
        ],
      };
    },
    resolveRoute: async () => ({
      kind: 'managed',
      version: 'v1',
      candidates: [
        {
          id: 'candidate',
          kind: 'managed',
          upstreamModelId: 'claude-exact',
          providerId: 'anthropic',
        },
      ],
    }),
    resolveVerifiedProviderSlug: async () => 'OpenAI',
    checkLimit: async () => failure !== 'limit',
    resolveSecret: async () => assert.fail('unexpected direct secret'),
    invokeDirect: async () => assert.fail('unexpected direct'),
    invokeDirectFunctionStream: invoker,
    writeUsage: async (record) => {
      if (failure === 'usage') throw Error('private ledger');
      usage.push(record);
    },
    writeAudit: async (event) => {
      if (
        (failure === 'selection' && event.kind === 'selection-started') ||
        (failure === 'audit' && event.kind === 'attempt')
      )
        throw Error('private audit');
      audit.push(event);
      if (event.kind === 'stream-interrupted') interrupted();
    },
  };
  return {
    ports,
    sent,
    audit,
    usage,
    fail: (value: Failure) => {
      failure = value;
    },
    counts: () => ({ auth, secrets, aborted }),
    interruption,
  };
}
type SdkFragment = {
  index: number;
  id?: string | undefined;
  type?: string | undefined;
  function?: { name?: string | undefined; arguments?: string | undefined } | undefined;
};
function projectCalls(calls: readonly SdkFragment[]): readonly FunctionCallFragment[] {
  return calls.map((call) => {
    assert.ok(call.type === undefined || call.type === 'function');
    return {
      index: call.index,
      ...(call.id === undefined ? {} : { id: call.id }),
      ...(call.type === undefined ? {} : { type: 'function' as const }),
      ...(call.function === undefined
        ? {}
        : {
            function: {
              ...(call.function.name === undefined ? {} : { name: call.function.name }),
              ...(call.function.arguments === undefined
                ? {}
                : { arguments: call.function.arguments }),
            },
          }),
    };
  });
}
type Chunk = {
  error?: unknown;
  id: string;
  model: string;
  finish?: string | null;
  content?: string | null;
  calls?: readonly FunctionCallFragment[];
  tokens?: number;
};
type Send = (input: Input, signal?: AbortSignal) => AsyncIterable<Chunk>;
async function socket(
  kind: 'openai' | 'openrouter',
  base: string,
  f: ReturnType<typeof fixture>,
  run: (send: Send) => Promise<void>,
) {
  const server = createNodeChatServer(f.ports);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${base}`;
  try {
    if (kind === 'openai') {
      const client = new OpenAI({
        apiKey: 'fixture-proxy-key',
        baseURL: url,
        maxRetries: 0,
        timeout: 7000,
      });
      await run(async function* (input, signal) {
        const stream = await client.chat.completions.create(
          {
            model: 'chat',
            messages: input.messages,
            tools,
            tool_choice: input.choice,
            parallel_tool_calls: input.parallel,
            stream: true,
            stream_options: { include_usage: true },
          },
          signal ? { signal } : {},
        );
        for await (const chunk of stream) {
          const choice = chunk.choices[0];
          yield {
            id: chunk.id,
            model: chunk.model,
            ...(choice?.finish_reason === undefined ? {} : { finish: choice.finish_reason }),
            ...(choice?.delta.content === undefined ? {} : { content: choice.delta.content }),
            ...(choice?.delta.tool_calls === undefined
              ? {}
              : { calls: projectCalls(choice.delta.tool_calls) }),
            ...(chunk.usage?.total_tokens === undefined
              ? {}
              : { tokens: chunk.usage.total_tokens }),
          };
        }
      });
    } else {
      const client = new OpenRouter({
        apiKey: 'fixture-proxy-key',
        serverURL: url,
        retryConfig: { strategy: 'none' },
        timeoutMs: 7000,
      });
      await run(async function* (input, signal) {
        const stream = await client.chat.send(
          {
            chatRequest: {
              model: 'chat',
              messages: input.messages.map((message) =>
                message.role === 'assistant'
                  ? { role: message.role, content: message.content, toolCalls: message.tool_calls }
                  : message.role === 'tool'
                    ? {
                        role: message.role,
                        content: message.content,
                        toolCallId: message.tool_call_id,
                      }
                    : message,
              ),
              tools,
              toolChoice: input.choice,
              parallelToolCalls: input.parallel,
              stream: true,
              streamOptions: { includeUsage: true },
            },
          },
          signal ? { signal } : {},
        );
        assert.ok(Symbol.asyncIterator in stream);
        for await (const chunk of stream) {
          const choice = chunk.choices[0];
          yield {
            ...(chunk.error === undefined ? {} : { error: chunk.error }),
            id: chunk.id,
            model: chunk.model,
            ...(choice?.finishReason === undefined ? {} : { finish: choice.finishReason }),
            ...(choice?.delta.content === undefined ? {} : { content: choice.delta.content }),
            ...(choice?.delta.toolCalls === undefined
              ? {}
              : { calls: projectCalls(choice.delta.toolCalls) }),
            ...(chunk.usage?.totalTokens === undefined ? {} : { tokens: chunk.usage.totalTokens }),
          };
        }
      });
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
async function collect(stream: AsyncIterable<Chunk>) {
  const chunks: Chunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}
function assemble(chunks: readonly Chunk[]) {
  const calls = new Map<
    number,
    { id: string; type: 'function'; function: { name: string; arguments: string } }
  >();
  for (const chunk of chunks) {
    assert.equal(chunk.model, 'chat');
    for (const part of chunk.calls ?? []) {
      const call = calls.get(part.index) ?? {
        id: '',
        type: 'function' as const,
        function: { name: '', arguments: '' },
      };
      if (part.id !== undefined) call.id = part.id;
      if (part.function?.name !== undefined) call.function.name = part.function.name;
      call.function.arguments += part.function?.arguments ?? '';
      calls.set(part.index, call);
    }
  }
  return [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
}
function privacy(f: ReturnType<typeof fixture>) {
  assert.doesNotMatch(
    JSON.stringify([f.audit, f.usage]),
    /private|fixture-upstream-key|fixture-proxy-key|call_one|call_two/u,
  );
}
async function rejected(operation: () => Promise<unknown>, status?: number) {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message, /private|fixture-upstream-key|fixture-proxy-key/u);
    if (status !== undefined)
      assert.equal(
        'status' in error ? error.status : 'statusCode' in error ? error.statusCode : undefined,
        status,
      );
    return true;
  });
}
for (const kind of ['openai', 'openrouter'] as const) {
  for (const base of ['/v1', '/api/v1']) {
    test(`${kind} ${base} completes a native managed two-function lifecycle through a real socket`, {
      timeout: 15000,
    }, async () => {
      const f = fixture();
      await socket(kind, base, f, async (send) => {
        const chunks = await collect(send(first));
        assert.deepEqual(assemble(chunks), expected);
        assert.equal(chunks.at(-1)?.finish, 'tool_calls');
        assert.equal(chunks.at(-1)?.tokens, 5);
        const final = await collect(send(continuation(assemble(chunks))));
        assert.equal(final.map((chunk) => chunk.content ?? '').join(''), 'private final answer');
        assert.equal(final.at(-1)?.finish, 'stop');
        assert.equal(final.at(-1)?.tokens, 5);
      });
      assert.equal(f.sent.length, 2);
      assert.deepEqual(f.sent[0]?.tools, [
        { name: 'lookup', input_schema: tools[0]?.function.parameters, strict: true },
      ]);
      assert.deepEqual(f.sent[0]?.tool_choice, { type: 'any', disable_parallel_tool_use: false });
      assert.equal(f.sent[0]?.parallel_tool_calls, undefined);
      assert.deepEqual(f.sent[1]?.tool_choice, { type: 'none' });
      assert.equal(f.sent[1]?.parallel_tool_calls, undefined);
      const messages = f.sent[1]?.messages;
      assert.ok(Array.isArray(messages));
      assert.deepEqual(messages[1], {
        role: 'assistant',
        content: expected.map((call) => ({
          type: 'tool_use',
          id: call.id,
          name: call.function.name,
          input: JSON.parse(call.function.arguments) as unknown,
        })),
      });
      assert.deepEqual(f.counts(), { auth: 2, secrets: 2, aborted: false });
      assert.deepEqual(
        f.usage.map((record) => record.outcome),
        ['succeeded', 'succeeded'],
      );
      privacy(f);
    });
    test(`${kind} ${base} re-evaluates Deny for the streamed tool-result request`, {
      timeout: 15000,
    }, async () => {
      const f = fixture();
      await socket(kind, base, f, async (send) => {
        const calls = assemble(await collect(send(first)));
        f.fail('provider');
        await rejected(() => collect(send(continuation(calls))), 403);
      });
      assert.equal(f.sent.length, 1);
      assert.equal(f.counts().auth, 2);
      assert.equal(f.counts().secrets, 1);
      assert.equal(f.usage.length, 1);
      privacy(f);
    });
    test(`${kind} ${base} retains pre-frame auth, Deny, limit and audit gates`, {
      timeout: 15000,
    }, async () => {
      for (const [variant, status] of [
        ['auth', 401],
        ['model', 403],
        ['provider', 403],
        ['limit', 429],
        ['selection', 503],
      ] as const) {
        const f = fixture();
        f.fail(variant);
        await socket(kind, base, f, async (send) => rejected(() => collect(send(first)), status));
        assert.equal(f.sent.length, 0);
        assert.equal(f.counts().secrets, 0);
        assert.equal(f.usage.length, 0);
        privacy(f);
      }
    });
    test(`${kind} ${base} keeps safe pre-frame, partial and persistence failures without replay`, {
      timeout: 20000,
    }, async () => {
      for (const variant of ['pre', 'invalid', 'mid', 'usage', 'audit'] as const) {
        const f = fixture();
        f.fail(variant);
        await socket(kind, base, f, async (send) => {
          if (variant === 'pre' || variant === 'invalid') {
            await rejected(() => collect(send(first)), 502);
            return;
          }
          let chunks: Chunk[] | undefined;
          try {
            chunks = await collect(send(first));
          } catch (error) {
            assert.ok(error instanceof Error);
            assert.doesNotMatch(error.message, /private|fixture-upstream-key|fixture-proxy-key/u);
          }
          if (chunks !== undefined) {
            assert.equal(kind, 'openrouter');
            assert.equal(base, '/api/v1');
            assert.equal(chunks.filter((chunk) => chunk.error !== undefined).length, 1);
            assert.equal(chunks.at(-1)?.finish, 'error');
            assert.doesNotMatch(
              JSON.stringify(chunks.at(-1)?.error),
              /private|fixture-upstream-key|fixture-proxy-key/u,
            );
            assert.equal(
              chunks.some((chunk) => chunk.tokens !== undefined),
              false,
            );
          }
        });
        assert.equal(f.sent.length, 1);
        assert.equal(f.counts().secrets, 1);
        if (variant !== 'usage')
          assert.equal(f.usage[0]?.outcome, variant === 'audit' ? 'succeeded' : 'failed');
        privacy(f);
      }
    });
    test(`${kind} ${base} preserves function calls with unknown usage`, {
      timeout: 15000,
    }, async () => {
      const f = fixture();
      f.fail('missing');
      await socket(kind, base, f, async (send) => {
        const chunks = await collect(send(first));
        assert.deepEqual(assemble(chunks), expected);
        assert.equal(chunks.at(-1)?.finish, 'tool_calls');
        assert.equal(
          chunks.some((chunk) => chunk.tokens !== undefined),
          false,
        );
      });
      assert.equal(f.usage[0]?.usage.status, 'missing');
      assert.equal(f.usage[0]?.outcome, 'succeeded');
      privacy(f);
    });
    test(`${kind} ${base} SDK abort cancels the pending upstream function stream`, {
      timeout: 15000,
    }, async () => {
      const f = fixture();
      f.fail('cancel');
      await socket(kind, base, f, async (send) => {
        const controller = new AbortController(),
          iterator = send(first, controller.signal)[Symbol.asyncIterator]();
        assert.equal((await iterator.next()).done, false);
        controller.abort();
        if (kind === 'openai') assert.equal((await iterator.next()).done, true);
        else
          await assert.rejects(
            async () => {
              for (let i = 0; i < 10; i++) {
                const buffered = await iterator.next();
                if (buffered.done) return;
                assert.equal(buffered.value.tokens, undefined);
                assert.equal(buffered.value.finish == null, true);
              }
              assert.fail('too many buffered chunks after abort');
            },
            (error: unknown) => error instanceof Error && error.name !== 'AssertionError',
          );
        await f.interruption;
      });
      assert.equal(f.counts().aborted, true);
      assert.equal(f.sent.length, 1);
      assert.equal(f.usage[0]?.outcome, 'failed');
      assert.equal(f.usage[0]?.possiblyBilled, true);
      privacy(f);
    });
  }
}

test('native function capability cannot activate an unwired delegated function route', async () => {
  const f = fixture();
  let upstream = 0;
  const { createChatHandler } = await import('../src/gateway/chat-handler.ts');
  const handler = createChatHandler({
    ...f.ports,
    resolveRoute: async () => ({
      kind: 'delegated' as const,
      version: 'v1',
      credentialRef: 'secret/openrouter',
      candidates: [
        {
          id: 'one',
          kind: 'delegated' as const,
          upstreamModelId: 'claude-exact',
          providerId: 'anthropic',
        },
      ],
    }),
    invokeOpenRouterTextStream: async () => {
      upstream++;
      assert.fail('unexpected text inference');
    },
  });
  const response = await handler(
    new Request('http://gateway/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'chat', messages: first.messages, tools, stream: true }),
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(upstream, 0);
  assert.equal(f.counts().secrets, 0);
});
