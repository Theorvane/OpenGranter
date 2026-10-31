import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { type ChatRequest, createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import { createOpenRouterChatInvoker } from '../src/providers/openrouter-chat.ts';
import { createOpenRouterTextStreamInvoker } from '../src/providers/openrouter-stream.ts';

const kinds = ['openai', 'anthropic', 'google', 'openrouter'] as const;
type Kind = (typeof kinds)[number];
function body(kind: Kind) {
  if (kind === 'anthropic')
    return {
      id: 'completion',
      content: [{ type: 'text', text: '{"ok":true}' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 2, output_tokens: 1 },
    };
  if (kind === 'google')
    return {
      responseId: 'completion',
      candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 },
    };
  return {
    id: 'completion',
    created: 1,
    model: 'model',
    system_fingerprint: 'fp_fixture',
    choices: [
      { index: 0, message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' },
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
    if (!transportFails && sent.at(-1)?.stream) {
      const chunk = (delta: object, finish_reason: string | null, extra: object = {}) =>
        'data: ' +
        JSON.stringify({
          id: 'gen',
          created: 1,
          object: 'chat.completion.chunk',
          model: 'model',
          system_fingerprint: 'fp_fixture',
          choices: [{ index: 0, delta, finish_reason }],
          ...extra,
        }) +
        '\n\n';
      return new Response(
        chunk({ content: '{"ok":true}' }, null) +
          chunk({}, 'stop') +
          chunk({}, 'stop', { usage: { prompt_tokens: 2, completion_tokens: 1 } }) +
          'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }
    return transportFails
      ? new Response('private fixture unsupported top_p error', { status: 400 })
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
    stream: createOpenRouterTextStreamInvoker({
      credentialRef: 'secret/reference',
      resolveSecret,
      fetcher,
    }),
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
function nativeLimit(kind: Kind, sent: Record<string, unknown> | undefined): unknown {
  assert.ok(sent, 'Expected a captured upstream request');
  return kind === 'google'
    ? (sent.generationConfig as Record<string, unknown> | undefined)?.maxOutputTokens
    : sent.max_tokens;
}
function httpFixture(
  kind: Kind,
  options: {
    auth?: boolean;
    usageFail?: boolean;
    outcomeFail?: boolean;
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
    authenticate: async () =>
      options.auth
        ? undefined
        : {
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
          },
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
      if (options.outcomeFail && (event.kind === 'attempt' || event.kind === 'delegated-attempt'))
        throw new Error('private schema audit');
      if (options.audit) throw new Error('private fixture');
      audits.push(event);
    },
    writeUsage: async (record) => {
      if (options.usageFail) throw new Error('private schema usage');
      usage.push(record);
    },
    invokeOpenRouterTextStream: (_ref, ...args) => f.stream(...args),
    invokeDirect: async (_, chat) => f.call(chat),
    invokeOpenRouter: async (_, __, chat) => f.call(chat),
    resolveVerifiedProviderSlug: async () => 'provider',
  });
  return { ...f, handler, audits, usage, routes: () => routes };
}
function input(format?: unknown) {
  return {
    model: 'chat',
    messages: [{ role: 'user', content: 'private prompt; return JSON' }],
    max_tokens: 17,
    temperature: 0.4,
    top_p: 0.7,
    stop: ['marker'],
    n: 1,
    ...(format === undefined ? {} : { response_format: format }),
  };
}
function request(path: string, format?: unknown) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    body: JSON.stringify(input(format)),
  });
}
function assertFormat(kind: Kind, sent: Record<string, unknown> | undefined, mode?: string) {
  assert.ok(sent);
  assert.equal(nativeLimit(kind, sent), 17);
  if (kind === 'google')
    assert.equal(
      (sent.generationConfig as Record<string, unknown>).responseMimeType,
      mode === undefined ? undefined : mode === 'text' ? 'text/plain' : 'application/json',
    );
  else
    assert.deepEqual(
      sent.response_format,
      kind === 'anthropic' || mode === undefined ? undefined : { type: mode },
    );
}
for (const kind of kinds) {
  test(`${kind}: HTTP text/JSON mapping and omission retain combined controls`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      for (const mode of [undefined, 'text', 'json_object']) {
        const f = httpFixture(kind);
        const response = await f.handler(
          request(path, mode === undefined ? undefined : { type: mode }),
        );
        assert.equal(response.status, kind === 'anthropic' && mode === 'json_object' ? 502 : 200);
        if (response.status === 200) {
          assertFormat(kind, f.sent[0], mode);
          assert.equal(f.usage.length, 1);
        } else {
          assert.equal(f.secrets(), 0);
          assert.equal(f.sent.length, 0);
          assert.equal(f.usage.length, 0);
        }
        assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private prompt|fixture-key/u);
      }
    }
  });
  test(`${kind}: actual SDK uses supported response formats on both prefixes`, async () => {
    const f = httpFixture(kind);
    const server = createNodeRequestServer(f.handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      for (const base of ['/v1', '/api/v1'])
        for (const mode of kind === 'anthropic' ? ['text'] : ['text', 'json_object']) {
          const sdk = new OpenAI({
            apiKey: 'fixture',
            baseURL: `http://127.0.0.1:${address.port}${base}`,
            maxRetries: 0,
          });
          const result = await sdk.chat.completions.create(
            input({ type: mode }) as OpenAI.ChatCompletionCreateParamsNonStreaming,
          );
          assert.deepEqual(JSON.parse(result.choices[0]?.message.content ?? ''), { ok: true });
          assertFormat(kind, f.sent.at(-1), mode);
        }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}
test('format snapshots at HTTP and native boundaries resist secret-await mutation', async () => {
  for (const kind of ['openai', 'google', 'openrouter'] as const) {
    const format = { type: 'json_object' };
    const native = adapter(kind, undefined, () => {
      format.type = 'text';
    });
    await native.call(input(format) as unknown as ChatRequest);
    assertFormat(kind, native.sent[0], 'json_object');
    const payload = input({ type: 'json_object' });
    const f = httpFixture(kind, {
      mutate: () => {
        payload.response_format = { type: 'text' };
      },
    });
    const req = request('/api/v1/chat/completions', payload.response_format);
    Object.defineProperty(req, 'json', { value: async () => payload });
    assert.equal((await f.handler(req)).status, 200);
    assertFormat(kind, f.sent[0], 'json_object');
  }
});
const invalids = [
  null,
  '',
  [],
  {},
  { type: 1 },
  { type: 'json_schema', json_schema: { name: 'private schema' } },
  { type: 'grammar' },
  { type: 'python' },
  { type: 'json_object', provider: 'private destination' },
  { type: 'text', private: 'metadata' },
];
test('malformed formats reject at HTTP before routing and keep metadata safe', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const format of invalids) {
      const f = httpFixture('openrouter');
      const response = await f.handler(request(path, format));
      assert.equal(response.status, 400);
      assert.equal(f.routes(), 0);
      assert.equal(f.secrets(), 0);
      assert.equal(f.usage.length, 0);
      assert.doesNotMatch(await response.text(), /private/u);
      assert.doesNotMatch(JSON.stringify(f.audits), /private/u);
    }
});
test('native malformed and unsupported JSON formats reject before credential/transport', async () => {
  for (const kind of kinds)
    for (const format of [
      ...invalids,
      ...(kind === 'anthropic' ? [{ type: 'json_object' }] : []),
    ]) {
      const f = adapter(kind);
      await assert.rejects(
        () => f.call(input(format) as unknown as ChatRequest),
        (error: unknown) =>
          error instanceof Error && 'possiblyBilled' in error && error.possiblyBilled === false,
      );
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
    }
});
test('response formats retain IAM, limits and required audit across both paths', async () => {
  for (const kind of kinds)
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
      for (const [options, status] of [
        [{ deny: true }, 403],
        [{ explicitDeny: true }, 403],
        [{ limit: true }, 429],
        [{ audit: true }, 503],
      ] as const) {
        const f = httpFixture(kind, options);
        assert.equal((await f.handler(request(path, { type: 'text' }))).status, status);
        assert.equal(f.secrets(), 0);
        assert.equal(f.sent.length, 0);
        assert.equal(f.usage.length, 0);
      }
});
test('response formats preserve safe upstream failure accounting', async () => {
  for (const kind of kinds) {
    const f = httpFixture(kind, { fail: true });
    const response = await f.handler(
      request('/api/v1/chat/completions', { type: kind === 'anthropic' ? 'text' : 'json_object' }),
    );
    assert.equal(response.status, 502);
    assert.equal(f.usage.length, 1);
    assert.doesNotMatch(await response.text(), /private|fixture-key/u);
    assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private prompt|fixture-key/u);
  }
});

function schemaFormat(strict?: boolean | null) {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: 'result_1-v2',
      description: 'private schema description 思考',
      ...(strict === undefined ? {} : { strict }),
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean', description: 'private literal' } },
        required: ['ok'],
        additionalProperties: false,
        $defs: { nested: { enum: [null, true, 3, 'Unicode 思考'] } },
        $ref: 'https://unregistered.invalid/private-schema',
      },
    },
  };
}
for (const kind of ['openai', 'openrouter'] as const) {
  test(`${kind}: JSON-schema formats forward exact bounded JSON on both HTTP bases`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
      for (const strict of [undefined, null, false, true]) {
        const format = schemaFormat(strict);
        const f = httpFixture(kind);
        const response = await f.handler(request(path, format));
        assert.equal(response.status, 200);
        assert.deepEqual(f.sent[0]?.response_format, format);
        assert.equal(f.sent.length, 1);
        assert.equal(f.secrets(), 1);
        assert.equal(nativeLimit(kind, f.sent[0]), 17);
        assert.equal(f.usage.length, 1);
        assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private|fixture-key/u);
      }
  });
  test(`${kind}: nested schema snapshots resist asynchronous mutation at both boundaries`, async () => {
    for (const http of [false, true]) {
      const format = schemaFormat(true);
      const expected = structuredClone(format);
      const mutate = () => {
        format.json_schema.schema.properties.ok.description = 'changed';
        format.json_schema.schema.required.push('other');
        format.json_schema.name = 'changed';
      };
      if (http) {
        const f = httpFixture(kind, { mutate });
        const req = request('/api/v1/chat/completions', format);
        Object.defineProperty(req, 'json', { value: async () => input(format) });
        assert.equal((await f.handler(req)).status, 200);
        assert.deepEqual(f.sent[0]?.response_format, expected);
      } else {
        const f = adapter(kind, undefined, mutate);
        await f.call(input(format) as unknown as ChatRequest);
        assert.deepEqual(f.sent[0]?.response_format, expected);
      }
    }
  });
  test(`${kind}: JSON-schema formats retain denial, persistence and safe transport failure controls`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
      for (const [options, status, dispatched] of [
        [{ auth: true }, 401, false],
        [{ deny: true }, 403, false],
        [{ explicitDeny: true }, 403, false],
        [{ limit: true }, 429, false],
        [{ audit: true }, 503, false],
        [{ usageFail: true }, 503, true],
        [{ outcomeFail: true }, 503, true],
        [{ fail: true }, 502, true],
      ] as const) {
        const f = httpFixture(kind, options);
        const response = await f.handler(request(path, schemaFormat()));
        assert.equal(response.status, status);
        assert.equal(f.sent.length, dispatched ? 1 : 0);
        assert.equal(f.secrets(), dispatched ? 1 : 0);
        assert.doesNotMatch(await response.text(), /private|fixture-key/u);
        assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private|fixture-key/u);
      }
  });
  test(`${kind}: actual OpenAI SDK forwards JSON-schema output on both bases`, async () => {
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
          input(schemaFormat(true)) as OpenAI.ChatCompletionCreateParamsNonStreaming,
        );
        assert.equal(result.choices[0]?.message.content, '{"ok":true}');
        assert.deepEqual(f.sent.at(-1)?.response_format, schemaFormat(true));
        const omitted = { type: 'json_schema', json_schema: { name: 'result', strict: null } };
        await sdk.chat.completions.create(
          input(omitted) as OpenAI.ChatCompletionCreateParamsNonStreaming,
        );
        assert.deepEqual(f.sent.at(-1)?.response_format, omitted);
        const forwarded = f.sent.at(-1)?.response_format as { json_schema: object } | undefined;
        assert.ok(forwarded);
        assert.equal(Object.hasOwn(forwarded.json_schema, 'schema'), false);
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}
test('unsupported native JSON-schema formats reject before credentials or transport', async () => {
  for (const kind of ['anthropic', 'google'] as const)
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      const f = httpFixture(kind);
      const response = await f.handler(request(path, schemaFormat()));
      assert.equal(response.status, 502);
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
      assert.equal(f.usage.length, 0);
      assert.doesNotMatch(await response.text(), /private/u);
    }
});
test('malformed JSON-schema configs reject before routing on both bases', async () => {
  const config = schemaFormat().json_schema;
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const json_schema of [
      null,
      [],
      {},
      ...['', 'name with spaces', 'x'.repeat(65), '非ascii'].map((name) => ({ ...config, name })),
      ...[null, true, []].map((schema) => ({ ...config, schema })),
      { ...config, description: null },
      { ...config, strict: 'true' },
      { ...config, provider: 'private destination' },
    ]) {
      const f = httpFixture('openrouter');
      const response = await f.handler(request(path, { type: 'json_schema', json_schema }));
      assert.equal(response.status, 400);
      assert.equal(f.routes(), 0);
      assert.equal(f.secrets(), 0);
      assert.doesNotMatch(await response.text(), /private/u);
    }
});
test('native schema capture rejects non-JSON trees and bounded-resource violations before secrets', async () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  let deep: Record<string, unknown> = {};
  for (let i = 0; i < 70; i++) deep = { nested: deep };
  let reads = 0;
  const accessor = Object.defineProperty({}, 'private', {
    enumerable: true,
    get: () => {
      reads++;
      return 'private';
    },
  });
  const array = Object.defineProperty([], '0', {
    enumerable: true,
    get: () => {
      reads++;
      return 'private';
    },
  });
  for (const schema of [
    cycle,
    deep,
    { many: Array(20001).fill(1) },
    { hole: Array(1) },
    { invalid: Infinity },
    { invalid: undefined },
    { invalid: new Date() },
    accessor,
    { array },
  ])
    for (const kind of ['openai', 'openrouter'] as const) {
      const f = adapter(kind);
      await assert.rejects(() =>
        f.call(
          input({
            type: 'json_schema',
            json_schema: { name: 'result', schema },
          }) as unknown as ChatRequest,
        ),
      );
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
    }
  assert.equal(reads, 0);
});

test('official OpenRouter SDK preserves JSON-schema formats on both nonstream and delegated stream bases', async () => {
  const f = httpFixture('openrouter');
  const server = createNodeRequestServer(f.handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    for (const base of ['/v1', '/api/v1']) {
      const sdk = new OpenRouter({
        apiKey: 'fixture',
        serverURL: `http://127.0.0.1:${address.port}${base}`,
        retryConfig: { strategy: 'none' },
        timeoutMs: 3000,
      });
      for (const stream of [false, true]) {
        for (const includeSchema of [false, true]) {
          const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
          const result = await sdk.chat.send({
            chatRequest: {
              model: 'chat',
              messages: [{ role: 'user', content: 'private prompt' }],
              stream,
              responseFormat: {
                type: 'json_schema',
                jsonSchema: {
                  name: 'result',
                  strict: true,
                  ...(includeSchema ? { schema } : {}),
                },
              },
            },
          });
          if (stream) {
            assert.ok(Symbol.asyncIterator in result);
            let content = '';
            let usageEvents = 0;
            for await (const event of result) {
              content += event.choices[0]?.delta.content ?? '';
              if (event.usage) usageEvents++;
            }
            assert.equal(content, '{"ok":true}');
            assert.equal(usageEvents, 1);
          } else {
            assert.ok('choices' in result);
            assert.equal(result.choices[0]?.message.content, '{"ok":true}');
          }
          assert.deepEqual(f.sent.at(-1)?.response_format, {
            type: 'json_schema',
            json_schema: {
              name: 'result',
              strict: true,
              ...(includeSchema ? { schema } : {}),
            },
          });
        }
      }
    }
    assert.equal(f.usage.length, 8);
    assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private|fixture-key/u);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

for (const kind of ['openai', 'openrouter'] as const) {
  test(`${kind}: optional schema forwards absence or supplied empty object exactly`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
      for (const config of [
        { name: 'result' },
        { name: 'result', strict: null },
        { name: 'result', strict: false, description: 'private description' },
        { name: 'result', strict: true },
        { name: 'result', schema: {} },
      ]) {
        const format = { type: 'json_schema', json_schema: config };
        const f = httpFixture(kind);
        const response = await f.handler(request(path, format));
        assert.equal(response.status, 200);
        assert.deepEqual(f.sent[0]?.response_format, format);
        assert.equal(f.sent.length, 1);
        assert.equal(f.secrets(), 1);
        assert.equal(f.usage.length, 1);
        assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private|fixture-key/u);
      }
  });
  test(`${kind}: omitted schema cannot be added during secret awaits`, async () => {
    for (const http of [false, true]) {
      const config: { name: string; schema?: object } = { name: 'result' };
      const format = { type: 'json_schema', json_schema: config };
      const mutate = () => {
        config.schema = { private: 'late schema' };
      };
      if (http) {
        const f = httpFixture(kind, { mutate });
        const req = request('/api/v1/chat/completions', format);
        Object.defineProperty(req, 'json', { value: async () => input(format) });
        assert.equal((await f.handler(req)).status, 200);
        assert.deepEqual(f.sent[0]?.response_format, {
          type: 'json_schema',
          json_schema: { name: 'result' },
        });
      } else {
        const f = adapter(kind, undefined, mutate);
        await f.call(input(format) as unknown as ChatRequest);
        assert.deepEqual(f.sent[0]?.response_format, {
          type: 'json_schema',
          json_schema: { name: 'result' },
        });
      }
    }
  });
  test(`${kind}: schema omission retains auth denial persistence and upstream failure controls`, async () => {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
      for (const [options, status, dispatched] of [
        [{ auth: true }, 401, false],
        [{ deny: true }, 403, false],
        [{ explicitDeny: true }, 403, false],
        [{ limit: true }, 429, false],
        [{ audit: true }, 503, false],
        [{ usageFail: true }, 503, true],
        [{ outcomeFail: true }, 503, true],
        [{ fail: true }, 502, true],
      ] as const) {
        const f = httpFixture(kind, options);
        const response = await f.handler(
          request(path, { type: 'json_schema', json_schema: { name: 'result' } }),
        );
        assert.equal(response.status, status);
        assert.equal(f.secrets(), dispatched ? 1 : 0);
        assert.equal(f.sent.length, dispatched ? 1 : 0);
        assert.doesNotMatch(await response.text(), /private|fixture-key/u);
        assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private|fixture-key/u);
      }
  });
}
test('omitted schemas retain native provider rejection and supplied malformed schema validation', async () => {
  for (const kind of ['anthropic', 'google'] as const)
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      const f = httpFixture(kind);
      const response = await f.handler(
        request(path, { type: 'json_schema', json_schema: { name: 'result' } }),
      );
      assert.equal(response.status, 502);
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
      assert.equal(f.usage.length, 0);
    }
  for (const kind of ['openai', 'openrouter'] as const)
    for (const schema of [undefined, null, true, [], new Date()]) {
      const f = adapter(kind);
      await assert.rejects(() =>
        f.call(
          input({
            type: 'json_schema',
            json_schema: { name: 'result', schema },
          }) as unknown as ChatRequest,
        ),
      );
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
    }
});

function googleSchemaFormat() {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: 'result',
      strict: false,
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', description: 'private schema literal' },
          values: { type: 'array', items: { type: 'integer' } },
        },
        required: ['ok'],
        additionalProperties: false,
      },
    },
  };
}
test('Gemini bounded non-strict schemas forward exact snapshots on both bases', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const format = googleSchemaFormat();
    const expected = structuredClone(format.json_schema.schema);
    const f = httpFixture('google', {
      mutate: () => {
        format.json_schema.schema.properties.ok.description = 'changed';
      },
    });
    const req = request(path, format);
    Object.defineProperty(req, 'json', { value: async () => input(format) });
    assert.equal((await f.handler(req)).status, 200);
    const config = f.sent[0]?.generationConfig as Record<string, unknown>;
    assert.deepEqual(config.responseJsonSchema, expected);
    assert.equal(config.responseMimeType, 'application/json');
    assert.equal(config.responseSchema, undefined);
    assert.equal(f.secrets(), 1);
    assert.equal(f.usage.length, 1);
    assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private schema|fixture-key/u);
  }
});
test('Gemini non-strict schemas retain IAM limits and persistence failure boundaries', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const [options, status, dispatched] of [
      [{ auth: true }, 401, false],
      [{ deny: true }, 403, false],
      [{ explicitDeny: true }, 403, false],
      [{ limit: true }, 429, false],
      [{ audit: true }, 503, false],
      [{ usageFail: true }, 503, true],
      [{ outcomeFail: true }, 503, true],
      [{ fail: true }, 502, true],
    ] as const) {
      const f = httpFixture('google', options);
      const response = await f.handler(request(path, googleSchemaFormat()));
      assert.equal(response.status, status);
      assert.equal(f.sent.length, dispatched ? 1 : 0);
      assert.equal(f.secrets(), dispatched ? 1 : 0);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
    }
});
test('Gemini unsupported schema semantics and tool composition reject before secrets', async () => {
  const schema = googleSchemaFormat().json_schema.schema;
  for (const config of [
    { name: 'result', schema },
    { name: 'result', schema, strict: true },
    { name: 'result', schema, strict: null },
    { name: 'result', strict: false },
    ...[
      { ...schema, $ref: 'https://unregistered.invalid/schema' },
      { ...schema, required: ['missing'] },
      { ...schema, required: ['ok', 'ok'] },
      { ...schema, additionalProperties: { type: 'string', pattern: 'unsupported' } },
      { type: 'array', items: { type: 'string' } },
      { type: 'object', properties: { a: { type: 'array' } } },
      { type: 'object', properties: { a: { type: 'string', pattern: 'private' } } },
      { type: 'object', properties: { a: { type: 'string', properties: {} } } },
    ].map((schema) => ({ name: 'result', strict: false, schema })),
  ]) {
    const f = adapter('google');
    await assert.rejects(() =>
      f.call(input({ type: 'json_schema', json_schema: config }) as unknown as ChatRequest),
    );
    assert.equal(f.secrets(), 0);
    assert.equal(f.sent.length, 0);
  }
  for (const controls of [{ tool_choice: 'none' }, { parallel_tool_calls: true }, { tools: [] }]) {
    const f = adapter('google');
    await assert.rejects(() =>
      f.call({ ...input(googleSchemaFormat()), ...controls } as unknown as ChatRequest),
    );
    assert.equal(f.secrets(), 0);
  }
});

test('Gemini schema type arrays are not coerced into native scalar types', async () => {
  const f = adapter('google');
  const format = {
    type: 'json_schema',
    json_schema: {
      name: 'result',
      strict: false,
      schema: {
        type: 'object',
        properties: { value: { type: ['string'] } },
      },
    },
  };
  await assert.rejects(() => f.call(input(format) as unknown as ChatRequest));
  assert.equal(f.secrets(), 0);
});

test('Gemini non-strict schemas work through actual OpenAI SDK sockets on both bases', async () => {
  const f = httpFixture('google');
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
        input(googleSchemaFormat()) as OpenAI.ChatCompletionCreateParamsNonStreaming,
      );
      assert.equal(result.choices[0]?.message.content, '{"ok":true}');
      const config = f.sent.at(-1)?.generationConfig as Record<string, unknown>;
      assert.deepEqual(config.responseJsonSchema, googleSchemaFormat().json_schema.schema);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('Gemini non-strict schemas use the same captured native text-stream transport', async () => {
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  const sent: Record<string, unknown>[] = [];
  const format = googleSchemaFormat();
  const expected = structuredClone(format.json_schema.schema);
  const invoke = createDirectGoogleTextStreamInvoker({
    registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' }],
    resolveSecret: async () => {
      format.json_schema.schema.properties.ok.description = 'changed';
      return 'fixture-key';
    },
    fetcher: async (_, init) => {
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        'data: ' +
          JSON.stringify({
            responseId: 'response',
            modelVersion: 'model',
            candidates: [
              {
                index: 0,
                content: { role: 'model', parts: [{ text: '{"ok":true}' }] },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
          }) +
          '\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  const seen: unknown[] = [];
  const result = await invoke(
    { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'model' },
    { ...input(format), stream: true } as unknown as ChatRequest,
    (delta) => {
      seen.push(delta);
    },
  );
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.usage?.total_tokens, 3);
  assert.ok(JSON.stringify(seen).includes('ok'));
  assert.deepEqual(
    (sent[0]?.generationConfig as Record<string, unknown> | undefined)?.responseJsonSchema,
    expected,
  );
});

function googleEnumFormat() {
  const format = googleSchemaFormat();
  return {
    ...format,
    json_schema: {
      ...format.json_schema,
      schema: {
        type: 'object',
        properties: {
          label: { type: 'string', enum: ['private enum literal', ''] },
          score: { type: 'number', enum: [-0.5, 0, 1.25] },
          values: { type: 'array', items: { type: 'integer', enum: [0, -1, 2] } },
        },
        required: ['label'],
        additionalProperties: false,
      },
    },
  };
}
test('Gemini enums forward exact immutable schemas on both bases', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const format = googleEnumFormat();
    const expected = structuredClone(format.json_schema.schema);
    const f = httpFixture('google', {
      mutate: () => {
        format.json_schema.schema.properties.label.enum[0] = 'changed';
      },
    });
    const req = request(path, format);
    Object.defineProperty(req, 'json', { value: async () => input(format) });
    assert.equal((await f.handler(req)).status, 200);
    assert.deepEqual(
      (f.sent[0]?.generationConfig as Record<string, unknown> | undefined)?.responseJsonSchema,
      expected,
    );
    assert.equal(f.secrets(), 1);
    assert.equal(f.usage.length, 1);
    assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private enum|fixture-key/u);
  }
});
test('Gemini enum boundaries and malformed enums reject before credentials', async () => {
  const valid = { type: 'string', enum: Array.from({ length: 128 }, (_, i) => String(i)) };
  const f = adapter('google');
  const format = (node: unknown) => ({
    type: 'json_schema',
    json_schema: {
      name: 'result',
      strict: false,
      schema: { type: 'object', properties: { value: node } },
    },
  });
  await f.call(input(format(valid)) as unknown as ChatRequest);
  for (const node of [
    { type: 'string', enum: [] },
    { type: 'string', enum: ['x', 'x'] },
    { type: 'string', enum: [1] },
    { type: 'number', enum: ['1'] },
    { type: 'number', enum: [1, 'x'] },
    { type: 'integer', enum: [1.5] },
    { type: 'boolean', enum: [true] },
    { type: 'null', enum: [null] },
    { type: 'object', enum: [{}] },
    { type: 'array', items: { type: 'string' }, enum: [[]] },
    { type: 'string', enum: 'x' },
    { type: 'string', enum: null },
    { type: 'string', enum: [...valid.enum, '129'] },
    { type: 'number', enum: [0, -0] },
    { type: 'number', enum: [Number.POSITIVE_INFINITY] },
    { type: 'number', enum: [Number.NaN] },
  ]) {
    const denied = adapter('google');
    await assert.rejects(() => denied.call(input(format(node)) as unknown as ChatRequest));
    assert.equal(denied.secrets(), 0);
    assert.equal(denied.sent.length, 0);
  }
});
test('Gemini enum schemas retain IAM limits and persistence failure boundaries', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const [options, status, dispatched] of [
      [{ auth: true }, 401, false],
      [{ deny: true }, 403, false],
      [{ explicitDeny: true }, 403, false],
      [{ limit: true }, 429, false],
      [{ audit: true }, 503, false],
      [{ usageFail: true }, 503, true],
      [{ outcomeFail: true }, 503, true],
      [{ fail: true }, 502, true],
    ] as const) {
      const f = httpFixture('google', options);
      const response = await f.handler(request(path, googleEnumFormat()));
      assert.equal(response.status, status);
      assert.equal(f.sent.length, dispatched ? 1 : 0);
      assert.equal(f.secrets(), dispatched ? 1 : 0);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
    }
});
test('Gemini enum schemas work through actual OpenAI SDK sockets on both bases', async () => {
  const f = httpFixture('google');
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
        input(googleEnumFormat()) as OpenAI.ChatCompletionCreateParamsNonStreaming,
      );
      assert.equal(result.choices[0]?.message.content, '{"ok":true}');
      const config = f.sent.at(-1)?.generationConfig as Record<string, unknown>;
      assert.deepEqual(config.responseJsonSchema, googleEnumFormat().json_schema.schema);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('Gemini enum schemas use the same captured native text-stream transport', async () => {
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  const sent: Record<string, unknown>[] = [];
  const format = googleEnumFormat();
  const expected = structuredClone(format.json_schema.schema);
  const invoke = createDirectGoogleTextStreamInvoker({
    registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' }],
    resolveSecret: async () => {
      format.json_schema.schema.properties.label.enum[0] = 'changed';
      return 'fixture-key';
    },
    fetcher: async (_, init) => {
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        'data: ' +
          JSON.stringify({
            responseId: 'response',
            modelVersion: 'model',
            candidates: [
              {
                index: 0,
                content: { role: 'model', parts: [{ text: '{"ok":true}' }] },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
          }) +
          '\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  const seen: unknown[] = [];
  const result = await invoke(
    { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'model' },
    { ...input(format), stream: true } as unknown as ChatRequest,
    (delta) => {
      seen.push(delta);
    },
  );
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.usage?.total_tokens, 3);
  assert.ok(JSON.stringify(seen).includes('ok'));
  assert.deepEqual(
    (sent[0]?.generationConfig as Record<string, unknown> | undefined)?.responseJsonSchema,
    expected,
  );
});

function googleNumericFormat() {
  const format = googleSchemaFormat();
  return {
    ...format,
    json_schema: {
      ...format.json_schema,
      schema: {
        type: 'object',
        properties: {
          label: {
            type: 'number',
            minimum: -0.5,
            maximum: 1.25,
            description: 'private numeric literal',
          },
          score: { type: 'integer', minimum: -1.5, maximum: 2.5 },
          values: { type: 'array', items: { type: 'number', minimum: 0, maximum: 0, enum: [0] } },
        },
        required: ['label'],
        additionalProperties: false,
      },
    },
  };
}
test('Gemini numeric bounds forward exact immutable schemas on both bases', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const format = googleNumericFormat();
    const expected = structuredClone(format.json_schema.schema);
    const f = httpFixture('google', {
      mutate: () => {
        format.json_schema.schema.properties.label.minimum = -999;
      },
    });
    const req = request(path, format);
    Object.defineProperty(req, 'json', { value: async () => input(format) });
    assert.equal((await f.handler(req)).status, 200);
    assert.deepEqual(
      (f.sent[0]?.generationConfig as Record<string, unknown> | undefined)?.responseJsonSchema,
      expected,
    );
    assert.equal(f.secrets(), 1);
    assert.equal(f.usage.length, 1);
    assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private numeric|fixture-key/u);
  }
});
test('Gemini numeric-bound schemas retain IAM limits and persistence failure boundaries', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const [options, status, dispatched] of [
      [{ auth: true }, 401, false],
      [{ deny: true }, 403, false],
      [{ explicitDeny: true }, 403, false],
      [{ limit: true }, 429, false],
      [{ audit: true }, 503, false],
      [{ usageFail: true }, 503, true],
      [{ outcomeFail: true }, 503, true],
      [{ fail: true }, 502, true],
    ] as const) {
      const f = httpFixture('google', options);
      const response = await f.handler(request(path, googleNumericFormat()));
      assert.equal(response.status, status);
      assert.equal(f.sent.length, dispatched ? 1 : 0);
      assert.equal(f.secrets(), dispatched ? 1 : 0);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
    }
});
test('Gemini numeric-bound schemas work through actual OpenAI SDK sockets on both bases', async () => {
  const f = httpFixture('google');
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
        input(googleNumericFormat()) as OpenAI.ChatCompletionCreateParamsNonStreaming,
      );
      assert.equal(result.choices[0]?.message.content, '{"ok":true}');
      const config = f.sent.at(-1)?.generationConfig as Record<string, unknown>;
      assert.deepEqual(config.responseJsonSchema, googleNumericFormat().json_schema.schema);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('Gemini numeric-bound schemas use the same captured native text-stream transport', async () => {
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  const sent: Record<string, unknown>[] = [];
  const format = googleNumericFormat();
  const expected = structuredClone(format.json_schema.schema);
  const invoke = createDirectGoogleTextStreamInvoker({
    registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' }],
    resolveSecret: async () => {
      format.json_schema.schema.properties.label.minimum = -999;
      return 'fixture-key';
    },
    fetcher: async (_, init) => {
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        'data: ' +
          JSON.stringify({
            responseId: 'response',
            modelVersion: 'model',
            candidates: [
              {
                index: 0,
                content: { role: 'model', parts: [{ text: '{"ok":true}' }] },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
          }) +
          '\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  const seen: unknown[] = [];
  const result = await invoke(
    { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'model' },
    { ...input(format), stream: true } as unknown as ChatRequest,
    (delta) => {
      seen.push(delta);
    },
  );
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.usage?.total_tokens, 3);
  assert.ok(JSON.stringify(seen).includes('ok'));
  assert.deepEqual(
    (sent[0]?.generationConfig as Record<string, unknown> | undefined)?.responseJsonSchema,
    expected,
  );
});

test('Gemini numeric bound edges preserve exact values on both bases', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const node of [
      { type: 'number', minimum: -Number.MAX_VALUE, maximum: Number.MAX_VALUE },
      { type: 'number', minimum: Number.MIN_VALUE },
      { type: 'number', maximum: -Number.MIN_VALUE },
      { type: 'number', minimum: -0, maximum: 0 },
      { type: 'number', minimum: 0.125, maximum: 0.125 },
      { type: 'integer', minimum: -1.5, maximum: 2.5 },
      { type: 'integer', minimum: 0.1, maximum: 0.2 },
      { type: 'integer', maximum: 0 },
      { type: 'number', minimum: 5, enum: [1] },
    ]) {
      const format = {
        type: 'json_schema',
        json_schema: {
          name: 'result',
          strict: false,
          schema: { type: 'object', properties: { value: node } },
        },
      };
      const f = httpFixture('google');
      const req = request(path, format);
      Object.defineProperty(req, 'json', { value: async () => input(format) });
      assert.equal((await f.handler(req)).status, 200);
      assert.deepEqual(
        (f.sent[0]?.generationConfig as Record<string, unknown> | undefined)?.responseJsonSchema,
        // JSON serialization canonically represents negative zero as zero.
        JSON.parse(JSON.stringify(format.json_schema.schema)),
      );
      assert.equal(f.secrets(), 1);
      assert.equal(f.usage.length, 1);
    }
});
test('Gemini malformed numeric bounds reject before secrets without coercion', async () => {
  const nodes = [
    ...['minimum', 'maximum'].flatMap((key) => [
      ...[null, '1', true, [], {}, Number.NaN, Infinity, -Infinity].map((value) => ({
        type: 'number',
        [key]: value,
      })),
      ...['string', 'boolean', 'null', 'object'].map((type) => ({ type, [key]: 0 })),
      { type: 'array', items: { type: 'number' }, [key]: 0 },
    ]),
    { type: 'number', minimum: 1, maximum: 0 },
    { type: 'integer', minimum: -0.1, maximum: -0.2 },
    { type: 'number', exclusiveMinimum: 0 },
    { type: 'number', exclusiveMaximum: 1 },
  ];
  for (const node of nodes) {
    const format = {
      type: 'json_schema',
      json_schema: {
        name: 'result',
        strict: false,
        schema: { type: 'object', properties: { value: node } },
      },
    };
    const f = adapter('google');
    await assert.rejects(() => f.call(input(format) as unknown as ChatRequest));
    assert.equal(f.secrets(), 0);
    assert.equal(f.sent.length, 0);
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      const h = httpFixture('google');
      const req = request(path, format);
      Object.defineProperty(req, 'json', { value: async () => input(format) });
      assert.equal((await h.handler(req)).status, 502);
      assert.equal(h.secrets(), 0);
      assert.equal(h.sent.length, 0);
    }
  }
});

function googleArrayFormat() {
  const format = googleSchemaFormat();
  return {
    ...format,
    json_schema: {
      ...format.json_schema,
      schema: {
        type: 'object',
        properties: {
          label: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 3,
            description: 'private array-length literal',
          },
          score: { type: 'integer', minimum: -1.5, maximum: 2.5 },
          values: { type: 'array', items: { type: 'number', minimum: 0, maximum: 0, enum: [0] } },
        },
        required: ['label'],
        additionalProperties: false,
      },
    },
  };
}
test('Gemini array-length bounds forward exact immutable schemas on both bases', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const format = googleArrayFormat();
    const expected = structuredClone(format.json_schema.schema);
    const f = httpFixture('google', {
      mutate: () => {
        format.json_schema.schema.properties.label.minItems = 999;
      },
    });
    const req = request(path, format);
    Object.defineProperty(req, 'json', { value: async () => input(format) });
    assert.equal((await f.handler(req)).status, 200);
    assert.deepEqual(
      (f.sent[0]?.generationConfig as Record<string, unknown> | undefined)?.responseJsonSchema,
      expected,
    );
    assert.equal(f.secrets(), 1);
    assert.equal(f.usage.length, 1);
    assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private array-length|fixture-key/u);
  }
});
test('Gemini array-length-bound schemas retain IAM limits and persistence failure boundaries', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const [options, status, dispatched] of [
      [{ auth: true }, 401, false],
      [{ deny: true }, 403, false],
      [{ explicitDeny: true }, 403, false],
      [{ limit: true }, 429, false],
      [{ audit: true }, 503, false],
      [{ usageFail: true }, 503, true],
      [{ outcomeFail: true }, 503, true],
      [{ fail: true }, 502, true],
    ] as const) {
      const f = httpFixture('google', options);
      const response = await f.handler(request(path, googleArrayFormat()));
      assert.equal(response.status, status);
      assert.equal(f.sent.length, dispatched ? 1 : 0);
      assert.equal(f.secrets(), dispatched ? 1 : 0);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
    }
});
test('Gemini array-length-bound schemas work through actual OpenAI SDK sockets on both bases', async () => {
  const f = httpFixture('google');
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
        input(googleArrayFormat()) as OpenAI.ChatCompletionCreateParamsNonStreaming,
      );
      assert.equal(result.choices[0]?.message.content, '{"ok":true}');
      const config = f.sent.at(-1)?.generationConfig as Record<string, unknown>;
      assert.deepEqual(config.responseJsonSchema, googleArrayFormat().json_schema.schema);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('Gemini array-length-bound schemas use the same captured native text-stream transport', async () => {
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  const sent: Record<string, unknown>[] = [];
  const format = googleArrayFormat();
  const expected = structuredClone(format.json_schema.schema);
  const invoke = createDirectGoogleTextStreamInvoker({
    registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' }],
    resolveSecret: async () => {
      format.json_schema.schema.properties.label.minItems = 999;
      return 'fixture-key';
    },
    fetcher: async (_, init) => {
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        'data: ' +
          JSON.stringify({
            responseId: 'response',
            modelVersion: 'model',
            candidates: [
              {
                index: 0,
                content: { role: 'model', parts: [{ text: '{"ok":true}' }] },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
          }) +
          '\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  const seen: unknown[] = [];
  const result = await invoke(
    { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'model' },
    { ...input(format), stream: true } as unknown as ChatRequest,
    (delta) => {
      seen.push(delta);
    },
  );
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.usage?.total_tokens, 3);
  assert.ok(JSON.stringify(seen).includes('ok'));
  assert.deepEqual(
    (sent[0]?.generationConfig as Record<string, unknown> | undefined)?.responseJsonSchema,
    expected,
  );
});

test('Gemini array length bound edges preserve exact values on both bases', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const bounds of [
      { minItems: 0, maxItems: 0 },
      { minItems: 1, maxItems: 1 },
      { minItems: 0 },
      { maxItems: 0 },
      { minItems: Number.MAX_SAFE_INTEGER },
      { maxItems: Number.MAX_SAFE_INTEGER },
      { minItems: -0, maxItems: 2 },
    ]) {
      const node = {
        type: 'array',
        items: { type: 'array', minItems: 1, items: { type: 'number' } },
        ...bounds,
      };
      const format = {
        type: 'json_schema',
        json_schema: {
          name: 'result',
          strict: false,
          schema: { type: 'object', properties: { value: node } },
        },
      };
      const f = httpFixture('google');
      const req = request(path, format);
      Object.defineProperty(req, 'json', { value: async () => input(format) });
      assert.equal((await f.handler(req)).status, 200);
      assert.deepEqual(
        (f.sent[0]?.generationConfig as Record<string, unknown> | undefined)?.responseJsonSchema,
        // JSON serialization canonically represents negative zero as zero.
        JSON.parse(JSON.stringify(format.json_schema.schema)),
      );
      assert.equal(f.secrets(), 1);
      assert.equal(f.usage.length, 1);
    }
});
test('Gemini malformed array length bounds reject before secrets without coercion', async () => {
  const nodes = [
    ...['minItems', 'maxItems'].flatMap((key) => [
      ...[
        null,
        '1',
        true,
        [],
        {},
        -1,
        0.5,
        Number.MAX_SAFE_INTEGER + 1,
        Number.NaN,
        Infinity,
        -Infinity,
      ].map((value) => ({ type: 'array', items: { type: 'number' }, [key]: value })),
      ...['string', 'number', 'integer', 'boolean', 'null', 'object'].map((type) => ({
        type,
        [key]: 0,
      })),
    ]),
    { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 1 },
    { type: 'array', minItems: 1 },
    { type: 'array', items: { type: 'string' }, uniqueItems: true },
    { type: 'array', items: { type: 'string' }, contains: { type: 'string' } },
  ];
  for (const node of nodes) {
    const format = {
      type: 'json_schema',
      json_schema: {
        name: 'result',
        strict: false,
        schema: { type: 'object', properties: { value: node } },
      },
    };
    const f = adapter('google');
    await assert.rejects(() => f.call(input(format) as unknown as ChatRequest));
    assert.equal(f.secrets(), 0);
    assert.equal(f.sent.length, 0);
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      const h = httpFixture('google');
      const req = request(path, format);
      Object.defineProperty(req, 'json', { value: async () => input(format) });
      assert.equal((await h.handler(req)).status, 502);
      assert.equal(h.secrets(), 0);
      assert.equal(h.sent.length, 0);
    }
  }
});

function googlePropertyFormat() {
  const format = googleSchemaFormat();
  return {
    ...format,
    json_schema: {
      ...format.json_schema,
      schema: {
        type: 'object',
        properties: {
          label: {
            type: 'object',
            additionalProperties: {
              type: 'array',
              items: { type: 'string', enum: ['a', 'b'] },
              minItems: 1,
              maxItems: 3,
            },
            description: 'private property-schema literal',
          },
          score: { type: 'integer', minimum: -1.5, maximum: 2.5 },
          values: { type: 'array', items: { type: 'number', minimum: 0, maximum: 0, enum: [0] } },
        },
        required: ['label'],
        additionalProperties: false,
      },
    },
  };
}
test('Gemini property schemas forward exact immutable schemas on both bases', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const format = googlePropertyFormat();
    const expected = structuredClone(format.json_schema.schema);
    const f = httpFixture('google', {
      mutate: () => {
        format.json_schema.schema.properties.label.additionalProperties.minItems = 999;
      },
    });
    const req = request(path, format);
    Object.defineProperty(req, 'json', { value: async () => input(format) });
    assert.equal((await f.handler(req)).status, 200);
    assert.deepEqual(
      (f.sent[0]?.generationConfig as Record<string, unknown> | undefined)?.responseJsonSchema,
      expected,
    );
    assert.equal(f.secrets(), 1);
    assert.equal(f.usage.length, 1);
    assert.doesNotMatch(
      JSON.stringify([f.audits, f.usage]),
      /private property-schema|fixture-key/u,
    );
  }
});
test('Gemini property-schema schemas retain IAM limits and persistence failure boundaries', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const [options, status, dispatched] of [
      [{ auth: true }, 401, false],
      [{ deny: true }, 403, false],
      [{ explicitDeny: true }, 403, false],
      [{ limit: true }, 429, false],
      [{ audit: true }, 503, false],
      [{ usageFail: true }, 503, true],
      [{ outcomeFail: true }, 503, true],
      [{ fail: true }, 502, true],
    ] as const) {
      const f = httpFixture('google', options);
      const response = await f.handler(request(path, googlePropertyFormat()));
      assert.equal(response.status, status);
      assert.equal(f.sent.length, dispatched ? 1 : 0);
      assert.equal(f.secrets(), dispatched ? 1 : 0);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
    }
});
test('Gemini property-schema schemas work through actual OpenAI SDK sockets on both bases', async () => {
  const f = httpFixture('google');
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
        input(googlePropertyFormat()) as OpenAI.ChatCompletionCreateParamsNonStreaming,
      );
      assert.equal(result.choices[0]?.message.content, '{"ok":true}');
      const config = f.sent.at(-1)?.generationConfig as Record<string, unknown>;
      assert.deepEqual(config.responseJsonSchema, googlePropertyFormat().json_schema.schema);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('Gemini property-schema schemas use the same captured native text-stream transport', async () => {
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  const sent: Record<string, unknown>[] = [];
  const format = googlePropertyFormat();
  const expected = structuredClone(format.json_schema.schema);
  const invoke = createDirectGoogleTextStreamInvoker({
    registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' }],
    resolveSecret: async () => {
      format.json_schema.schema.properties.label.additionalProperties.minItems = 999;
      return 'fixture-key';
    },
    fetcher: async (_, init) => {
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        'data: ' +
          JSON.stringify({
            responseId: 'response',
            modelVersion: 'model',
            candidates: [
              {
                index: 0,
                content: { role: 'model', parts: [{ text: '{"ok":true}' }] },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
          }) +
          '\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  const seen: unknown[] = [];
  const result = await invoke(
    { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'model' },
    { ...input(format), stream: true } as unknown as ChatRequest,
    (delta) => {
      seen.push(delta);
    },
  );
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.usage?.total_tokens, 3);
  assert.ok(JSON.stringify(seen).includes('ok'));
  assert.deepEqual(
    (sent[0]?.generationConfig as Record<string, unknown> | undefined)?.responseJsonSchema,
    expected,
  );
});

test('Gemini property schemas retain boolean and nested object behavior', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const value of [
      true,
      false,
      { type: 'string' },
      { type: 'object', additionalProperties: { type: 'integer', minimum: 0, enum: [0, 1] } },
      {
        type: 'object',
        properties: { inner: { type: 'object', additionalProperties: { type: 'null' } } },
      },
    ]) {
      const format = {
        type: 'json_schema',
        json_schema: {
          name: 'result',
          strict: false,
          schema: { type: 'object', additionalProperties: value },
        },
      };
      const f = httpFixture('google');
      assert.equal((await f.handler(request(path, format))).status, 200);
      assert.deepEqual(
        (f.sent[0]?.generationConfig as Record<string, unknown>)?.responseJsonSchema,
        format.json_schema.schema,
      );
      assert.equal(f.usage.length, 1);
    }
});
test('Gemini malformed property schemas reject before secrets including nested depth', async () => {
  let deep: Record<string, unknown> = { type: 'string' };
  for (let depth = 0; depth < 18; depth++) deep = { type: 'object', additionalProperties: deep };
  const nodes = [
    ...[
      null,
      0,
      'true',
      [],
      {},
      { description: 'private property-schema' },
      { type: 'string', pattern: 'private' },
      { type: 'array' },
      { type: 'number', minimum: 2, maximum: 1 },
      { type: 'object', required: ['missing'] },
      { type: 'object', additionalProperties: { type: 'integer', enum: [0.5] } },
      deep,
    ].map((value) => ({ type: 'object', additionalProperties: value })),
    ...['array', 'string', 'number', 'integer', 'boolean', 'null'].map((type) => ({
      type,
      additionalProperties: { type: 'string' },
    })),
  ];
  for (const node of nodes) {
    const format = {
      type: 'json_schema',
      json_schema: {
        name: 'result',
        strict: false,
        schema: { type: 'object', properties: { value: node } },
      },
    };
    const f = adapter('google');
    await assert.rejects(() => f.call(input(format) as unknown as ChatRequest));
    assert.equal(f.secrets(), 0);
    assert.equal(f.sent.length, 0);
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      const h = httpFixture('google');
      const response = await h.handler(request(path, format));
      assert.equal(response.status, 502);
      assert.equal(h.secrets(), 0);
      assert.equal(h.sent.length, 0);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
    }
  }
});

test('Gemini property schemas share the existing recursive depth boundary', async () => {
  const { validateGoogleResponseSchema } = await import(
    '../src/providers/google-response-schema.ts'
  );
  for (const depth of [16, 17]) {
    let schema: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < depth; i++) schema = { type: 'object', additionalProperties: schema };
    const format = {
      type: 'json_schema',
      json_schema: { name: 'result', strict: false, schema },
    } as const;
    if (depth === 16) assert.doesNotThrow(() => validateGoogleResponseSchema(format));
    else assert.throws(() => validateGoogleResponseSchema(format));
  }
});

function googleAnyOfFormat() {
  const format = googleSchemaFormat();
  return {
    ...format,
    json_schema: {
      ...format.json_schema,
      schema: {
        type: 'object',
        properties: {
          label: {
            anyOf: [
              { type: 'string', enum: ['a', 'b'] },
              { type: 'null' },
              {
                type: 'object',
                additionalProperties: { anyOf: [{ type: 'integer' }, { type: 'boolean' }] },
              },
            ],
            description: 'private anyOf-schema literal',
          },
          score: { type: 'integer', minimum: -1.5, maximum: 2.5 },
          values: { type: 'array', items: { type: 'number', minimum: 0, maximum: 0, enum: [0] } },
        },
        required: ['label'],
        additionalProperties: false,
      },
    },
  };
}
test('Gemini anyOf schemas forward exact immutable schemas on both bases', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const format = googleAnyOfFormat();
    const expected = structuredClone(format.json_schema.schema);
    const f = httpFixture('google', {
      mutate: () => {
        format.json_schema.schema.properties.label.anyOf[0] = { type: 'null' };
      },
    });
    const req = request(path, format);
    Object.defineProperty(req, 'json', { value: async () => input(format) });
    assert.equal((await f.handler(req)).status, 200);
    assert.deepEqual(
      (f.sent[0]?.generationConfig as Record<string, unknown> | undefined)?.responseJsonSchema,
      expected,
    );
    assert.equal(f.secrets(), 1);
    assert.equal(f.usage.length, 1);
    assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private anyOf-schema|fixture-key/u);
  }
});
test('Gemini anyOf-schema schemas retain IAM limits and persistence failure boundaries', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions'])
    for (const [options, status, dispatched] of [
      [{ auth: true }, 401, false],
      [{ deny: true }, 403, false],
      [{ explicitDeny: true }, 403, false],
      [{ limit: true }, 429, false],
      [{ audit: true }, 503, false],
      [{ usageFail: true }, 503, true],
      [{ outcomeFail: true }, 503, true],
      [{ fail: true }, 502, true],
    ] as const) {
      const f = httpFixture('google', options);
      const response = await f.handler(request(path, googleAnyOfFormat()));
      assert.equal(response.status, status);
      assert.equal(f.sent.length, dispatched ? 1 : 0);
      assert.equal(f.secrets(), dispatched ? 1 : 0);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
    }
});
test('Gemini anyOf-schema schemas work through actual OpenAI SDK sockets on both bases', async () => {
  const f = httpFixture('google');
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
        input(googleAnyOfFormat()) as OpenAI.ChatCompletionCreateParamsNonStreaming,
      );
      assert.equal(result.choices[0]?.message.content, '{"ok":true}');
      const config = f.sent.at(-1)?.generationConfig as Record<string, unknown>;
      assert.deepEqual(config.responseJsonSchema, googleAnyOfFormat().json_schema.schema);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('Gemini anyOf-schema schemas use the same captured native text-stream transport', async () => {
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  const sent: Record<string, unknown>[] = [];
  const format = googleAnyOfFormat();
  const expected = structuredClone(format.json_schema.schema);
  const invoke = createDirectGoogleTextStreamInvoker({
    registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' }],
    resolveSecret: async () => {
      format.json_schema.schema.properties.label.anyOf[0] = { type: 'null' };
      return 'fixture-key';
    },
    fetcher: async (_, init) => {
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        'data: ' +
          JSON.stringify({
            responseId: 'response',
            modelVersion: 'model',
            candidates: [
              {
                index: 0,
                content: { role: 'model', parts: [{ text: '{"ok":true}' }] },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
          }) +
          '\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  const seen: unknown[] = [];
  const result = await invoke(
    { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'model' },
    { ...input(format), stream: true } as unknown as ChatRequest,
    (delta) => {
      seen.push(delta);
    },
  );
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.usage?.total_tokens, 3);
  assert.ok(JSON.stringify(seen).includes('ok'));
  assert.deepEqual(
    (sent[0]?.generationConfig as Record<string, unknown> | undefined)?.responseJsonSchema,
    expected,
  );
});

test('Gemini anyOf rejects malformed branches before credentials', async () => {
  const nodes: unknown[] = [
    ...[
      null,
      false,
      {},
      [],
      'private',
      [],
      Array.from({ length: 17 }, () => ({ type: 'string' })),
      [{}],
      [{ type: 'string', pattern: 'private' }],
      [{ type: 'array' }],
      [{ type: 'integer', enum: [0.5] }],
    ].map((anyOf) => ({ anyOf })),
    { anyOf: [{ type: 'null' }], properties: {} },
    { anyOf: [{ type: 'string' }], oneOf: [{ type: 'string' }] },
    { anyOf: [{ type: 'string' }], title: 1 },
  ];
  for (const node of nodes) {
    const format = {
      type: 'json_schema',
      json_schema: {
        name: 'result',
        strict: false,
        schema: { type: 'object', properties: { label: node } },
      },
    };
    const f = adapter('google');
    await assert.rejects(() => f.call(input(format) as unknown as ChatRequest));
    assert.equal(f.secrets(), 0);
    assert.equal(f.sent.length, 0);
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      const h = httpFixture('google');
      const response = await h.handler(request(path, format));
      assert.equal(response.status, 502);
      assert.equal(h.secrets(), 0);
      assert.equal(h.sent.length, 0);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
    }
  }
});

test('Gemini anyOf shares recursive depth and retains explicit object-root restriction', async () => {
  const { validateGoogleResponseSchema: validate } = await import(
    '../src/providers/google-response-schema.ts'
  );
  const format = (schema: Record<string, unknown>) =>
    ({ type: 'json_schema', json_schema: { name: 'result', strict: false, schema } }) as const;
  for (const depth of [16, 17]) {
    let node: Record<string, unknown> = { type: 'string' };
    for (let i = 1; i < depth; i++) node = { anyOf: [node] };
    const schema = { type: 'object', properties: { label: node } };
    if (depth === 16) assert.doesNotThrow(() => validate(format(schema)));
    else assert.throws(() => validate(format(schema)));
  }
  assert.throws(() => validate(format({ anyOf: [{ type: 'object' }] })));
  assert.doesNotThrow(() => validate(format({ type: 'object', anyOf: [{ type: 'object' }] })));
  assert.doesNotThrow(() =>
    validate(
      format({
        type: 'object',
        properties: { label: { anyOf: Array.from({ length: 16 }, () => ({ type: 'string' })) } },
      }),
    ),
  );
});
