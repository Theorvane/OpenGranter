import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenRouterChatFailure } from '../src/providers/openrouter-chat.ts';
import { createOpenRouterFunctionStreamInvoker } from '../src/providers/openrouter-function-stream.ts';

const encoder = new TextEncoder();
const request = {
  model: 'approved-chat',
  messages: [{ role: 'user' as const, content: 'private prompt' }],
  max_tokens: 32,
  temperature: 0.5,
  top_p: 0.8,
  stop: ['END'],
};
const attempt = {
  upstreamModelId: 'openai/example',
  authorizedProviderSlugs: ['OpenAI', 'Azure'],
};

function chunk(
  delta: Record<string, unknown>,
  finishReason: string | null = null,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    id: 'gen-1',
    object: 'chat.completion.chunk',
    created: 42,
    model: 'openai/example',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...extra,
  });
}

function sse(value: string): string {
  return `data: ${value}\n\n`;
}

function success(): Response {
  return new Response(
    encoder.encode(
      [
        sse(
          chunk({
            tool_calls: [
              {
                index: 0,
                id: 'call',
                type: 'function',
                function: { name: 'lookup', arguments: '{"q":"終"}' },
              },
            ],
          }),
        ),
        sse(chunk({}, 'tool_calls')),
        sse(chunk({}, 'tool_calls', { usage: { prompt_tokens: 3, completion_tokens: 2 } })),
        sse('[DONE]'),
      ].join(''),
    ),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

function safeFailure(category: OpenRouterChatFailure['category'], started: boolean) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof OpenRouterChatFailure);
    assert.equal(error.category, category);
    assert.equal(error.responseStarted, started);
    assert.equal(error.possiblyBilled, true);
    assert.equal(error.message, 'OpenRouter chat attempt failed');
    assert.equal(JSON.stringify(error).includes('private'), false);
    return true;
  };
}

test('sends one fixed scoped streaming request and returns validated usage', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const refs: string[] = [];
  const invoker = createOpenRouterFunctionStreamInvoker({
    credentialRef: 'secret/openrouter',
    resolveSecret: async (ref) => {
      refs.push(ref);
      return 'private-key';
    },
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return success();
    },
  });
  const contents: string[] = [];
  const outcome = await invoker(attempt, request, async (delta) => {
    if (delta.content) contents.push(delta.content);
  });
  assert.deepEqual(refs, ['secret/openrouter']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[0]?.init.method, 'POST');
  assert.equal(calls[0]?.init.redirect, 'error');
  assert.ok(calls[0]?.init.signal instanceof AbortSignal);
  assert.equal(new Headers(calls[0]?.init.headers).get('authorization'), 'Bearer private-key');
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    model: 'openai/example',
    messages: request.messages,
    stream: true,
    max_tokens: 32,
    temperature: 0.5,
    top_p: 0.8,
    stop: ['END'],
    provider: { only: ['OpenAI', 'Azure'] },
  });
  assert.deepEqual(contents, []);
  assert.deepEqual(outcome, {
    status: 'complete',
    id: 'gen-1',
    model: 'approved-chat',
    finishReason: 'tool_calls',
    toolCalls: [
      { id: 'call', type: 'function', function: { name: 'lookup', arguments: '{"q":"終"}' } },
    ],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
  assert.equal(JSON.stringify(outcome).includes('private'), false);
});

test('invalid scope and malformed tool controls stop before secrets and HTTP', async () => {
  let secrets = 0;
  let fetches = 0;
  const invoker = createOpenRouterFunctionStreamInvoker({
    credentialRef: 'secret/openrouter',
    resolveSecret: async () => {
      secrets += 1;
      return 'private-key';
    },
    fetcher: async () => {
      fetches += 1;
      return success();
    },
  });
  await assert.rejects(
    invoker({ ...attempt, authorizedProviderSlugs: [] }, request, () => {}),
    (error: unknown) =>
      error instanceof OpenRouterChatFailure &&
      error.category === 'configuration' &&
      !error.possiblyBilled,
  );
  await assert.rejects(
    invoker(
      attempt,
      { ...request, tools: [{ type: 'function', function: { name: '' } }] },
      () => {},
    ),
    (error: unknown) =>
      error instanceof OpenRouterChatFailure &&
      error.category === 'configuration' &&
      !error.possiblyBilled,
  );
  assert.equal(secrets, 0);
  assert.equal(fetches, 0);
});

test('credential await cannot change the streamed model or provider set', async () => {
  const mutable = {
    upstreamModelId: attempt.upstreamModelId,
    authorizedProviderSlugs: [...attempt.authorizedProviderSlugs],
  };
  let sent: unknown;
  const invoker = createOpenRouterFunctionStreamInvoker({
    credentialRef: 'secret/openrouter',
    resolveSecret: async () => {
      await Promise.resolve();
      mutable.upstreamModelId = 'other/unapproved';
      mutable.authorizedProviderSlugs = ['Unapproved'];
      return 'private-key';
    },
    fetcher: async (_url, init) => {
      sent = JSON.parse(String(init?.body)) as unknown;
      return success();
    },
  });
  const outcome = await invoker(mutable, request, () => {});
  assert.equal(outcome.model, 'approved-chat');
  assert.deepEqual((sent as { provider: unknown }).provider, { only: ['OpenAI', 'Azure'] });
  assert.equal((sent as { model: string }).model, 'openai/example');
});

test('missing credential and invalid timeout fail before HTTP', async () => {
  let fetches = 0;
  for (const ports of [
    { timeoutMs: undefined, resolveSecret: async () => undefined },
    { timeoutMs: -1, resolveSecret: async () => 'private-key' },
  ]) {
    const invoker = createOpenRouterFunctionStreamInvoker({
      credentialRef: 'secret/openrouter',
      resolveSecret: ports.resolveSecret,
      ...(ports.timeoutMs === undefined ? {} : { timeoutMs: ports.timeoutMs }),
      fetcher: async () => {
        fetches += 1;
        return success();
      },
    });
    await assert.rejects(
      invoker(attempt, request, () => {}),
      (error: unknown) => {
        assert.ok(error instanceof OpenRouterChatFailure);
        assert.equal(error.possiblyBilled, false);
        assert.equal(error.responseStarted, false);
        return true;
      },
    );
  }
  assert.equal(fetches, 0);
});

test('HTTP, stream and transport failures remain safe and are never retried', async () => {
  for (const [fetcher, category, started] of [
    [async () => new Response('private rate-limit', { status: 429 }), 'rate-limit', true],
    [
      async () =>
        new Response(sse(chunk({ content: 'private partial' })), {
          headers: { 'content-type': 'text/event-stream' },
        }),
      'upstream',
      true,
    ],
    [
      async () => {
        throw new Error('private network failure');
      },
      'upstream',
      false,
    ],
    [
      async () => {
        throw new DOMException('private timeout', 'TimeoutError');
      },
      'timeout',
      false,
    ],
  ] as const) {
    let calls = 0;
    const invoker = createOpenRouterFunctionStreamInvoker({
      credentialRef: 'secret/openrouter',
      resolveSecret: async () => 'private-key',
      fetcher: async () => {
        calls += 1;
        return fetcher();
      },
    });
    await assert.rejects(
      invoker(attempt, request, () => {}),
      safeFailure(category, started),
    );
    assert.equal(calls, 1);
  }
});

test('timeout during a started SSE response is marked possibly billed', async () => {
  const invoker = createOpenRouterFunctionStreamInvoker({
    credentialRef: 'secret/openrouter',
    timeoutMs: 10,
    resolveSecret: async () => 'private-key',
    fetcher: async (_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(sse(chunk({ content: 'private partial' }))));
          init?.signal?.addEventListener(
            'abort',
            () => controller.error(new Error('private timeout details')),
            { once: true },
          );
        },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  const delivered: string[] = [];
  const keepAlive = setTimeout(() => {}, 100);
  try {
    await assert.rejects(
      invoker(attempt, request, (delta) => {
        if (delta.content) delivered.push(delta.content);
      }),
      safeFailure('timeout', true),
    );
  } finally {
    clearTimeout(keepAlive);
  }
  assert.deepEqual(delivered, ['private partial']);
});

test('stream options are captured before credentials and preserve complete usage', async () => {
  for (const option of [undefined, {}, { include_usage: true }, { include_usage: false }]) {
    const original = option === undefined ? undefined : structuredClone(option);
    const invoker = createOpenRouterFunctionStreamInvoker({
      credentialRef: 'secret/openrouter',
      resolveSecret: async () => {
        if (option && 'include_usage' in option) option.include_usage = !option.include_usage;
        return 'private-key';
      },
      fetcher: async (_url, init) => {
        assert.deepEqual(JSON.parse(String(init?.body)).stream_options, original);
        return success();
      },
    });
    const outcome = await invoker(
      attempt,
      { ...request, ...(option === undefined ? {} : { stream_options: option }) },
      async () => {},
    );
    assert.equal(outcome.usage?.total_tokens, 5);
  }
});

test('malformed native stream options fail safely before credential access', async () => {
  for (const option of [true, [], { include_usage: null }, { extra: 'private' }]) {
    const invoker = createOpenRouterFunctionStreamInvoker({
      credentialRef: 'secret/openrouter',
      resolveSecret: async () => assert.fail('unexpected secret access'),
      fetcher: async () => assert.fail('unexpected upstream call'),
    });
    await assert.rejects(
      invoker(attempt, { ...request, stream_options: option as never }, async () => {}),
      (error: unknown) => {
        assert.ok(error instanceof OpenRouterChatFailure);
        assert.equal(error.category, 'configuration');
        assert.equal(error.possiblyBilled, false);
        assert.equal(error.message.includes('private'), false);
        return true;
      },
    );
  }
});

test('nonstream delegated calls reject usage options before credentials', async () => {
  const { createOpenRouterChatInvoker } = await import('../src/providers/openrouter-chat.ts');
  const invoker = createOpenRouterChatInvoker({
    credentialRef: 'secret/openrouter',
    resolveSecret: async () => assert.fail('unexpected secret access'),
    fetcher: async () => assert.fail('unexpected upstream call'),
  });
  await assert.rejects(invoker(attempt, { ...request, stream_options: {} }), (error: unknown) => {
    assert.ok(error instanceof OpenRouterChatFailure);
    assert.equal(error.category, 'configuration');
    assert.equal(error.possiblyBilled, false);
    return true;
  });
});

test('captures declarations, choice, parallel controls and complete history before secrets', async () => {
  const tools = [
    { type: 'function' as const, function: { name: 'lookup', parameters: { type: 'object' } } },
  ];
  const messages = [
    {
      role: 'assistant' as const,
      content: null,
      tool_calls: [
        { id: 'past', type: 'function' as const, function: { name: 'lookup', arguments: '{}' } },
      ],
    },
    { role: 'tool' as const, tool_call_id: 'past', content: 'private history' },
    ...request.messages,
  ];
  const input = {
    ...request,
    tools,
    messages,
    tool_choice: { type: 'function' as const, function: { name: 'lookup' } },
    parallel_tool_calls: true,
  };
  const original = structuredClone(input);
  const invoker = createOpenRouterFunctionStreamInvoker({
    credentialRef: 'secret/openrouter',
    resolveSecret: async () => {
      tools[0]!.function.name = 'unapproved';
      input.tool_choice.function.name = 'unapproved';
      input.parallel_tool_calls = false;
      messages[1]!.content = 'changed';
      return 'private-key';
    },
    fetcher: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      for (const key of ['tools', 'messages', 'tool_choice', 'parallel_tool_calls'] as const)
        assert.deepEqual(body[key], original[key]);
      return success();
    },
  });
  const outcome = await invoker(attempt, input, async () => {});
  assert.equal(outcome.toolCalls?.[0]?.function.arguments, '{"q":"終"}');
});

test('pre-aborted function calls do not resolve credentials or dispatch', async () => {
  const signal = AbortSignal.abort();
  const invoker = createOpenRouterFunctionStreamInvoker({
    credentialRef: 'secret/openrouter',
    resolveSecret: async () => assert.fail('unexpected secret'),
    fetcher: async () => assert.fail('unexpected fetch'),
  });
  await assert.rejects(
    invoker(attempt, request, () => {}, signal),
    (error: unknown) =>
      error instanceof OpenRouterChatFailure && !error.possiblyBilled && !error.responseStarted,
  );
});
