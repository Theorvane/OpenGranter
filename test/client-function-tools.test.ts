import assert from 'node:assert/strict';
import { test } from 'node:test';
import OpenAI from 'openai';
import { type ChatRequest, createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import { createOpenRouterChatInvoker } from '../src/providers/openrouter-chat.ts';

const kinds = ['openai', 'anthropic', 'google', 'openrouter'] as const;
type Kind = (typeof kinds)[number];
function body(kind: Kind) {
  if (kind === 'anthropic')
    return {
      id: 'completion',
      content: [{ type: 'text', text: 'reply' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 2, output_tokens: 1 },
    };
  if (kind === 'google')
    return {
      responseId: 'completion',
      candidates: [{ content: { parts: [{ text: 'reply' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 },
    };
  return {
    id: 'completion',
    created: 1,
    model: 'model',
    choices: [
      { index: 0, message: { role: 'assistant', content: 'reply' }, finish_reason: 'stop' },
    ],
    usage: { prompt_tokens: 2, completion_tokens: 1 },
  };
}
function adapter(kind: Kind, cap?: number, mutate?: () => void, transportFails = false) {
  const sent: Record<string, unknown>[] = [];
  let secrets = 0;
  const resolveSecret = async () => {
    secrets++;
    mutate?.();
    return 'fixture-key';
  };
  const fetcher: typeof fetch = async (_, init) => {
    sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return transportFails
      ? new Response('private fixture upstream error', { status: 400 })
      : Response.json(body(kind));
  };
  const candidate = {
    id: 'candidate',
    kind: kind === 'openrouter' ? ('delegated' as const) : ('managed' as const),
    providerId: 'provider',
    upstreamModelId: 'model',
  };
  const invoke =
    kind === 'openrouter'
      ? createOpenRouterChatInvoker({ credentialRef: 'secret/reference', resolveSecret, fetcher })
      : createDirectChatInvoker({
          registrations: [
            {
              providerId: 'provider',
              kind,
              credentialRef: 'secret/reference',
              ...(cap !== undefined || kind === 'anthropic' ? { maxOutputTokens: cap ?? 128 } : {}),
            },
          ],
          resolveSecret,
          fetcher,
        });
  return {
    candidate,
    sent,
    secrets: () => secrets,
    call: (request: ChatRequest) =>
      kind === 'openrouter'
        ? (invoke as ReturnType<typeof createOpenRouterChatInvoker>)(
            { upstreamModelId: 'model', authorizedProviderSlugs: ['provider'] },
            request,
          )
        : (invoke as ReturnType<typeof createDirectChatInvoker>)(candidate, request),
  };
}
function httpFixture(
  kind: Kind,
  options: {
    deny?: boolean;
    explicitDeny?: boolean;
    limit?: boolean;
    audit?: boolean;
    fail?: boolean;
    mutate?: () => void;
  } = {},
) {
  const f = adapter(kind, undefined, options.mutate, options.fail);
  const audits: unknown[] = [];
  const usage: unknown[] = [];
  let routes = 0;
  const handler = createChatHandler({
    newRequestId: () => 'request',
    authenticate: async () => ({
      id: 'user',
      active: true,
      credentialId: 'credential',
      policyVersions: [],
      statements: options.deny
        ? []
        : [
            { effect: 'Allow', actions: ['*'], resources: ['*'] },
            ...(options.explicitDeny
              ? [{ effect: 'Deny' as const, actions: ['*'], resources: ['*'] }]
              : []),
          ],
    }),
    resolveRoute: async () => {
      routes++;
      return kind === 'openrouter'
        ? {
            kind: 'delegated',
            version: 'v1',
            credentialRef: 'secret/reference',
            candidates: [f.candidate],
          }
        : { version: 'v1', candidates: [f.candidate] };
    },
    checkLimit: async () => !options.limit,
    resolveSecret: async () => 'unused',
    writeAudit: async (event) => {
      if (options.audit) throw new Error('private fixture');
      audits.push(event);
    },
    writeUsage: async (record) => {
      usage.push(record);
    },
    invokeDirect: async (_, chat) => f.call(chat),
    invokeOpenRouter: async (_, __, chat) => f.call(chat),
    resolveVerifiedProviderSlug: async () => 'provider',
  });
  return { ...f, handler, audits, usage, routes: () => routes };
}
function input(fields: Record<string, unknown> = {}) {
  return {
    model: 'chat',
    messages: [{ role: 'user', content: 'private prompt' }],
    max_tokens: 17,
    temperature: 0.4,
    top_p: 0.7,
    n: 1,
    stop: ['marker'],
    response_format: { type: 'text' },
    ...fields,
  };
}
function request(path: string, fields: Record<string, unknown> = {}) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    body: JSON.stringify(input(fields)),
  });
}
const functionTool = {
  type: 'function',
  function: {
    name: 'lookup',
    description: 'private schema description',
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
    strict: true,
  },
};
const controls = {
  tools: [functionTool],
  tool_choice: { type: 'function', function: { name: 'lookup' } },
  parallel_tool_calls: false,
};
const nativeOnlyInvalid = [
  { tools: [{ type: 'function', function: { name: 'x', parameters: { bad: NaN } } }] },
  { tools: Array(1) },
  { tools: [{ type: 'function', function: { name: 'x', parameters: { enum: Array(1) } } }] },
];

for (const kind of kinds) {
  test(`${kind}: function tools and choice cross both HTTP paths`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      const f = httpFixture(kind);
      const response = await f.handler(request(path, controls));
      const supported = kind === 'openai' || kind === 'openrouter';
      assert.equal(response.status, supported ? 200 : 502);
      assert.equal(f.secrets(), supported ? 1 : 0);
      assert.equal(f.sent.length, supported ? 1 : 0);
      if (supported) {
        assert.deepEqual(f.sent[0]?.tools, controls.tools);
        assert.deepEqual(f.sent[0]?.tool_choice, controls.tool_choice);
        assert.equal(f.sent[0]?.parallel_tool_calls, false);
        assert.equal(f.usage.length, 1);
      }
      assert.doesNotMatch(
        JSON.stringify([f.audits, f.usage]),
        /private schema description|fixture-key|private prompt/u,
      );
    }
  });
  test(`${kind}: malformed tool controls reject before routing and native secrets`, async () => {
    for (const fields of [
      { tools: [{ type: 'web_search' }] },
      { tools: [{ type: 'function', function: { name: 1 } }] },
      { tools: {} },
      { tool_choice: { type: 'function', function: { name: 1 } } },
      { tool_choice: 'private malformed' },
      { parallel_tool_calls: 1 },
    ]) {
      const f = httpFixture(kind);
      const response = await f.handler(request('/api/v1/chat/completions', fields));
      assert.equal(response.status, 400);
      assert.equal(f.routes(), 0);
      assert.equal(f.secrets(), 0);
      assert.doesNotMatch(await response.text(), /private malformed|fixture-key/u);
      const native = adapter(kind);
      await assert.rejects(() => native.call(input(fields) as unknown as ChatRequest));
      assert.equal(native.secrets(), 0);
    }
    for (const fields of nativeOnlyInvalid) {
      const native = adapter(kind);
      await assert.rejects(() => native.call(input(fields) as unknown as ChatRequest));
      assert.equal(native.secrets(), 0);
    }
  });
}
test('optional choices and null parallel control preserve omission semantics', async () => {
  for (const kind of ['openai', 'openrouter'] as const)
    for (const choice of ['none', 'auto', 'required'] as const) {
      const f = httpFixture(kind);
      const response = await f.handler(
        request('/v1/chat/completions', {
          tools: [],
          tool_choice: choice,
          parallel_tool_calls: null,
        }),
      );
      assert.equal(response.status, 200);
      assert.deepEqual(f.sent[0]?.tools, []);
      assert.equal(f.sent[0]?.tool_choice, choice);
      assert.equal(f.sent[0]?.parallel_tool_calls, undefined);
    }
});
test('installed OpenAI SDK carries function tools across both bases', async () => {
  for (const kind of ['openai', 'openrouter'] as const) {
    const f = httpFixture(kind);
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
          input(controls) as OpenAI.ChatCompletionCreateParamsNonStreaming,
        );
        assert.equal(result.choices[0]?.message.content, 'reply');
        assert.deepEqual(f.sent.at(-1)?.tools, controls.tools);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
});
test('native function schemas are captured before secret await', async () => {
  for (const kind of ['openai', 'openrouter'] as const) {
    const schema = { type: 'object', properties: { query: { type: 'string' } } };
    const f = adapter(kind, undefined, () => {
      schema.properties.query.type = 'number';
    });
    await f.call(
      input({
        tools: [{ type: 'function', function: { name: 'lookup', parameters: schema } }],
      }) as unknown as ChatRequest,
    );
    const forwarded = f.sent[0]?.tools as typeof controls.tools | undefined;
    assert.ok(forwarded);
    assert.deepEqual(forwarded[0]?.function.parameters.properties.query, { type: 'string' });
  }
});
test('function controls preserve denial and failed-attempt accounting', async () => {
  for (const kind of ['openai', 'openrouter'] as const) {
    for (const [options, status] of [
      [{ deny: true }, 403],
      [{ explicitDeny: true }, 403],
      [{ limit: true }, 429],
      [{ audit: true }, 503],
    ] as const) {
      const f = httpFixture(kind, options);
      const response = await f.handler(request('/v1/chat/completions', controls));
      assert.equal(response.status, status);
      assert.equal(f.secrets(), 0);
    }
    const f = httpFixture(kind, { fail: true });
    const response = await f.handler(request('/v1/chat/completions', controls));
    assert.equal(response.status, 502);
    assert.equal((f.usage[0] as { possiblyBilled: boolean }).possiblyBilled, true);
    assert.doesNotMatch(
      JSON.stringify([f.audits, f.usage, await response.text()]),
      /private schema description|fixture-key|private prompt/u,
    );
  }
});

test('function parameter arrays reject accessor elements before reading them or resolving secrets', async () => {
  let reads = 0;
  const values = Object.defineProperty([], '0', {
    enumerable: true,
    get: () => {
      reads++;
      return 'private schema';
    },
  });
  for (const kind of ['openai', 'openrouter'] as const) {
    const f = adapter(kind);
    await assert.rejects(() =>
      f.call(
        input({
          tools: [{ type: 'function', function: { name: 'lookup', parameters: { enum: values } } }],
        }) as unknown as ChatRequest,
      ),
    );
    assert.equal(f.secrets(), 0);
    assert.equal(f.sent.length, 0);
  }
  assert.equal(reads, 0);
});
test('direct and delegated controls forward one captured declaration and choice through credential mutation', async () => {
  for (const kind of ['openai', 'openrouter'] as const) {
    let names = 0;
    let choices = 0;
    let parameters = 0;
    const schema = { type: 'object', properties: { query: { type: 'string' } } };
    const definition = Object.defineProperties(
      { description: 'private description', strict: false },
      {
        name: {
          enumerable: true,
          get: () => {
            names++;
            return names === 1 ? 'lookup' : 42;
          },
        },
        parameters: {
          enumerable: true,
          get: () => {
            parameters++;
            return parameters === 1 ? schema : null;
          },
        },
      },
    );
    const selected = Object.defineProperty({}, 'name', {
      enumerable: true,
      get: () => {
        choices++;
        return choices === 1 ? 'lookup' : 42;
      },
    });
    const f = adapter(kind, undefined, () => {
      schema.properties.query.type = 'number';
    });
    await f.call(
      input({
        tools: [{ type: 'function', function: definition }],
        tool_choice: { type: 'function', function: selected },
        parallel_tool_calls: false,
      }) as unknown as ChatRequest,
    );
    assert.deepEqual(f.sent[0]?.tools, [
      {
        type: 'function',
        function: {
          name: 'lookup',
          description: 'private description',
          strict: false,
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        },
      },
    ]);
    assert.deepEqual(f.sent[0]?.tool_choice, { type: 'function', function: { name: 'lookup' } });
    assert.equal(f.sent[0]?.parallel_tool_calls, false);
    assert.deepEqual([names, choices, parameters], [1, 1, 1]);
    assert.equal(f.secrets(), 1);
  }
});
test('invalid first tool-control fields and throwing accessors fail safely before provider credentials', async () => {
  for (const kind of kinds)
    for (const [key, invalid] of [
      ['name', ''],
      ['description', 42],
      ['strict', 'true'],
      ['parameters', null],
    ] as const)
      for (const throwing of [false, true]) {
        let reads = 0;
        const definition = Object.defineProperty({ name: 'lookup' }, key, {
          enumerable: true,
          get: () => {
            reads++;
            if (throwing) throw new Error('private accessor fixture-key');
            return reads === 1 ? invalid : 'lookup';
          },
        });
        const f = adapter(kind);
        await assert.rejects(
          () =>
            f.call(
              input({
                tools: [{ type: 'function', function: definition }],
              }) as unknown as ChatRequest,
            ),
          (error: unknown) => {
            assert.doesNotMatch(JSON.stringify(error), /private|fixture-key/u);
            assert.doesNotMatch(
              error instanceof Error ? error.message : '',
              /private|fixture-key/u,
            );
            return true;
          },
        );
        assert.equal(reads, 1);
        assert.equal(f.secrets(), 0);
        assert.equal(f.sent.length, 0);
      }
});
