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
function body(kind: Kind, output = '{"ok":true}') {
  if (kind === 'anthropic')
    return {
      id: 'completion',
      content: [{ type: 'text', text: output }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 2, output_tokens: 1 },
    };
  if (kind === 'google')
    return {
      responseId: 'completion',
      candidates: [{ content: { parts: [{ text: output }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 },
    };
  return {
    id: 'completion',
    created: 1,
    model: 'model',
    system_fingerprint: 'fp_fixture',
    choices: [{ index: 0, message: { role: 'assistant', content: output }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 2, completion_tokens: 1 },
  };
}
function adapter(
  kind: Kind,
  cap?: number,
  mutate?: () => void,
  transportFails = false,
  output?: string,
) {
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
      : Response.json(body(kind, output));
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
    output?: string;
  } = {},
) {
  const f = adapter(kind, undefined, options.mutate, options.fail, options.output);
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
      { type: 'array', items: { type: 'string', pattern: 'unsupported' } },
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

test('Gemini anyOf shares recursive depth and accepts bounded untyped roots', async () => {
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
  assert.doesNotThrow(() => validate(format({ anyOf: [{ type: 'object' }] })));
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

function googlePrefixItemsFormat() {
  const base = googleSchemaFormat();
  return {
    ...base,
    json_schema: {
      ...base.json_schema,
      schema: {
        type: 'object',
        properties: {
          values: {
            type: 'array',
            prefixItems: [
              { type: 'string', enum: ['a', 'b'] },
              { anyOf: [{ type: 'null' }, { type: 'number', minimum: 0 }] },
              { type: 'array', prefixItems: [{ type: 'boolean' }] },
            ],
            items: { type: 'integer' },
            minItems: 1,
            maxItems: 8,
            description: 'private prefixItems-schema literal',
          },
        },
        required: ['values'],
        additionalProperties: false,
      },
    },
  };
}
test('Gemini prefixItems schemas forward exact immutable schemas on both bases', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const format = googlePrefixItemsFormat();
    const expected = structuredClone(format.json_schema.schema);
    const f = httpFixture('google', {
      mutate: () => {
        format.json_schema.schema.properties.values.prefixItems[0] = {
          type: 'string',
          enum: ['mutated'],
        };
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
      /private prefixItems-schema|fixture-key/u,
    );
  }
});
test('Gemini prefixItems-schema schemas retain IAM limits and persistence failure boundaries', async () => {
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
      const response = await f.handler(request(path, googlePrefixItemsFormat()));
      assert.equal(response.status, status);
      assert.equal(f.sent.length, dispatched ? 1 : 0);
      assert.equal(f.secrets(), dispatched ? 1 : 0);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
    }
});
test('Gemini prefixItems-schema schemas work through actual OpenAI SDK sockets on both bases', async () => {
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
        input(googlePrefixItemsFormat()) as OpenAI.ChatCompletionCreateParamsNonStreaming,
      );
      assert.equal(result.choices[0]?.message.content, '{"ok":true}');
      const config = f.sent.at(-1)?.generationConfig as Record<string, unknown>;
      assert.deepEqual(config.responseJsonSchema, googlePrefixItemsFormat().json_schema.schema);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('Gemini prefixItems-schema schemas use the same captured native text-stream transport', async () => {
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  const sent: Record<string, unknown>[] = [];
  const format = googlePrefixItemsFormat();
  const expected = structuredClone(format.json_schema.schema);
  const invoke = createDirectGoogleTextStreamInvoker({
    registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' }],
    resolveSecret: async () => {
      format.json_schema.schema.properties.values.prefixItems[0] = {
        type: 'string',
        enum: ['mutated'],
      };
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

test('Gemini prefixItems rejects malformed lists and children before secrets', async () => {
  const nodes: unknown[] = [
    ...[
      null,
      false,
      {},
      'private',
      [],
      Array.from({ length: 17 }, () => ({ type: 'string' })),
      [{}],
      [false],
      [{ type: 'string', pattern: 'private' }],
      [{ type: 'array' }],
      [{ type: 'integer', enum: [0.5] }],
    ].map((prefixItems) => ({ type: 'array', prefixItems })),
    { type: 'string', prefixItems: [{ type: 'string' }] },
    { prefixItems: [{ type: 'string' }] },
    { type: 'array', prefixItems: [{ type: 'string' }], items: false },
    { type: 'array', prefixItems: [{ type: 'string' }], minItems: 2, maxItems: 1 },
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
test('Gemini prefixItems shares recursive depth, supports bounded prefix-only arrays and retains root restrictions', async () => {
  const { validateGoogleResponseSchema: validate } = await import(
    '../src/providers/google-response-schema.ts'
  );
  const format = (schema: Record<string, unknown>) =>
    ({ type: 'json_schema', json_schema: { name: 'result', strict: false, schema } }) as const;
  for (const depth of [16, 17]) {
    let node: Record<string, unknown> = { type: 'string' };
    for (let i = 1; i < depth; i++) node = { type: 'array', prefixItems: [node] };
    const schema = { type: 'object', properties: { label: node } };
    if (depth === 16) assert.doesNotThrow(() => validate(format(schema)));
    else assert.throws(() => validate(format(schema)));
  }
  assert.doesNotThrow(() => validate(format({ type: 'array', prefixItems: [{ type: 'string' }] })));
  assert.throws(() => validate(format({ type: 'object', prefixItems: [{ type: 'string' }] })));
  assert.throws(() =>
    validate(format({ type: 'object', properties: { label: { type: 'array' } } })),
  );
  assert.doesNotThrow(() =>
    validate(
      format({
        type: 'object',
        properties: {
          label: {
            type: 'array',
            prefixItems: Array.from({ length: 16 }, () => ({ type: 'string' })),
          },
        },
      }),
    ),
  );
});

function googleStringFormat() {
  const base = googleSchemaFormat();
  return {
    ...base,
    json_schema: {
      ...base.json_schema,
      schema: {
        type: 'object',
        properties: {
          values: {
            type: 'array',
            prefixItems: [
              { type: 'string', format: 'date-time' },
              { anyOf: [{ type: 'null' }, { type: 'string', format: 'private unknown format' }] },
              { type: 'object', additionalProperties: { type: 'string', format: '' } },
            ],
            items: { type: 'string', format: 'x'.repeat(256) },
          },
        },
        additionalProperties: { type: 'string', format: ' opaque custom ' },
      },
    },
  };
}
test('Gemini string-format schemas forward exact immutable schemas on both bases', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const format = googleStringFormat();
    const expected = structuredClone(format.json_schema.schema);
    const f = httpFixture('google', {
      mutate: () => {
        format.json_schema.schema.properties.values.prefixItems[0] = {
          type: 'string',
          format: 'mutated',
        };
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
    assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private string-format|fixture-key/u);
  }
});
test('Gemini string-format schemas retain IAM limits and persistence failure boundaries', async () => {
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
      const response = await f.handler(request(path, googleStringFormat()));
      assert.equal(response.status, status);
      assert.equal(f.sent.length, dispatched ? 1 : 0);
      assert.equal(f.secrets(), dispatched ? 1 : 0);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
    }
});
test('Gemini string-format schemas work through actual OpenAI SDK sockets on both bases', async () => {
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
        input(googleStringFormat()) as OpenAI.ChatCompletionCreateParamsNonStreaming,
      );
      assert.equal(result.choices[0]?.message.content, '{"ok":true}');
      const config = f.sent.at(-1)?.generationConfig as Record<string, unknown>;
      assert.deepEqual(config.responseJsonSchema, googleStringFormat().json_schema.schema);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('Gemini string-format schemas use the same captured native text-stream transport', async () => {
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  const sent: Record<string, unknown>[] = [];
  const format = googleStringFormat();
  const expected = structuredClone(format.json_schema.schema);
  const invoke = createDirectGoogleTextStreamInvoker({
    registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' }],
    resolveSecret: async () => {
      format.json_schema.schema.properties.values.prefixItems[0] = {
        type: 'string',
        format: 'mutated',
      };
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

test('Gemini string-format rejects malformed annotations before secrets', async () => {
  const nodes: unknown[] = [
    ...[null, false, 1, {}, [], 'x'.repeat(257)].map((format) => ({ type: 'string', format })),
    ...['number', 'integer', 'boolean', 'null', 'object', 'array'].map((type) => ({
      type,
      format: 'private',
    })),
    { anyOf: [{ type: 'string' }], format: 'private' },
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
test('Gemini string-format retains shared depth and explicit root restrictions', async () => {
  const { validateGoogleResponseSchema: validate } = await import(
    '../src/providers/google-response-schema.ts'
  );
  const wrap = (schema: Record<string, unknown>) =>
    ({ type: 'json_schema', json_schema: { name: 'result', strict: false, schema } }) as const;
  for (const depth of [16, 17]) {
    let node: Record<string, unknown> = { type: 'string', format: '' };
    for (let i = 1; i < depth; i++) node = { anyOf: [node] };
    const schema = { type: 'object', properties: { label: node } };
    if (depth === 16) assert.doesNotThrow(() => validate(wrap(schema)));
    else assert.throws(() => validate(wrap(schema)));
  }
  for (const format of ['', ' custom ', '😀'.repeat(128)])
    assert.doesNotThrow(() =>
      validate(wrap({ type: 'object', properties: { x: { type: 'string', format } } })),
    );
  for (const format of [undefined, '😀'.repeat(129)])
    assert.throws(() =>
      validate(wrap({ type: 'object', properties: { x: { type: 'string', format } } })),
    );
  assert.doesNotThrow(() => validate(wrap({ type: 'string', format: 'date' })));
  assert.throws(() => validate(wrap({ type: 'object', format: 'private' })));
  assert.throws(() =>
    validate({
      ...wrap(googleStringFormat().json_schema.schema),
      json_schema: { ...googleStringFormat().json_schema, strict: true },
    }),
  );
});

function googlePropertyOrdering() {
  const base = googleSchemaFormat();
  return {
    ...base,
    json_schema: {
      ...base.json_schema,
      schema: {
        type: 'object',
        propertyOrdering: ['values', 'private order'],
        properties: {
          'private order': { type: 'string' },
          values: {
            type: 'array',
            prefixItems: [
              {
                type: 'object',
                properties: { b: { type: 'string' }, a: { type: 'integer' } },
                propertyOrdering: ['a', 'b'],
              },
            ],
            items: { anyOf: [{ type: 'object', propertyOrdering: [] }, { type: 'null' }] },
          },
        },
        additionalProperties: {
          type: 'object',
          properties: { x: { type: 'boolean' }, y: { type: 'null' } },
          propertyOrdering: ['y'],
        },
      },
    },
  };
}
test('Gemini property-ordering schemas forward exact immutable schemas on both bases', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const format = googlePropertyOrdering();
    const expected = structuredClone(format.json_schema.schema);
    const f = httpFixture('google', {
      mutate: () => {
        format.json_schema.schema.propertyOrdering.reverse();
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
      /private property-ordering|fixture-key/u,
    );
  }
});
test('Gemini property-ordering schemas retain IAM limits and persistence failure boundaries', async () => {
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
      const response = await f.handler(request(path, googlePropertyOrdering()));
      assert.equal(response.status, status);
      assert.equal(f.sent.length, dispatched ? 1 : 0);
      assert.equal(f.secrets(), dispatched ? 1 : 0);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
    }
});
test('Gemini property-ordering schemas work through actual OpenAI SDK sockets on both bases', async () => {
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
        input(googlePropertyOrdering()) as OpenAI.ChatCompletionCreateParamsNonStreaming,
      );
      assert.equal(result.choices[0]?.message.content, '{"ok":true}');
      const config = f.sent.at(-1)?.generationConfig as Record<string, unknown>;
      assert.deepEqual(config.responseJsonSchema, googlePropertyOrdering().json_schema.schema);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('Gemini property-ordering schemas use the same captured native text-stream transport', async () => {
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  const sent: Record<string, unknown>[] = [];
  const format = googlePropertyOrdering();
  const expected = structuredClone(format.json_schema.schema);
  const invoke = createDirectGoogleTextStreamInvoker({
    registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' }],
    resolveSecret: async () => {
      format.json_schema.schema.propertyOrdering.reverse();
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

test('Gemini property-ordering rejects malformed lists before secrets', async () => {
  const nodes: unknown[] = [
    ...[
      null,
      false,
      1,
      {},
      'private',
      ['private'],
      ['x', 'x'],
      [1],
      ['toString'],
      Array.from({ length: 129 }, (_, i) => `p${i}`),
    ].map((propertyOrdering) => ({
      type: 'object',
      properties: { x: { type: 'string' } },
      propertyOrdering,
    })),
    ...['string', 'number', 'integer', 'boolean', 'null', 'array'].map((type) => ({
      type,
      ...(type === 'array' ? { items: { type: 'string' } } : {}),
      propertyOrdering: [],
    })),
    { anyOf: [{ type: 'object' }], propertyOrdering: [] },
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
    const { createDirectGoogleTextStreamInvoker } = await import(
      '../src/providers/direct-google-stream.ts'
    );
    let streamSecrets = 0;
    let streamCalls = 0;
    const stream = createDirectGoogleTextStreamInvoker({
      registrations: [
        { providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' },
      ],
      resolveSecret: async () => {
        streamSecrets++;
        return 'fixture-key';
      },
      fetcher: async () => {
        streamCalls++;
        throw new Error('must not dispatch');
      },
    });
    await assert.rejects(() =>
      stream(
        { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'model' },
        { ...input(format), stream: true } as unknown as ChatRequest,
        () => {},
      ),
    );
    assert.equal(streamSecrets, 0);
    assert.equal(streamCalls, 0);
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
test('Gemini property-ordering retains depth count own-key root and strict boundaries', async () => {
  const { validateGoogleResponseSchema: validate } = await import(
    '../src/providers/google-response-schema.ts'
  );
  const wrap = (schema: Record<string, unknown>) =>
    ({ type: 'json_schema', json_schema: { name: 'result', strict: false, schema } }) as const;
  for (const count of [0, 1, 128, 129]) {
    const names = Array.from({ length: count }, (_, i) => `p${i}`);
    const schema = {
      type: 'object',
      properties: Object.fromEntries(names.map((key) => [key, { type: 'string' }])),
      propertyOrdering: names,
    };
    if (count <= 128) assert.doesNotThrow(() => validate(wrap(schema)));
    else assert.throws(() => validate(wrap(schema)));
  }
  assert.doesNotThrow(() =>
    validate(
      wrap({
        type: 'object',
        properties: JSON.parse('{"__proto__":{"type":"string"},"":{"type":"string"}}'),
        propertyOrdering: ['', '__proto__'],
      }),
    ),
  );
  for (const propertyOrdering of [undefined, ['toString']])
    assert.throws(() => validate(wrap({ type: 'object', propertyOrdering })));
  for (const depth of [16, 17]) {
    let node: Record<string, unknown> = { type: 'object', propertyOrdering: [] };
    for (let i = 1; i < depth; i++) node = { anyOf: [node] };
    const schema = { type: 'object', properties: { x: node } };
    if (depth === 16) assert.doesNotThrow(() => validate(wrap(schema)));
    else assert.throws(() => validate(wrap(schema)));
  }
  assert.doesNotThrow(() =>
    validate(wrap({ type: 'array', items: { type: 'object', propertyOrdering: [] } })),
  );
  assert.throws(() =>
    validate({
      ...wrap(googlePropertyOrdering().json_schema.schema),
      json_schema: { ...googlePropertyOrdering().json_schema, strict: true },
    }),
  );
});

function googleNullableTypes() {
  const base = googleSchemaFormat();
  return {
    ...base,
    json_schema: {
      ...base.json_schema,
      schema: {
        type: 'object',
        properties: {
          values: {
            type: ['array', 'null'],
            minItems: 0,
            maxItems: 3,
            prefixItems: [{ type: ['null', 'string'], format: 'private nullable format' }],
            items: { type: ['integer', 'null'], minimum: -2, maximum: 4, enum: [-2, 4] },
          },
          optional: {
            type: ['object', 'null'],
            properties: { x: { type: ['boolean', 'null'] } },
            propertyOrdering: ['x'],
            required: ['x'],
            additionalProperties: { anyOf: [{ type: ['number', 'null'] }, { type: 'null' }] },
          },
        },
        additionalProperties: { type: ['null', 'string'] },
      },
    },
  };
}
test('Gemini nullable-type schemas forward exact immutable schemas on both bases', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const format = googleNullableTypes();
    const expected = structuredClone(format.json_schema.schema);
    const f = httpFixture('google', {
      mutate: () => {
        format.json_schema.schema.properties.values.type.reverse();
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
    assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private nullable|fixture-key/u);
  }
});
test('Gemini nullable-type schemas retain IAM limits and persistence failure boundaries', async () => {
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
      const response = await f.handler(request(path, googleNullableTypes()));
      assert.equal(response.status, status);
      assert.equal(f.sent.length, dispatched ? 1 : 0);
      assert.equal(f.secrets(), dispatched ? 1 : 0);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
    }
});
test('Gemini nullable-type schemas work through actual OpenAI SDK sockets on both bases', async () => {
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
        input(googleNullableTypes()) as OpenAI.ChatCompletionCreateParamsNonStreaming,
      );
      assert.equal(result.choices[0]?.message.content, '{"ok":true}');
      const config = f.sent.at(-1)?.generationConfig as Record<string, unknown>;
      assert.deepEqual(config.responseJsonSchema, googleNullableTypes().json_schema.schema);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('Gemini nullable-type schemas use the same captured native text-stream transport', async () => {
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  const sent: Record<string, unknown>[] = [];
  const format = googleNullableTypes();
  const expected = structuredClone(format.json_schema.schema);
  const invoke = createDirectGoogleTextStreamInvoker({
    registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' }],
    resolveSecret: async () => {
      format.json_schema.schema.properties.values.type.reverse();
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

test('Gemini nullable-type rejects malformed and wrong-keyword nodes before secrets', async () => {
  const nodes: unknown[] = [
    ...[
      [],
      ['null'],
      ['string'],
      ['null', 'null'],
      ['string', 'string'],
      ['number', 'string'],
      ['null', 'string', 'number'],
      ['null', 'unknown'],
      ['null', null],
      ['null', 1],
      ['null', {}],
      ['null', []],
      ['null', undefined],
    ].map((type) => ({ type })),
    { type: ['string', 'null'], minimum: 0 },
    { type: ['number', 'null'], minimum: 2, maximum: 1 },
    { type: ['number', 'null'], format: 'private' },
    { type: ['string', 'null'], minItems: 1 },
    { type: ['array', 'null'], items: { type: 'string' }, minItems: 2, maxItems: 1 },
    { type: ['array', 'null'] },
    { type: ['object', 'null'], items: { type: 'string' } },
    { type: ['string', 'null'], properties: {} },
    { type: ['integer', 'null'], enum: [1.5] },
    { type: ['string', 'null'], enum: [null] },
    { type: ['boolean', 'null'], enum: [true] },
    { type: ['string', 'null'], propertyOrdering: [] },
    { type: ['object', 'null'], propertyOrdering: ['unknown'] },
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
    const { createDirectGoogleTextStreamInvoker } = await import(
      '../src/providers/direct-google-stream.ts'
    );
    let streamSecrets = 0;
    let streamCalls = 0;
    const stream = createDirectGoogleTextStreamInvoker({
      registrations: [
        { providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' },
      ],
      resolveSecret: async () => {
        streamSecrets++;
        return 'fixture-key';
      },
      fetcher: async () => {
        streamCalls++;
        throw new Error('must not dispatch');
      },
    });
    await assert.rejects(() =>
      stream(
        { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'model' },
        { ...input(format), stream: true } as unknown as ChatRequest,
        () => {},
      ),
    );
    assert.equal(streamSecrets, 0);
    assert.equal(streamCalls, 0);
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

test('Gemini nullable-type retains pair order depth root strict and recursive keyword boundaries', async () => {
  const { validateGoogleResponseSchema: validate } = await import(
    '../src/providers/google-response-schema.ts'
  );
  const wrap = (schema: Record<string, unknown>) =>
    ({ type: 'json_schema', json_schema: { name: 'result', strict: false, schema } }) as const;
  for (const type of ['object', 'array', 'string', 'number', 'integer', 'boolean'])
    for (const types of [
      [type, 'null'],
      ['null', type],
    ]) {
      const node = { type: types, ...(type === 'array' ? { items: { type: 'string' } } : {}) };
      const schema = { type: 'object', properties: { x: node } };
      const expected = structuredClone(schema);
      assert.doesNotThrow(() => validate(wrap(schema)));
      assert.deepEqual(schema, expected);
    }
  for (const depth of [16, 17]) {
    let node: Record<string, unknown> = { type: ['string', 'null'] };
    for (let i = 1; i < depth; i++) node = { type: ['array', 'null'], items: node };
    const schema = { type: 'object', properties: { x: node } };
    if (depth === 16) assert.doesNotThrow(() => validate(wrap(schema)));
    else assert.throws(() => validate(wrap(schema)));
  }
  for (const type of [['object']]) assert.throws(() => validate(wrap({ type })));
  const format = googleNullableTypes();
  assert.throws(() =>
    validate({ ...format, json_schema: { ...format.json_schema, strict: true } }),
  );
  assert.throws(() =>
    validate(
      wrap({
        type: 'object',
        properties: {
          x: { type: ['array', 'null'], prefixItems: [{ type: ['string', 'number'] }] },
        },
      }),
    ),
  );
});

function googleOneOfFormat() {
  const format = googleSchemaFormat();
  return {
    ...format,
    json_schema: {
      ...format.json_schema,
      schema: {
        type: 'object',
        properties: {
          label: {
            oneOf: [
              { type: 'string', enum: ['a', 'b'] },
              { type: 'null' },
              {
                type: 'object',
                additionalProperties: { oneOf: [{ type: 'integer' }, { type: 'boolean' }] },
              },
            ],
            description: 'private oneOf-schema literal',
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
test('Gemini oneOf schemas forward exact immutable schemas on both bases', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const format = googleOneOfFormat();
    const expected = structuredClone(format.json_schema.schema);
    const f = httpFixture('google', {
      mutate: () => {
        format.json_schema.schema.properties.label.oneOf[0] = { type: 'null' };
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
    assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /private oneOf-schema|fixture-key/u);
  }
});
test('Gemini oneOf-schema schemas retain IAM limits and persistence failure boundaries', async () => {
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
      const response = await f.handler(request(path, googleOneOfFormat()));
      assert.equal(response.status, status);
      assert.equal(f.sent.length, dispatched ? 1 : 0);
      assert.equal(f.secrets(), dispatched ? 1 : 0);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
    }
});
test('Gemini oneOf-schema schemas work through actual OpenAI SDK sockets on both bases', async () => {
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
        input(googleOneOfFormat()) as OpenAI.ChatCompletionCreateParamsNonStreaming,
      );
      assert.equal(result.choices[0]?.message.content, '{"ok":true}');
      const config = f.sent.at(-1)?.generationConfig as Record<string, unknown>;
      assert.deepEqual(config.responseJsonSchema, googleOneOfFormat().json_schema.schema);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('Gemini oneOf-schema schemas use the same captured native text-stream transport', async () => {
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  const sent: Record<string, unknown>[] = [];
  const format = googleOneOfFormat();
  const expected = structuredClone(format.json_schema.schema);
  const invoke = createDirectGoogleTextStreamInvoker({
    registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' }],
    resolveSecret: async () => {
      format.json_schema.schema.properties.label.oneOf[0] = { type: 'null' };
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

test('Gemini oneOf rejects malformed branches before credentials', async () => {
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
    ].map((oneOf) => ({ oneOf })),
    { oneOf: [{ type: 'null' }], properties: {} },
    { oneOf: [{ type: 'string' }], allOf: [{ type: 'string' }] },
    { oneOf: [{ type: 'string' }], title: 1 },
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

test('Gemini oneOf shares recursive depth and accepts bounded untyped roots', async () => {
  const { validateGoogleResponseSchema: validate } = await import(
    '../src/providers/google-response-schema.ts'
  );
  const format = (schema: Record<string, unknown>) =>
    ({ type: 'json_schema', json_schema: { name: 'result', strict: false, schema } }) as const;
  for (const depth of [16, 17]) {
    let node: Record<string, unknown> = { type: 'string' };
    for (let i = 1; i < depth; i++) node = { oneOf: [node] };
    const schema = { type: 'object', properties: { label: node } };
    if (depth === 16) assert.doesNotThrow(() => validate(format(schema)));
    else assert.throws(() => validate(format(schema)));
  }
  assert.doesNotThrow(() => validate(format({ oneOf: [{ type: 'object' }] })));
  assert.doesNotThrow(() => validate(format({ type: 'object', oneOf: [{ type: 'object' }] })));
  assert.doesNotThrow(() =>
    validate(
      format({
        type: 'object',
        properties: { label: { oneOf: Array.from({ length: 16 }, () => ({ type: 'string' })) } },
      }),
    ),
  );
});

test('Gemini oneOf retains strict dual-union and native-stream pre-secret rejection', async () => {
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  let secrets = 0;
  let dispatches = 0;
  const invoke = createDirectGoogleTextStreamInvoker({
    registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' }],
    resolveSecret: async () => {
      secrets++;
      return 'fixture-key';
    },
    fetcher: async () => {
      dispatches++;
      throw new Error('must not dispatch');
    },
  });
  const formats: unknown[] = [
    ...[true, null, undefined].map((strict) => ({
      ...googleOneOfFormat(),
      json_schema: { ...googleOneOfFormat().json_schema, strict },
    })),
    ...[
      { oneOf: [] },
      { oneOf: [{ type: 'string', pattern: 'private' }] },
      { type: 'string', oneOf: [{ type: 'string' }], anyOf: [{ type: 'string' }] },
      { oneOf: [{ type: 'string' }], anyOf: [{ type: 'string' }] },
      { oneOf: [{ type: 'string' }], items: { type: 'string' } },
      { type: 'object', oneOf: [{ type: 'string' }], anyOf: [{ type: 'string' }] },
    ].map((node) => ({
      type: 'json_schema',
      json_schema: {
        name: 'result',
        strict: false,
        schema: { type: 'object', properties: { label: node } },
      },
    })),
  ];
  for (const format of formats) {
    await assert.rejects(() =>
      invoke(
        { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'model' },
        { ...input(format), stream: true } as unknown as ChatRequest,
        () => {
          throw new Error('must not emit');
        },
      ),
    );
  }
  assert.equal(secrets, 0);
  assert.equal(dispatches, 0);
});

test('Gemini oneOf and anyOf nest without rewriting overlapping branches', async () => {
  const format = {
    type: 'json_schema',
    json_schema: {
      name: 'result',
      strict: false,
      schema: {
        type: 'object',
        properties: {
          label: {
            oneOf: [
              { type: 'number' },
              { anyOf: [{ type: 'integer' }, { type: ['string', 'null'] }] },
            ],
          },
        },
      },
    },
  };
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const f = httpFixture('google');
    assert.equal((await f.handler(request(path, format))).status, 200);
    assert.deepEqual(
      (f.sent[0]?.generationConfig as Record<string, unknown> | undefined)?.responseJsonSchema,
      format.json_schema.schema,
    );
    assert.equal(f.usage.length, 1);
    assert.doesNotMatch(JSON.stringify([f.audits, f.usage]), /oneOf|anyOf|fixture-key/u);
  }
});

function googleLocalRefFormat() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'result',
      strict: false,
      schema: {
        type: 'object',
        $defs: {
          Label: {
            type: 'string',
            enum: ['a', 'b'],
            description: 'private local-ref-schema literal',
          },
          Box: { type: 'object', properties: { inner: { $ref: '#/$defs/Label' } } },
        },
        properties: {
          label: { $ref: '#/$defs/Label' },
          box: { $ref: '#/$defs/Box' },
          list: { type: 'array', items: { $ref: '#/$defs/Label' } },
          map: { type: 'object', additionalProperties: { $ref: '#/$defs/Label' } },
          union: { anyOf: [{ $ref: '#/$defs/Label' }, { type: 'null' }] },
        },
        required: ['label'],
        additionalProperties: false,
      },
    },
  };
}
test('Gemini local-ref schemas forward exact immutable schemas on both bases', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const format = googleLocalRefFormat();
    const expected = structuredClone(format.json_schema.schema);
    const f = httpFixture('google', {
      mutate: () => {
        format.json_schema.schema.$defs.Label.enum[0] = 'mutated';
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
      /private local-ref-schema|fixture-key/u,
    );
  }
});
test('Gemini local-ref-schema schemas retain IAM limits and persistence failure boundaries', async () => {
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
      const response = await f.handler(request(path, googleLocalRefFormat()));
      assert.equal(response.status, status);
      assert.equal(f.sent.length, dispatched ? 1 : 0);
      assert.equal(f.secrets(), dispatched ? 1 : 0);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
    }
});
test('Gemini local-ref-schema schemas work through actual OpenAI SDK sockets on both bases', async () => {
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
        input(googleLocalRefFormat()) as OpenAI.ChatCompletionCreateParamsNonStreaming,
      );
      assert.equal(result.choices[0]?.message.content, '{"ok":true}');
      const config = f.sent.at(-1)?.generationConfig as Record<string, unknown>;
      assert.deepEqual(config.responseJsonSchema, googleLocalRefFormat().json_schema.schema);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('Gemini local-ref-schema schemas use the same captured native text-stream transport', async () => {
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  const sent: Record<string, unknown>[] = [];
  const format = googleLocalRefFormat();
  const expected = structuredClone(format.json_schema.schema);
  const invoke = createDirectGoogleTextStreamInvoker({
    registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' }],
    resolveSecret: async () => {
      format.json_schema.schema.$defs.Label.enum[0] = 'mutated';
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

function invalidGoogleLocalRefSchemas(): Record<string, unknown>[] {
  const root = { type: 'object' };
  const validDefs = { Label: { type: 'string' } };
  return [
    ...[
      null,
      false,
      [],
      {},
      { 'bad/name': { type: 'string' } },
      { ['a'.repeat(65)]: { type: 'string' } },
      Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`d${i}`, { type: 'string' }])),
      { Label: false },
      { Label: { type: 'string', pattern: 'private' } },
      { Label: { $ref: '#/$defs/Label' } },
      { A: { $ref: '#/$defs/B' }, B: { $ref: '#/$defs/A' } },
      { Unused: { $ref: '#/$defs/missing' } },
    ].map(($defs) => ({ ...root, $defs })),
    ...[
      null,
      false,
      7,
      '',
      '#',
      '#/$defs/missing',
      'https://private.example/schema',
      'other.json#/$defs/Label',
      '#/$defs/Label/child',
      '#/$defs/a~1b',
      '#/$defs/%4cabel',
      '#/$defs/constructor',
    ].map(($ref) => ({ ...root, $defs: validDefs, properties: { label: { $ref } } })),
    { ...root, properties: { label: { $ref: '#/$defs/Label' } } },
    ...[
      { $ref: '#/$defs/Label', type: 'string' },
      { $ref: '#/$defs/Label', description: 'private' },
      { $ref: '#/$defs/Label', $id: 'private' },
      { type: 'object', $defs: validDefs },
      { type: 'string', $anchor: 'private' },
    ].map((label) => ({ ...root, $defs: validDefs, properties: { label } })),
    { ...root, $defs: { A: { type: 'object', properties: { b: { $ref: '#/$defs/A' } } } } },
    {
      ...root,
      $defs: Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [
          `d${i}`,
          i === 0
            ? { type: 'string' }
            : { anyOf: Array.from({ length: 16 }, () => ({ $ref: `#/$defs/d${i - 1}` })) },
        ]),
      ),
    },
    { ...root, $defs: validDefs, $id: 'https://private.example/' },
    { $defs: validDefs, $ref: '#/$defs/Missing' },
  ];
}

test('Gemini local refs reject malformed, cyclic, external and unused definitions before credentials', async () => {
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  let secrets = 0;
  let dispatches = 0;
  const invoke = createDirectGoogleTextStreamInvoker({
    registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' }],
    resolveSecret: async () => {
      secrets++;
      return 'fixture-key';
    },
    fetcher: async () => {
      dispatches++;
      throw new Error('must not dispatch');
    },
  });
  for (const schema of invalidGoogleLocalRefSchemas()) {
    const format = { type: 'json_schema', json_schema: { name: 'result', strict: false, schema } };
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      const f = httpFixture('google');
      assert.equal((await f.handler(request(path, format))).status, 502);
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
    }
    await assert.rejects(() =>
      invoke(
        { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'model' },
        { ...input(format), stream: true } as unknown as ChatRequest,
        () => {
          throw new Error('must not emit');
        },
      ),
    );
  }
  assert.equal(secrets, 0);
  assert.equal(dispatches, 0);
});

test('Gemini local refs enforce expanded depth, traversal budget and exact count limits', async () => {
  const { validateGoogleResponseSchema: validate } = await import(
    '../src/providers/google-response-schema.ts'
  );
  const format = (schema: Record<string, unknown>) =>
    ({ type: 'json_schema', json_schema: { name: 'result', strict: false, schema } }) as const;
  for (const depth of [14, 15]) {
    const defs: Record<string, unknown> = { d0: { type: 'string' } };
    for (let i = 1; i <= depth; i++) defs[`d${i}`] = { $ref: `#/$defs/d${i - 1}` };
    const schema = {
      type: 'object',
      $defs: defs,
      properties: { label: { $ref: `#/$defs/d${depth}` } },
    };
    if (depth === 14) assert.doesNotThrow(() => validate(format(schema)));
    else assert.throws(() => validate(format(schema)));
  }
  const smallDefs: Record<string, unknown> = { d0: { type: 'string' } };
  for (let i = 1; i <= 3; i++)
    smallDefs[`d${i}`] = {
      anyOf: Array.from({ length: 16 }, () => ({ $ref: `#/$defs/d${i - 1}` })),
    };
  assert.doesNotThrow(() => validate(format({ type: 'object', $defs: smallDefs })));
  const specialDefs = Object.fromEntries(
    ['__proto__', 'constructor', 'toString'].map((name) => [name, { type: 'string' }]),
  );
  assert.doesNotThrow(() =>
    validate(
      format({
        type: 'object',
        $defs: specialDefs,
        properties: { label: { $ref: '#/$defs/__proto__' } },
      }),
    ),
  );
  const defs: Record<string, unknown> = { d0: { type: 'string' } };
  for (let i = 1; i <= 7; i++)
    defs[`d${i}`] = { anyOf: Array.from({ length: 16 }, () => ({ $ref: `#/$defs/d${i - 1}` })) };
  assert.throws(() => validate(format({ type: 'object', $defs: defs })));
  assert.doesNotThrow(() =>
    validate(
      format({
        type: 'object',
        $defs: Object.fromEntries(
          Array.from({ length: 128 }, (_, i) => [`d${i}`, { type: 'string' }]),
        ),
      }),
    ),
  );
  assert.doesNotThrow(() =>
    validate(
      format({
        type: 'object',
        $defs: { ['a'.repeat(64)]: { type: 'string' } },
        properties: { x: { $ref: `#/$defs/${'a'.repeat(64)}` } },
      }),
    ),
  );
  for (const strict of [true, null, undefined]) {
    const f = googleLocalRefFormat();
    assert.throws(() =>
      validate({ ...f, json_schema: { ...f.json_schema, strict } } as unknown as Parameters<
        typeof validate
      >[0]),
    );
  }
});

function googleArrayRootFormat() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'result',
      strict: false,
      schema: {
        type: 'array',
        description: 'private array-root-schema literal',
        $defs: { Label: { type: 'string', enum: ['a', 'b'] } },
        items: { $ref: '#/$defs/Label' },
        prefixItems: [{ type: 'string', enum: ['a', 'b'] }],
        minItems: 1,
        maxItems: 4,
      },
    },
  };
}
test('Gemini array-root schemas forward exact immutable schemas on both bases', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const format = googleArrayRootFormat();
    const expected = structuredClone(format.json_schema.schema);
    const f = httpFixture('google', {
      output: '["a"]',
      mutate: () => {
        format.json_schema.schema.$defs.Label.enum[0] = 'mutated';
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
      /private array-root-schema|fixture-key/u,
    );
  }
});
test('Gemini array-root-schema schemas retain IAM limits and persistence failure boundaries', async () => {
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
      const response = await f.handler(request(path, googleArrayRootFormat()));
      assert.equal(response.status, status);
      assert.equal(f.sent.length, dispatched ? 1 : 0);
      assert.equal(f.secrets(), dispatched ? 1 : 0);
      assert.doesNotMatch(await response.text(), /private|fixture-key/u);
    }
});
test('Gemini array-root-schema schemas work through actual OpenAI SDK sockets on both bases', async () => {
  const f = httpFixture('google', { output: '["a"]' });
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
        input(googleArrayRootFormat()) as OpenAI.ChatCompletionCreateParamsNonStreaming,
      );
      assert.equal(result.choices[0]?.message.content, '["a"]');
      const config = f.sent.at(-1)?.generationConfig as Record<string, unknown>;
      assert.deepEqual(config.responseJsonSchema, googleArrayRootFormat().json_schema.schema);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('Gemini array-root-schema schemas use the same captured native text-stream transport', async () => {
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  const sent: Record<string, unknown>[] = [];
  const format = googleArrayRootFormat();
  const expected = structuredClone(format.json_schema.schema);
  const invoke = createDirectGoogleTextStreamInvoker({
    registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' }],
    resolveSecret: async () => {
      format.json_schema.schema.$defs.Label.enum[0] = 'mutated';
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
                content: { role: 'model', parts: [{ text: '["a"]' }] },
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
  assert.ok(JSON.stringify(seen).includes('a'));
  assert.deepEqual(
    (sent[0]?.generationConfig as Record<string, unknown> | undefined)?.responseJsonSchema,
    expected,
  );
});

test('Gemini array roots retain literal root, keyword, reference and depth boundaries', async () => {
  const { validateGoogleResponseSchema: validate } = await import(
    '../src/providers/google-response-schema.ts'
  );
  const wrap = (schema: Record<string, unknown>) =>
    ({ type: 'json_schema', json_schema: { name: 'result', strict: false, schema } }) as const;
  for (const depth of [16, 17]) {
    let schema: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < depth; i++) schema = { type: 'array', items: schema };
    if (depth === 16) assert.doesNotThrow(() => validate(wrap(schema)));
    else assert.throws(() => validate(wrap(schema)));
  }
  for (const schema of [
    { type: 'array', items: { type: 'integer' } },
    { type: 'array', prefixItems: [{ type: 'string' }] },
    { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
  ])
    assert.doesNotThrow(() => validate(wrap(schema)));
  const bad = [
    { type: 'array' },
    { type: 'array', items: false },
    { type: 'array', items: {} },
    { type: 'array', prefixItems: [] },
    { type: 'array', items: { type: 'string' }, properties: {} },
    { type: 'array', items: { type: 'string' }, propertyOrdering: [] },
    { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 1 },
    { type: 'array', items: { $ref: 'https://private.invalid/schema' } },
    { type: 'array', $defs: { A: { $ref: '#/$defs/A' } }, items: { $ref: '#/$defs/A' } },
    { type: 'array', items: { type: 'object', $defs: { A: { type: 'string' } } } },
    { type: ['array'], items: { type: 'string' } },
    { anyOf: [{ type: 'array', items: false }] },
    { type: 'null', enum: [null] },
  ];
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  let secrets = 0;
  let fetches = 0;
  const invoke = createDirectGoogleTextStreamInvoker({
    registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'fixture' }],
    resolveSecret: async () => {
      secrets++;
      return 'fixture-key';
    },
    fetcher: async () => {
      fetches++;
      throw new Error('must not fetch');
    },
  });
  for (const schema of bad) {
    assert.throws(() => validate(wrap(schema)));
    const f = adapter('google');
    await assert.rejects(() => f.call(input(wrap(schema)) as unknown as ChatRequest));
    assert.equal(f.secrets(), 0);
    assert.equal(f.sent.length, 0);
    await assert.rejects(() =>
      invoke(
        { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'model' },
        { ...input(wrap(schema)), stream: true } as unknown as ChatRequest,
        () => {},
      ),
    );
  }
  assert.equal(secrets, 0);
  assert.equal(fetches, 0);
  for (const kind of ['google', 'anthropic'] as const)
    for (const controls of [
      {},
      { tool_choice: 'none' },
      { parallel_tool_calls: true },
      { tools: [] },
    ]) {
      const f = adapter(kind);
      const format = googleArrayRootFormat();
      if (kind === 'google' && Object.keys(controls).length === 0) format.json_schema.strict = true;
      await assert.rejects(() =>
        f.call({ ...input(format), ...controls } as unknown as ChatRequest),
      );
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
    }
});

function googleScalarRootFormat(type = 'string') {
  const schema: Record<string, unknown> = {
    type,
    description: 'private scalar-root-schema literal',
  };
  if (type === 'string') schema.enum = ['a', 'b'];
  if (type === 'number' || type === 'integer') {
    schema.minimum = -2;
    schema.maximum = 5;
  }
  return { type: 'json_schema', json_schema: { name: 'result', strict: false, schema } };
}
function scalarOutput(type: string) {
  return type === 'string' ? '"a"' : type === 'boolean' ? 'true' : type === 'number' ? '1.5' : '2';
}
for (const type of ['string', 'number', 'integer', 'boolean']) {
  test(
    'Gemini scalar-root schemas forward exact immutable schemas on both bases' + ' ' + type,
    async () => {
      for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
        const format = googleScalarRootFormat(type);
        const expected = structuredClone(format.json_schema.schema);
        const f = httpFixture('google', {
          output: scalarOutput(type),
          mutate: () => {
            format.json_schema.schema.description = 'mutated';
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
          /private scalar-root-schema|fixture-key/u,
        );
      }
    },
  );
  test(
    'Gemini scalar-root-schema schemas retain IAM limits and persistence failure boundaries' +
      ' ' +
      type,
    async () => {
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
          const response = await f.handler(request(path, googleScalarRootFormat(type)));
          assert.equal(response.status, status);
          assert.equal(f.sent.length, dispatched ? 1 : 0);
          assert.equal(f.secrets(), dispatched ? 1 : 0);
          assert.doesNotMatch(await response.text(), /private|fixture-key/u);
        }
    },
  );
  test(
    'Gemini scalar-root-schema schemas work through actual OpenAI SDK sockets on both bases' +
      ' ' +
      type,
    async () => {
      const f = httpFixture('google', { output: scalarOutput(type) });
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
            input(googleScalarRootFormat(type)) as OpenAI.ChatCompletionCreateParamsNonStreaming,
          );
          assert.equal(result.choices[0]?.message.content, scalarOutput(type));
          const config = f.sent.at(-1)?.generationConfig as Record<string, unknown>;
          assert.deepEqual(
            config.responseJsonSchema,
            googleScalarRootFormat(type).json_schema.schema,
          );
        }
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );

  test(
    'Gemini scalar-root-schema schemas use the same captured native text-stream transport' +
      ' ' +
      type,
    async () => {
      const { createDirectGoogleTextStreamInvoker } = await import(
        '../src/providers/direct-google-stream.ts'
      );
      const sent: Record<string, unknown>[] = [];
      const format = googleScalarRootFormat(type);
      const expected = structuredClone(format.json_schema.schema);
      const invoke = createDirectGoogleTextStreamInvoker({
        registrations: [
          { providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' },
        ],
        resolveSecret: async () => {
          format.json_schema.schema.description = 'mutated';
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
                    content: { role: 'model', parts: [{ text: scalarOutput(type) }] },
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
      assert.ok(JSON.stringify(seen).includes(scalarOutput(type).replaceAll('"', '')));
      assert.deepEqual(
        (sent[0]?.generationConfig as Record<string, unknown> | undefined)?.responseJsonSchema,
        expected,
      );
    },
  );
}

test('Gemini scalar roots retain recursive constraints and pre-secret rejection', async () => {
  const { validateGoogleResponseSchema: validate } = await import(
    '../src/providers/google-response-schema.ts'
  );
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  const wrap = (schema: Record<string, unknown>) =>
    ({ type: 'json_schema', json_schema: { name: 'result', strict: false, schema } }) as const;
  let secrets = 0;
  let fetches = 0;
  const stream = createDirectGoogleTextStreamInvoker({
    registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'fixture' }],
    resolveSecret: async () => {
      secrets++;
      return 'fixture-key';
    },
    fetcher: async () => {
      fetches++;
      throw new Error('must not fetch');
    },
  });
  for (const schema of [
    { type: 'null', enum: [null] },
    { type: ['string'] },
    { anyOf: [{ type: 'string', pattern: 'private' }] },
    { $ref: '#/$defs/A', $defs: { A: { type: 'string', pattern: 'private' } } },
    { type: 'string', pattern: 'private' },
    { type: 'string', minimum: 1 },
    { type: 'number', format: 'date' },
    { type: 'number', minimum: 3, maximum: 1 },
    { type: 'integer', enum: [1.5] },
    { type: 'boolean', enum: [true] },
    { type: 'string', properties: {} },
    { type: 'boolean', items: { type: 'string' } },
    { type: 'number', prefixItems: [{ type: 'string' }] },
    { type: 'string', $defs: { A: { $ref: '#/$defs/A' } } },
    { type: 'string', $defs: { A: { type: 'string', pattern: 'private' } } },
    { type: 'string', anyOf: [{ $ref: 'https://private.invalid/schema' }] },
  ]) {
    const format = wrap(schema);
    assert.throws(() => validate(format));
    const f = adapter('google');
    await assert.rejects(() => f.call(input(format) as unknown as ChatRequest));
    assert.equal(f.secrets(), 0);
    assert.equal(f.sent.length, 0);
    await assert.rejects(() =>
      stream(
        { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'model' },
        { ...input(format), stream: true } as unknown as ChatRequest,
        () => {},
      ),
    );
  }
  assert.equal(secrets, 0);
  assert.equal(fetches, 0);
  for (const type of ['string', 'number', 'integer', 'boolean'])
    for (const kind of ['google', 'anthropic'] as const)
      for (const controls of [
        {},
        { tool_choice: 'none' },
        { tools: [] },
        { parallel_tool_calls: true },
      ]) {
        const format = googleScalarRootFormat(type);
        if (kind === 'google' && Object.keys(controls).length === 0)
          format.json_schema.strict = true;
        const f = adapter(kind);
        await assert.rejects(() =>
          f.call({ ...input(format), ...controls } as unknown as ChatRequest),
        );
        assert.equal(f.secrets(), 0);
        assert.equal(f.sent.length, 0);
        if (kind === 'google')
          await assert.rejects(() =>
            stream(
              {
                id: 'candidate',
                kind: 'managed',
                providerId: 'provider',
                upstreamModelId: 'model',
              },
              { ...input(format), ...controls, stream: true } as unknown as ChatRequest,
              () => {},
            ),
          );
      }
  assert.equal(secrets, 0);
  assert.equal(fetches, 0);
});

function googleNullableRootFormat(type: string, nullFirst = false) {
  const format = googleScalarRootFormat(type);
  format.json_schema.schema.type = nullFirst ? ['null', type] : [type, 'null'];
  format.json_schema.schema.description = 'private nullable-root-schema literal';
  if (type === 'array') format.json_schema.schema.items = { type: 'string' };
  return format;
}
function nullableRootOutput(type: string, nullFirst: boolean) {
  return nullFirst
    ? 'null'
    : type === 'object'
      ? '{}'
      : type === 'array'
        ? '["a"]'
        : scalarOutput(type);
}
for (const nullFirst of [false, true])
  for (const type of ['object', 'array', 'string', 'number', 'integer', 'boolean']) {
    test(
      'Gemini nullable-root schemas forward exact immutable schemas on both bases' +
        ' ' +
        type +
        String(nullFirst),
      async () => {
        for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
          const format = googleNullableRootFormat(type, nullFirst);
          const expected = structuredClone(format.json_schema.schema);
          const f = httpFixture('google', {
            output: nullableRootOutput(type, nullFirst),
            mutate: () => {
              format.json_schema.schema.description = 'mutated';
            },
          });
          const req = request(path, format);
          Object.defineProperty(req, 'json', { value: async () => input(format) });
          assert.equal((await f.handler(req)).status, 200);
          assert.deepEqual(
            (f.sent[0]?.generationConfig as Record<string, unknown> | undefined)
              ?.responseJsonSchema,
            expected,
          );
          assert.equal(f.secrets(), 1);
          assert.equal(f.usage.length, 1);
          assert.doesNotMatch(
            JSON.stringify([f.audits, f.usage]),
            /private nullable-root-schema|fixture-key/u,
          );
        }
      },
    );
    test(
      'Gemini nullable-root-schema schemas retain IAM limits and persistence failure boundaries' +
        ' ' +
        type +
        String(nullFirst),
      async () => {
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
            const response = await f.handler(
              request(path, googleNullableRootFormat(type, nullFirst)),
            );
            assert.equal(response.status, status);
            assert.equal(f.sent.length, dispatched ? 1 : 0);
            assert.equal(f.secrets(), dispatched ? 1 : 0);
            assert.doesNotMatch(await response.text(), /private|fixture-key/u);
          }
      },
    );
    test(
      'Gemini nullable-root-schema schemas work through actual OpenAI SDK sockets on both bases' +
        ' ' +
        type +
        String(nullFirst),
      async () => {
        const f = httpFixture('google', { output: nullableRootOutput(type, nullFirst) });
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
              input(
                googleNullableRootFormat(type, nullFirst),
              ) as OpenAI.ChatCompletionCreateParamsNonStreaming,
            );
            assert.equal(result.choices[0]?.message.content, nullableRootOutput(type, nullFirst));
            const config = f.sent.at(-1)?.generationConfig as Record<string, unknown>;
            assert.deepEqual(
              config.responseJsonSchema,
              googleNullableRootFormat(type, nullFirst).json_schema.schema,
            );
          }
        } finally {
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        }
      },
    );

    test(
      'Gemini nullable-root-schema schemas use the same captured native text-stream transport' +
        ' ' +
        type +
        String(nullFirst),
      async () => {
        const { createDirectGoogleTextStreamInvoker } = await import(
          '../src/providers/direct-google-stream.ts'
        );
        const sent: Record<string, unknown>[] = [];
        const format = googleNullableRootFormat(type, nullFirst);
        const expected = structuredClone(format.json_schema.schema);
        const invoke = createDirectGoogleTextStreamInvoker({
          registrations: [
            { providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' },
          ],
          resolveSecret: async () => {
            format.json_schema.schema.description = 'mutated';
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
                      content: {
                        role: 'model',
                        parts: [{ text: nullableRootOutput(type, nullFirst) }],
                      },
                      finishReason: 'STOP',
                    },
                  ],
                  usageMetadata: {
                    promptTokenCount: 2,
                    candidatesTokenCount: 1,
                    totalTokenCount: 3,
                  },
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
        assert.ok(
          JSON.stringify(seen).includes(
            JSON.stringify(nullableRootOutput(type, nullFirst)).slice(1, -1),
          ),
        );
        assert.deepEqual(
          (sent[0]?.generationConfig as Record<string, unknown> | undefined)?.responseJsonSchema,
          expected,
        );
      },
    );
  }

test('Gemini nullable roots retain recursive constraints and pre-secret rejection', async () => {
  const { validateGoogleResponseSchema: validate } = await import(
    '../src/providers/google-response-schema.ts'
  );
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  const wrap = (schema: Record<string, unknown>) =>
    ({ type: 'json_schema', json_schema: { name: 'result', strict: false, schema } }) as const;
  let secrets = 0;
  let fetches = 0;
  const stream = createDirectGoogleTextStreamInvoker({
    registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'fixture' }],
    resolveSecret: async () => {
      secrets++;
      return 'fixture-key';
    },
    fetcher: async () => {
      fetches++;
      throw new Error('must not fetch');
    },
  });
  for (const schema of [
    ...[
      [],
      ['null'],
      ['object'],
      ['null', 'null'],
      ['string', 'string'],
      ['string', 'number'],
      ['null', 'unknown'],
      ['null', 1],
      ['string', 'null', 'number'],
      ['null', 'string', 'null'],
    ].map((type) => ({ type })),
    { type: 'null', enum: [null] },
    { anyOf: [{ type: 'string' }, false] },
    ...[
      { type: 'string', pattern: 'private' },
      { type: 'string', minimum: 1 },
      { type: 'number', format: 'date' },
      { type: 'number', minimum: 3, maximum: 1 },
      { type: 'integer', enum: [1.5] },
      { type: 'boolean', enum: [true] },
      { type: 'string', enum: ['a', null] },
      { type: 'string', properties: {} },
      { type: 'array' },
      { type: 'array', items: false },
      { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 1 },
      { type: 'object', properties: { x: { type: ['string', 'number'] } } },
      { type: 'object', propertyOrdering: ['missing'] },
      { type: 'object', $defs: { A: { $ref: '#/$defs/A' } } },
      { type: 'object', properties: { x: { $ref: 'https://private.invalid/schema' } } },
    ].map((schema) => ({ ...schema, type: [schema.type, 'null'] })),
  ]) {
    const format = wrap(schema);
    assert.throws(() => validate(format));
    const f = adapter('google');
    await assert.rejects(() => f.call(input(format) as unknown as ChatRequest));
    assert.equal(f.secrets(), 0);
    assert.equal(f.sent.length, 0);
    await assert.rejects(() =>
      stream(
        { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'model' },
        { ...input(format), stream: true } as unknown as ChatRequest,
        () => {},
      ),
    );
  }
  assert.equal(secrets, 0);
  assert.equal(fetches, 0);
  for (const type of ['object', 'array', 'string', 'number', 'integer', 'boolean'])
    for (const kind of ['google', 'anthropic'] as const)
      for (const controls of [
        {},
        { tool_choice: 'none' },
        { tools: [] },
        { parallel_tool_calls: true },
      ]) {
        const format = googleNullableRootFormat(type);
        if (kind === 'google' && Object.keys(controls).length === 0)
          format.json_schema.strict = true;
        const f = adapter(kind);
        await assert.rejects(() =>
          f.call({ ...input(format), ...controls } as unknown as ChatRequest),
        );
        assert.equal(f.secrets(), 0);
        assert.equal(f.sent.length, 0);
        if (kind === 'google')
          await assert.rejects(() =>
            stream(
              {
                id: 'candidate',
                kind: 'managed',
                providerId: 'provider',
                upstreamModelId: 'model',
              },
              { ...input(format), ...controls, stream: true } as unknown as ChatRequest,
              () => {},
            ),
          );
      }
  assert.equal(secrets, 0);
  assert.equal(fetches, 0);
});
test('Gemini nullable roots preserve local refs and enforce expanded depth, traversal budget and exact count limits', async () => {
  const { validateGoogleResponseSchema: validate } = await import(
    '../src/providers/google-response-schema.ts'
  );
  const format = (schema: Record<string, unknown>) =>
    ({
      type: 'json_schema',
      json_schema: {
        name: 'result',
        strict: false,
        schema: { ...schema, type: ['null', schema.type] },
      },
    }) as const;
  for (const depth of [14, 15]) {
    const defs: Record<string, unknown> = { d0: { type: 'string' } };
    for (let i = 1; i <= depth; i++) defs[`d${i}`] = { $ref: `#/$defs/d${i - 1}` };
    const schema = {
      type: 'object',
      $defs: defs,
      properties: { label: { $ref: `#/$defs/d${depth}` } },
    };
    if (depth === 14) assert.doesNotThrow(() => validate(format(schema)));
    else assert.throws(() => validate(format(schema)));
  }
  const smallDefs: Record<string, unknown> = { d0: { type: 'string' } };
  for (let i = 1; i <= 3; i++)
    smallDefs[`d${i}`] = {
      anyOf: Array.from({ length: 16 }, () => ({ $ref: `#/$defs/d${i - 1}` })),
    };
  assert.doesNotThrow(() => validate(format({ type: 'object', $defs: smallDefs })));
  const specialDefs = Object.fromEntries(
    ['__proto__', 'constructor', 'toString'].map((name) => [name, { type: 'string' }]),
  );
  assert.doesNotThrow(() =>
    validate(
      format({
        type: 'object',
        $defs: specialDefs,
        properties: { label: { $ref: '#/$defs/__proto__' } },
      }),
    ),
  );
  const defs: Record<string, unknown> = { d0: { type: 'string' } };
  for (let i = 1; i <= 7; i++)
    defs[`d${i}`] = { anyOf: Array.from({ length: 16 }, () => ({ $ref: `#/$defs/d${i - 1}` })) };
  assert.throws(() => validate(format({ type: 'object', $defs: defs })));
  assert.doesNotThrow(() =>
    validate(
      format({
        type: 'object',
        $defs: Object.fromEntries(
          Array.from({ length: 128 }, (_, i) => [`d${i}`, { type: 'string' }]),
        ),
      }),
    ),
  );
  assert.doesNotThrow(() =>
    validate(
      format({
        type: 'object',
        $defs: { ['a'.repeat(64)]: { type: 'string' } },
        properties: { x: { $ref: `#/$defs/${'a'.repeat(64)}` } },
      }),
    ),
  );
  for (const strict of [true, null, undefined]) {
    const f = googleLocalRefFormat();
    assert.throws(() =>
      validate({ ...f, json_schema: { ...f.json_schema, strict } } as unknown as Parameters<
        typeof validate
      >[0]),
    );
  }
});

function googleUnionRootFormat(type: string, withDefs = false) {
  const branch = { type: 'object', properties: { label: { type: 'string' } } };
  const schema: Record<string, unknown> = {
    [type]: [withDefs ? { $ref: '#/$defs/Answer' } : branch, { type: 'null' }],
    description: 'private union-root-schema literal',
  };
  if (withDefs) schema.$defs = { Answer: branch };
  return { type: 'json_schema', json_schema: { name: 'result', strict: false, schema } } as const;
}
function unionRootOutput(_type: string, withDefs: boolean) {
  return withDefs ? 'null' : JSON.stringify({ label: 'ok' });
}
for (const withDefs of [false, true])
  for (const type of ['anyOf', 'oneOf']) {
    test(
      'Gemini union-root schemas forward exact immutable schemas on both bases' +
        ' ' +
        type +
        String(withDefs),
      async () => {
        for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
          const format = googleUnionRootFormat(type, withDefs);
          const expected = structuredClone(format.json_schema.schema);
          const f = httpFixture('google', {
            output: unionRootOutput(type, withDefs),
            mutate: () => {
              format.json_schema.schema.description = 'mutated';
            },
          });
          const req = request(path, format);
          Object.defineProperty(req, 'json', { value: async () => input(format) });
          assert.equal((await f.handler(req)).status, 200);
          assert.deepEqual(
            (f.sent[0]?.generationConfig as Record<string, unknown> | undefined)
              ?.responseJsonSchema,
            expected,
          );
          assert.equal(f.secrets(), 1);
          assert.equal(f.usage.length, 1);
          assert.doesNotMatch(
            JSON.stringify([f.audits, f.usage]),
            /private union-root-schema|fixture-key/u,
          );
        }
      },
    );
    test(
      'Gemini union-root-schema schemas retain IAM limits and persistence failure boundaries' +
        ' ' +
        type +
        String(withDefs),
      async () => {
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
            const response = await f.handler(request(path, googleUnionRootFormat(type, withDefs)));
            assert.equal(response.status, status);
            assert.equal(f.sent.length, dispatched ? 1 : 0);
            assert.equal(f.secrets(), dispatched ? 1 : 0);
            assert.doesNotMatch(await response.text(), /private|fixture-key/u);
          }
      },
    );
    test(
      'Gemini union-root-schema schemas work through actual OpenAI SDK sockets on both bases' +
        ' ' +
        type +
        String(withDefs),
      async () => {
        const f = httpFixture('google', { output: unionRootOutput(type, withDefs) });
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
              input(
                googleUnionRootFormat(type, withDefs),
              ) as OpenAI.ChatCompletionCreateParamsNonStreaming,
            );
            assert.equal(result.choices[0]?.message.content, unionRootOutput(type, withDefs));
            const config = f.sent.at(-1)?.generationConfig as Record<string, unknown>;
            assert.deepEqual(
              config.responseJsonSchema,
              googleUnionRootFormat(type, withDefs).json_schema.schema,
            );
          }
        } finally {
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        }
      },
    );

    test(
      'Gemini union-root-schema schemas use the same captured native text-stream transport' +
        ' ' +
        type +
        String(withDefs),
      async () => {
        const { createDirectGoogleTextStreamInvoker } = await import(
          '../src/providers/direct-google-stream.ts'
        );
        const sent: Record<string, unknown>[] = [];
        const format = googleUnionRootFormat(type, withDefs);
        const expected = structuredClone(format.json_schema.schema);
        const invoke = createDirectGoogleTextStreamInvoker({
          registrations: [
            { providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' },
          ],
          resolveSecret: async () => {
            format.json_schema.schema.description = 'mutated';
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
                      content: {
                        role: 'model',
                        parts: [{ text: unionRootOutput(type, withDefs) }],
                      },
                      finishReason: 'STOP',
                    },
                  ],
                  usageMetadata: {
                    promptTokenCount: 2,
                    candidatesTokenCount: 1,
                    totalTokenCount: 3,
                  },
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
        assert.ok(
          JSON.stringify(seen).includes(
            JSON.stringify(unionRootOutput(type, withDefs)).slice(1, -1),
          ),
        );
        assert.deepEqual(
          (sent[0]?.generationConfig as Record<string, unknown> | undefined)?.responseJsonSchema,
          expected,
        );
      },
    );
  }

for (const union of ['anyOf', 'oneOf']) {
  test(`Gemini ${union} roots reject unsupported schemas and controls before secrets`, async () => {
    const { validateGoogleResponseSchema: validate } = await import(
      '../src/providers/google-response-schema.ts'
    );
    const { createDirectGoogleTextStreamInvoker } = await import(
      '../src/providers/direct-google-stream.ts'
    );
    const wrap = (schema: Record<string, unknown>) =>
      ({ type: 'json_schema', json_schema: { name: 'result', strict: false, schema } }) as const;
    let secrets = 0;
    let fetches = 0;
    const stream = createDirectGoogleTextStreamInvoker({
      registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'fixture' }],
      resolveSecret: async () => {
        secrets++;
        return 'fixture-key';
      },
      fetcher: async () => {
        fetches++;
        throw new Error('must not fetch');
      },
    });
    const candidate = {
      id: 'candidate',
      kind: 'managed',
      providerId: 'provider',
      upstreamModelId: 'model',
    } as const;
    const badSchemas: Record<string, unknown>[] = [
      ...[
        null,
        {},
        [],
        [false],
        [null],
        ['string'],
        Array.from({ length: 17 }, () => ({ type: 'string' })),
        [{ type: 'string', pattern: 'private' }],
      ].map((branches) => ({ [union]: branches })),
      ...[
        'properties',
        'items',
        'required',
        'format',
        '$ref',
        'additionalProperties',
        'propertyOrdering',
        'type',
      ].map((key) => ({ [union]: [{ type: 'string' }], [key]: null })),
      { anyOf: [{ type: 'string' }], oneOf: [{ type: 'string' }] },
      { [union]: [{ $ref: 'https://private.example/schema' }] },
      { [union]: [{ $ref: '#/$defs/Missing' }], $defs: { A: { type: 'string' } } },
      { [union]: [{ $ref: '#/$defs/A' }], $defs: { A: { $ref: '#/$defs/A' } } },
      { [union]: [{ $ref: '#/$defs/A', title: 'private' }], $defs: { A: { type: 'string' } } },
      { [union]: [{ [union]: [{ type: 'string' }], $defs: { A: { type: 'string' } } }] },
      { [union]: [{ type: 'string' }], $defs: {} },
      { [union]: [{ type: 'string' }], $defs: { A: { type: 'string', pattern: 'private' } } },
      { $ref: '#/$defs/A', $defs: { A: { [union]: [{ type: 'string', pattern: 'private' }] } } },
    ];
    for (const schema of badSchemas) {
      const format = wrap(schema);
      assert.throws(() => validate(format));
      const f = adapter('google');
      await assert.rejects(() => f.call(input(format) as unknown as ChatRequest));
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
      await assert.rejects(() =>
        stream(candidate, { ...input(format), stream: true } as unknown as ChatRequest, () => {}),
      );
      for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
        const h = httpFixture('google');
        const response = await h.handler(request(path, format));
        assert.equal(response.status, 502);
        assert.equal(h.secrets(), 0);
        assert.equal(h.sent.length, 0);
        assert.doesNotMatch(await response.text(), /private|fixture-key/u);
      }
    }
    for (const kind of ['google', 'anthropic'] as const)
      for (const controls of [
        {},
        { tool_choice: 'none' },
        { tools: [] },
        { parallel_tool_calls: true },
      ]) {
        const base = googleUnionRootFormat(union);
        const format =
          kind === 'google' && Object.keys(controls).length === 0
            ? { ...base, json_schema: { ...base.json_schema, strict: true } }
            : base;
        const f = adapter(kind);
        const req = { ...input(format), ...controls } as unknown as ChatRequest;
        await assert.rejects(() => f.call(req));
        assert.equal(f.secrets(), 0);
        assert.equal(f.sent.length, 0);
        if (kind === 'google')
          await assert.rejects(() =>
            stream(candidate, { ...req, stream: true } as unknown as ChatRequest, () => {}),
          );
      }
    for (const strict of [undefined, null]) {
      const base = googleUnionRootFormat(union);
      const req = input({
        ...base,
        json_schema: { ...base.json_schema, strict },
      }) as unknown as ChatRequest;
      const f = adapter('google');
      await assert.rejects(() => f.call(req));
      assert.equal(f.secrets(), 0);
      await assert.rejects(() =>
        stream(candidate, { ...req, stream: true } as unknown as ChatRequest, () => {}),
      );
    }
    assert.equal(secrets, 0);
    assert.equal(fetches, 0);
  });
  test(`Gemini ${union} roots share branch, expanded depth and traversal bounds`, async () => {
    const { validateGoogleResponseSchema: validate } = await import(
      '../src/providers/google-response-schema.ts'
    );
    const wrap = (schema: Record<string, unknown>) =>
      ({ type: 'json_schema', json_schema: { name: 'result', strict: false, schema } }) as const;
    for (const count of [1, 16])
      assert.doesNotThrow(() =>
        validate(wrap({ [union]: Array.from({ length: count }, () => ({ type: 'null' })) })),
      );
    for (const depth of [16, 17]) {
      let node: Record<string, unknown> = { type: 'string' };
      for (let i = 0; i < depth; i++) node = { [union]: [node] };
      if (depth === 16) assert.doesNotThrow(() => validate(wrap(node)));
      else assert.throws(() => validate(wrap(node)));
    }
    for (const depth of [14, 15]) {
      const defs: Record<string, unknown> = { d0: { type: 'string' } };
      for (let i = 1; i <= depth; i++) defs[`d${i}`] = { $ref: `#/$defs/d${i - 1}` };
      const schema = { [union]: [{ $ref: `#/$defs/d${depth}` }], $defs: defs };
      if (depth === 14) assert.doesNotThrow(() => validate(wrap(schema)));
      else assert.throws(() => validate(wrap(schema)));
    }
    for (const levels of [3, 7]) {
      const defs: Record<string, unknown> = { d0: { type: 'string' } };
      for (let i = 1; i <= levels; i++)
        defs[`d${i}`] = {
          [union]: Array.from({ length: 16 }, () => ({ $ref: `#/$defs/d${i - 1}` })),
        };
      const schema = { [union]: [{ $ref: `#/$defs/d${levels}` }], $defs: defs };
      if (levels === 3) assert.doesNotThrow(() => validate(wrap(schema)));
      else assert.throws(() => validate(wrap(schema)));
    }
    for (const count of [128, 129]) {
      const schema = {
        [union]: [{ type: 'string' }],
        $defs: Object.fromEntries(
          Array.from({ length: count }, (_, i) => [`d${i}`, { type: 'string' }]),
        ),
      };
      if (count === 128) assert.doesNotThrow(() => validate(wrap(schema)));
      else assert.throws(() => validate(wrap(schema)));
    }
    const defs = Object.fromEntries(
      ['__proto__', 'constructor', 'toString'].map((name) => [name, { type: 'string' }]),
    );
    for (const name of Object.keys(defs))
      assert.doesNotThrow(() =>
        validate(wrap({ [union]: [{ $ref: `#/$defs/${name}` }], $defs: defs })),
      );
  });
}

function googleRootRefFormat(type: string, withDefs = false) {
  const branch = {
    type: type === 'nullable' ? ['object', 'null'] : 'object',
    properties: { label: { type: 'string' } },
    description: 'private root-local-ref-schema literal',
  };
  const schema = {
    $ref: withDefs ? '#/$defs/Alias' : '#/$defs/Answer',
    $defs: { Answer: branch, ...(withDefs ? { Alias: { $ref: '#/$defs/Answer' } } : {}) },
  };
  return { type: 'json_schema', json_schema: { name: 'result', strict: false, schema } } as const;
}
function rootRefOutput(type: string, _withDefs: boolean) {
  return type === 'nullable' ? 'null' : JSON.stringify({ label: 'ok' });
}
for (const withDefs of [false, true])
  for (const type of ['object', 'nullable']) {
    test(
      'Gemini root-local-ref schemas forward exact immutable schemas on both bases' +
        ' ' +
        type +
        String(withDefs),
      async () => {
        for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
          const format = googleRootRefFormat(type, withDefs);
          const expected = structuredClone(format.json_schema.schema);
          const f = httpFixture('google', {
            output: rootRefOutput(type, withDefs),
            mutate: () => {
              format.json_schema.schema.$defs.Answer.description = 'mutated';
            },
          });
          const req = request(path, format);
          Object.defineProperty(req, 'json', { value: async () => input(format) });
          assert.equal((await f.handler(req)).status, 200);
          assert.deepEqual(
            (f.sent[0]?.generationConfig as Record<string, unknown> | undefined)
              ?.responseJsonSchema,
            expected,
          );
          assert.equal(f.secrets(), 1);
          assert.equal(f.usage.length, 1);
          assert.doesNotMatch(
            JSON.stringify([f.audits, f.usage]),
            /private root-local-ref-schema|fixture-key/u,
          );
        }
      },
    );
    test(
      'Gemini root-local-ref-schema schemas retain IAM limits and persistence failure boundaries' +
        ' ' +
        type +
        String(withDefs),
      async () => {
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
            const response = await f.handler(request(path, googleRootRefFormat(type, withDefs)));
            assert.equal(response.status, status);
            assert.equal(f.sent.length, dispatched ? 1 : 0);
            assert.equal(f.secrets(), dispatched ? 1 : 0);
            assert.doesNotMatch(await response.text(), /private|fixture-key/u);
          }
      },
    );
    test(
      'Gemini root-local-ref-schema schemas work through actual OpenAI SDK sockets on both bases' +
        ' ' +
        type +
        String(withDefs),
      async () => {
        const f = httpFixture('google', { output: rootRefOutput(type, withDefs) });
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
              input(
                googleRootRefFormat(type, withDefs),
              ) as OpenAI.ChatCompletionCreateParamsNonStreaming,
            );
            assert.equal(result.choices[0]?.message.content, rootRefOutput(type, withDefs));
            const config = f.sent.at(-1)?.generationConfig as Record<string, unknown>;
            assert.deepEqual(
              config.responseJsonSchema,
              googleRootRefFormat(type, withDefs).json_schema.schema,
            );
          }
        } finally {
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        }
      },
    );

    test(
      'Gemini root-local-ref-schema schemas use the same captured native text-stream transport' +
        ' ' +
        type +
        String(withDefs),
      async () => {
        const { createDirectGoogleTextStreamInvoker } = await import(
          '../src/providers/direct-google-stream.ts'
        );
        const sent: Record<string, unknown>[] = [];
        const format = googleRootRefFormat(type, withDefs);
        const expected = structuredClone(format.json_schema.schema);
        const invoke = createDirectGoogleTextStreamInvoker({
          registrations: [
            { providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' },
          ],
          resolveSecret: async () => {
            format.json_schema.schema.$defs.Answer.description = 'mutated';
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
                      content: {
                        role: 'model',
                        parts: [{ text: rootRefOutput(type, withDefs) }],
                      },
                      finishReason: 'STOP',
                    },
                  ],
                  usageMetadata: {
                    promptTokenCount: 2,
                    candidatesTokenCount: 1,
                    totalTokenCount: 3,
                  },
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
        assert.ok(
          JSON.stringify(seen).includes(JSON.stringify(rootRefOutput(type, withDefs)).slice(1, -1)),
        );
        assert.deepEqual(
          (sent[0]?.generationConfig as Record<string, unknown> | undefined)?.responseJsonSchema,
          expected,
        );
      },
    );
  }

test('Gemini root local refs retain expanded depth, shared budget and definition/name bounds', async () => {
  const { validateGoogleResponseSchema: validate } = await import(
    '../src/providers/google-response-schema.ts'
  );
  const wrap = (schema: Record<string, unknown>) =>
    ({ type: 'json_schema', json_schema: { name: 'result', strict: false, schema } }) as const;
  for (const target of [
    { type: 'string', enum: ['ok'] },
    { type: 'number', minimum: 0 },
    { type: 'integer', maximum: 2 },
    { type: 'boolean' },
    { type: 'null' },
    { type: 'array', items: { type: 'string' } },
    { anyOf: [{ type: 'string' }, { type: 'null' }] },
    { oneOf: [{ type: 'object' }, { type: 'array', items: { type: 'boolean' } }] },
  ])
    assert.doesNotThrow(() => validate(wrap({ $ref: '#/$defs/A', $defs: { A: target } })));
  for (const depth of [15, 16]) {
    const defs: Record<string, unknown> = { d0: { type: 'string' } };
    for (let i = 1; i <= depth; i++) defs[`d${i}`] = { $ref: `#/$defs/d${i - 1}` };
    const schema = { $ref: `#/$defs/d${depth}`, $defs: defs };
    if (depth === 15) assert.doesNotThrow(() => validate(wrap(schema)));
    else assert.throws(() => validate(wrap(schema)));
  }
  for (const levels of [3, 7]) {
    const defs: Record<string, unknown> = { d0: { type: 'string' } };
    for (let i = 1; i <= levels; i++)
      defs[`d${i}`] = { anyOf: Array.from({ length: 16 }, () => ({ $ref: `#/$defs/d${i - 1}` })) };
    const schema = { $ref: `#/$defs/d${levels}`, $defs: defs };
    if (levels === 3) assert.doesNotThrow(() => validate(wrap(schema)));
    else assert.throws(() => validate(wrap(schema)));
  }
  for (const count of [128, 129]) {
    const schema = {
      $ref: '#/$defs/d0',
      $defs: Object.fromEntries(
        Array.from({ length: count }, (_, i) => [`d${i}`, { type: 'string' }]),
      ),
    };
    if (count === 128) assert.doesNotThrow(() => validate(wrap(schema)));
    else assert.throws(() => validate(wrap(schema)));
  }
  for (const name of ['__proto__', 'constructor', 'toString', 'a'.repeat(64)])
    assert.doesNotThrow(() =>
      validate(
        wrap({ $ref: `#/$defs/${name}`, $defs: Object.fromEntries([[name, { type: 'string' }]]) }),
      ),
    );
});

test('Gemini root local refs reject malformed schemas and unsupported controls before credentials', async () => {
  const { validateGoogleResponseSchema: validate } = await import(
    '../src/providers/google-response-schema.ts'
  );
  const wrap = (schema: Record<string, unknown>) =>
    ({ type: 'json_schema', json_schema: { name: 'private', strict: false, schema } }) as const;
  const base = { $ref: '#/$defs/A', $defs: { A: { type: 'string' } } };
  const invalidSchemas: Record<string, unknown>[] = [
    ...[
      'https://example.invalid/private',
      '#',
      '#/$defs/Missing',
      '#/$defs/a~1b',
      '#/$defs/constructor',
      null,
      1,
    ].map(($ref) => ({ ...base, $ref })),
    { $ref: '#/$defs/A' },
    { ...base, $defs: {} },
    { ...base, $defs: [] },
    { ...base, $defs: null },
    { ...base, $defs: { A: { $ref: '#/$defs/A' } } },
    { ...base, $defs: { A: { $ref: '#/$defs/B' }, B: { $ref: '#/$defs/A' } } },
    { ...base, $defs: { A: { type: 'string' }, Unused: { type: 'string', pattern: 'private' } } },
    { ...base, $defs: { A: { type: 'object', properties: { a: { $ref: '#/$defs/A' } } } } },
    { ...base, $defs: { A: { $ref: '#/$defs/B', $defs: { B: { type: 'string' } } } } },
    { ...base, $defs: { A: { $ref: '#/$defs/B', title: 'private' }, B: { type: 'string' } } },
    ...[
      'type',
      'title',
      'description',
      'properties',
      'anyOf',
      'oneOf',
      '$id',
      '$anchor',
      'pattern',
    ].map((key) => ({ ...base, [key]: 'private' })),
    { ...base, $defs: { ['a'.repeat(65)]: { type: 'string' } } },
    { type: 'null', enum: [null] },
  ];
  for (const schema of invalidSchemas) {
    assert.throws(() => validate(wrap(schema)));
    for (const kind of ['google', 'anthropic'] as const) {
      const a = adapter(kind);
      await assert.rejects(a.call(input(wrap(schema)) as unknown as ChatRequest));
      assert.equal(a.secrets(), 0);
      assert.equal(a.sent.length, 0);
    }
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      const f = httpFixture('google');
      const response = await f.handler(request(path, wrap(schema)));
      assert.equal(response.status, 502);
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
      assert.equal(f.usage.length, 0);
      assert.doesNotMatch(
        JSON.stringify([await response.text(), f.audits]),
        /private|fixture-key/u,
      );
    }
  }
  for (const strict of [true, null, undefined]) {
    const format = { ...wrap(base), json_schema: { ...wrap(base).json_schema, strict } };
    for (const kind of ['google', 'anthropic'] as const) {
      const a = adapter(kind);
      await assert.rejects(a.call(input(format) as unknown as ChatRequest));
      assert.equal(a.secrets(), 0);
      assert.equal(a.sent.length, 0);
    }
  }
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  for (const schema of invalidSchemas) {
    let secrets = 0;
    let sends = 0;
    const invoke = createDirectGoogleTextStreamInvoker({
      registrations: [
        { providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' },
      ],
      resolveSecret: async () => {
        secrets++;
        return 'fixture-key';
      },
      fetcher: async () => {
        sends++;
        throw new Error('unexpected');
      },
    });
    await assert.rejects(
      invoke(
        { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'model' },
        { ...input(wrap(schema)), stream: true } as unknown as ChatRequest,
        () => {},
      ),
    );
    assert.equal(secrets, 0);
    assert.equal(sends, 0);
  }
});

test('Gemini root refs keep strict tool and Anthropic rejection pre-secret for nonstream and Google stream', async () => {
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  let secrets = 0;
  let sends = 0;
  const stream = createDirectGoogleTextStreamInvoker({
    registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' }],
    resolveSecret: async () => {
      secrets++;
      return 'fixture-key';
    },
    fetcher: async () => {
      sends++;
      throw new Error('unexpected');
    },
  });
  const candidate = {
    id: 'candidate',
    kind: 'managed',
    providerId: 'provider',
    upstreamModelId: 'model',
  } as const;
  for (const kind of ['google', 'anthropic'] as const)
    for (const controls of [
      {},
      { tool_choice: 'none' },
      { tools: [] },
      { parallel_tool_calls: true },
    ]) {
      const base = googleRootRefFormat('object', true);
      const format =
        kind === 'google' && Object.keys(controls).length === 0
          ? { ...base, json_schema: { ...base.json_schema, strict: true } }
          : base;
      const f = adapter(kind);
      const req = { ...input(format), ...controls } as unknown as ChatRequest;
      await assert.rejects(() => f.call(req));
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
      if (kind === 'google')
        await assert.rejects(() =>
          stream(candidate, { ...req, stream: true } as unknown as ChatRequest, () => {}),
        );
    }
  for (const strict of [null, undefined]) {
    const format = googleRootRefFormat('object');
    const req = input({
      ...format,
      json_schema: { ...format.json_schema, strict },
    }) as unknown as ChatRequest;
    await assert.rejects(() =>
      stream(candidate, { ...req, stream: true } as unknown as ChatRequest, () => {}),
    );
  }
  assert.equal(secrets, 0);
  assert.equal(sends, 0);
});

function googleNullRootFormat(_type: string, withDefs = false) {
  const schema = {
    type: 'null',
    title: 'private null-root-schema title',
    description: 'private null-root-schema literal',
    ...(withDefs ? { $defs: { Answer: { type: 'null' } } } : {}),
  };
  return { type: 'json_schema', json_schema: { name: 'result', strict: false, schema } } as const;
}
function nullRootOutput(_type: string, _withDefs: boolean) {
  return 'null';
}
for (const withDefs of [false, true])
  for (const type of ['null']) {
    test(
      'Gemini null-root schemas forward exact immutable schemas on both bases' +
        ' ' +
        type +
        String(withDefs),
      async () => {
        for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
          const format = googleNullRootFormat(type, withDefs);
          const expected = structuredClone(format.json_schema.schema);
          const f = httpFixture('google', {
            output: nullRootOutput(type, withDefs),
            mutate: () => {
              format.json_schema.schema.description = 'mutated';
            },
          });
          const req = request(path, format);
          Object.defineProperty(req, 'json', { value: async () => input(format) });
          assert.equal((await f.handler(req)).status, 200);
          assert.deepEqual(
            (f.sent[0]?.generationConfig as Record<string, unknown> | undefined)
              ?.responseJsonSchema,
            expected,
          );
          assert.equal(f.secrets(), 1);
          assert.equal(f.usage.length, 1);
          assert.doesNotMatch(
            JSON.stringify([f.audits, f.usage]),
            /private null-root-schema|fixture-key/u,
          );
        }
      },
    );
    test(
      'Gemini null-root-schema schemas retain IAM limits and persistence failure boundaries' +
        ' ' +
        type +
        String(withDefs),
      async () => {
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
            const response = await f.handler(request(path, googleNullRootFormat(type, withDefs)));
            assert.equal(response.status, status);
            assert.equal(f.sent.length, dispatched ? 1 : 0);
            assert.equal(f.secrets(), dispatched ? 1 : 0);
            assert.doesNotMatch(await response.text(), /private|fixture-key/u);
          }
      },
    );
    test(
      'Gemini null-root-schema schemas work through actual OpenAI SDK sockets on both bases' +
        ' ' +
        type +
        String(withDefs),
      async () => {
        const f = httpFixture('google', { output: nullRootOutput(type, withDefs) });
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
              input(
                googleNullRootFormat(type, withDefs),
              ) as OpenAI.ChatCompletionCreateParamsNonStreaming,
            );
            assert.equal(result.choices[0]?.message.content, nullRootOutput(type, withDefs));
            const config = f.sent.at(-1)?.generationConfig as Record<string, unknown>;
            assert.deepEqual(
              config.responseJsonSchema,
              googleNullRootFormat(type, withDefs).json_schema.schema,
            );
          }
        } finally {
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        }
      },
    );

    test(
      'Gemini null-root-schema schemas use the same captured native text-stream transport' +
        ' ' +
        type +
        String(withDefs),
      async () => {
        const { createDirectGoogleTextStreamInvoker } = await import(
          '../src/providers/direct-google-stream.ts'
        );
        const sent: Record<string, unknown>[] = [];
        const format = googleNullRootFormat(type, withDefs);
        const expected = structuredClone(format.json_schema.schema);
        const invoke = createDirectGoogleTextStreamInvoker({
          registrations: [
            { providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' },
          ],
          resolveSecret: async () => {
            format.json_schema.schema.description = 'mutated';
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
                      content: {
                        role: 'model',
                        parts: [{ text: nullRootOutput(type, withDefs) }],
                      },
                      finishReason: 'STOP',
                    },
                  ],
                  usageMetadata: {
                    promptTokenCount: 2,
                    candidatesTokenCount: 1,
                    totalTokenCount: 3,
                  },
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
        assert.ok(
          JSON.stringify(seen).includes(
            JSON.stringify(nullRootOutput(type, withDefs)).slice(1, -1),
          ),
        );
        assert.deepEqual(
          (sent[0]?.generationConfig as Record<string, unknown> | undefined)?.responseJsonSchema,
          expected,
        );
      },
    );
  }

test('Gemini null roots retain expanded depth, shared budget and definition/name bounds', async () => {
  const { validateGoogleResponseSchema: validate } = await import(
    '../src/providers/google-response-schema.ts'
  );
  const wrap = (schema: Record<string, unknown>) =>
    ({ type: 'json_schema', json_schema: { name: 'result', strict: false, schema } }) as const;
  assert.doesNotThrow(() => validate(wrap({ type: 'null' })));
  for (const depth of [15, 16]) {
    const defs: Record<string, unknown> = { d0: { type: 'string' } };
    for (let i = 1; i <= depth; i++) defs[`d${i}`] = { $ref: `#/$defs/d${i - 1}` };
    const schema = { type: 'null', $defs: defs };
    if (depth === 15) assert.doesNotThrow(() => validate(wrap(schema)));
    else assert.throws(() => validate(wrap(schema)));
  }
  for (const levels of [3, 7]) {
    const defs: Record<string, unknown> = { d0: { type: 'string' } };
    for (let i = 1; i <= levels; i++)
      defs[`d${i}`] = { anyOf: Array.from({ length: 16 }, () => ({ $ref: `#/$defs/d${i - 1}` })) };
    const schema = { type: 'null', $defs: defs };
    if (levels === 3) assert.doesNotThrow(() => validate(wrap(schema)));
    else assert.throws(() => validate(wrap(schema)));
  }
  for (const count of [128, 129]) {
    const schema = {
      type: 'null',
      $defs: Object.fromEntries(
        Array.from({ length: count }, (_, i) => [`d${i}`, { type: 'string' }]),
      ),
    };
    if (count === 128) assert.doesNotThrow(() => validate(wrap(schema)));
    else assert.throws(() => validate(wrap(schema)));
  }
  for (const name of ['__proto__', 'constructor', 'toString', 'a'.repeat(64)])
    assert.doesNotThrow(() =>
      validate(wrap({ type: 'null', $defs: Object.fromEntries([[name, { type: 'string' }]]) })),
    );
});

test('Gemini null roots keep strict tool and Anthropic rejection pre-secret for nonstream and Google stream', async () => {
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  let secrets = 0;
  let sends = 0;
  const stream = createDirectGoogleTextStreamInvoker({
    registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' }],
    resolveSecret: async () => {
      secrets++;
      return 'fixture-key';
    },
    fetcher: async () => {
      sends++;
      throw new Error('unexpected');
    },
  });
  const candidate = {
    id: 'candidate',
    kind: 'managed',
    providerId: 'provider',
    upstreamModelId: 'model',
  } as const;
  for (const kind of ['google', 'anthropic'] as const)
    for (const controls of [
      {},
      { tool_choice: 'none' },
      { tools: [] },
      { parallel_tool_calls: true },
    ]) {
      const base = googleNullRootFormat('object', true);
      const format =
        kind === 'google' && Object.keys(controls).length === 0
          ? { ...base, json_schema: { ...base.json_schema, strict: true } }
          : base;
      const f = adapter(kind);
      const req = { ...input(format), ...controls } as unknown as ChatRequest;
      await assert.rejects(() => f.call(req));
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
      if (kind === 'google')
        await assert.rejects(() =>
          stream(candidate, { ...req, stream: true } as unknown as ChatRequest, () => {}),
        );
    }
  for (const strict of [null, undefined]) {
    const format = googleNullRootFormat('object');
    const req = input({
      ...format,
      json_schema: { ...format.json_schema, strict },
    }) as unknown as ChatRequest;
    await assert.rejects(() =>
      stream(candidate, { ...req, stream: true } as unknown as ChatRequest, () => {}),
    );
  }
  assert.equal(secrets, 0);
  assert.equal(sends, 0);
});

test('Gemini null roots reject malformed schemas and unsupported controls before credentials', async () => {
  const { validateGoogleResponseSchema: validate } = await import(
    '../src/providers/google-response-schema.ts'
  );
  const wrap = (schema: Record<string, unknown>) =>
    ({ type: 'json_schema', json_schema: { name: 'private', strict: false, schema } }) as const;
  const base = { type: 'null' };
  const invalidSchemas: Record<string, unknown>[] = [
    ...[
      'properties',
      'required',
      'additionalProperties',
      'items',
      'prefixItems',
      'format',
      'minimum',
      'maximum',
      'minItems',
      'maxItems',
      'enum',
      'propertyOrdering',
      'pattern',
      'const',
      '$id',
      '$anchor',
    ].map((key) => ({ ...base, [key]: 'private' })),
    ...[[], ['null'], ['null', 'null'], ['null', 1], ['null', 'null', 'string']].map((type) => ({
      type,
    })),
    { ...base, title: 1 },
    { ...base, description: null },
    { ...base, $defs: {} },
    { ...base, $defs: [] },
    { ...base, $defs: null },
    { ...base, $defs: { A: { type: 'string', pattern: 'private' } } },
    { ...base, $defs: { A: { $ref: '#/$defs/A' } } },
    { ...base, $defs: { A: { $ref: '#/$defs/Missing' } } },
    { ...base, $defs: { A: { $ref: 'https://example.invalid/private' } } },
    { ...base, $defs: { A: { type: 'null', $defs: { B: { type: 'string' } } } } },
    { ...base, $defs: { ['a'.repeat(65)]: { type: 'string' } } },
    { ...base, enum: [null] },
  ];
  for (const schema of invalidSchemas) {
    assert.throws(() => validate(wrap(schema)));
    for (const kind of ['google', 'anthropic'] as const) {
      const a = adapter(kind);
      await assert.rejects(a.call(input(wrap(schema)) as unknown as ChatRequest));
      assert.equal(a.secrets(), 0);
      assert.equal(a.sent.length, 0);
    }
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      const f = httpFixture('google');
      const response = await f.handler(request(path, wrap(schema)));
      assert.equal(response.status, 502);
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
      assert.equal(f.usage.length, 0);
      assert.doesNotMatch(
        JSON.stringify([await response.text(), f.audits]),
        /private|fixture-key/u,
      );
    }
  }
  for (const strict of [true, null, undefined]) {
    const format = { ...wrap(base), json_schema: { ...wrap(base).json_schema, strict } };
    for (const kind of ['google', 'anthropic'] as const) {
      const a = adapter(kind);
      await assert.rejects(a.call(input(format) as unknown as ChatRequest));
      assert.equal(a.secrets(), 0);
      assert.equal(a.sent.length, 0);
    }
  }
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  for (const schema of invalidSchemas) {
    let secrets = 0;
    let sends = 0;
    const invoke = createDirectGoogleTextStreamInvoker({
      registrations: [
        { providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' },
      ],
      resolveSecret: async () => {
        secrets++;
        return 'fixture-key';
      },
      fetcher: async () => {
        sends++;
        throw new Error('unexpected');
      },
    });
    await assert.rejects(
      invoke(
        { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'model' },
        { ...input(wrap(schema)), stream: true } as unknown as ChatRequest,
        () => {},
      ),
    );
    assert.equal(secrets, 0);
    assert.equal(sends, 0);
  }
});

test('Gemini null-root transport does not validate or force generated null output', async () => {
  for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
    const output = JSON.stringify({ label: 'not-null' });
    const f = httpFixture('google', { output });
    const response = await f.handler(request(path, googleNullRootFormat('null')));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { choices: { message: { content: string } }[] };
    assert.equal(body.choices[0]?.message.content, output);
    assert.equal(f.usage.length, 1);
  }
});

function googleAnchorFormat(_type: string, chained = false) {
  const schema = {
    $ref: chained ? '#/$defs/Wrapper' : '#Answer',
    $defs: {
      Payload: {
        $anchor: 'Answer',
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
      },
      ...(chained ? { Wrapper: { $ref: '#Answer' } } : {}),
    },
  };
  return { type: 'json_schema', json_schema: { name: 'result', strict: false, schema } } as const;
}
function anchorOutput(_type: string, _chained: boolean) {
  return '{"ok":true}';
}
for (const withDefs of [false, true])
  for (const type of ['object']) {
    test(
      'Gemini definition-anchor schemas forward exact immutable schemas on both bases' +
        ' ' +
        type +
        String(withDefs),
      async () => {
        for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
          const format = googleAnchorFormat(type, withDefs);
          const expected = structuredClone(format.json_schema.schema);
          const f = httpFixture('google', {
            output: anchorOutput(type, withDefs),
            mutate: () => {
              format.json_schema.schema.$defs.Payload.$anchor = 'mutated';
            },
          });
          const req = request(path, format);
          Object.defineProperty(req, 'json', { value: async () => input(format) });
          assert.equal((await f.handler(req)).status, 200);
          assert.deepEqual(
            (f.sent[0]?.generationConfig as Record<string, unknown> | undefined)
              ?.responseJsonSchema,
            expected,
          );
          assert.equal(f.secrets(), 1);
          assert.equal(f.usage.length, 1);
          assert.doesNotMatch(
            JSON.stringify([f.audits, f.usage]),
            /private definition-anchor-schema|fixture-key/u,
          );
        }
      },
    );
    test(
      'Gemini definition-anchor-schema schemas retain IAM limits and persistence failure boundaries' +
        ' ' +
        type +
        String(withDefs),
      async () => {
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
            const response = await f.handler(request(path, googleAnchorFormat(type, withDefs)));
            assert.equal(response.status, status);
            assert.equal(f.sent.length, dispatched ? 1 : 0);
            assert.equal(f.secrets(), dispatched ? 1 : 0);
            assert.doesNotMatch(await response.text(), /private|fixture-key/u);
          }
      },
    );
    test(
      'Gemini definition-anchor-schema schemas work through actual OpenAI SDK sockets on both bases' +
        ' ' +
        type +
        String(withDefs),
      async () => {
        const f = httpFixture('google', { output: anchorOutput(type, withDefs) });
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
              input(
                googleAnchorFormat(type, withDefs),
              ) as OpenAI.ChatCompletionCreateParamsNonStreaming,
            );
            assert.equal(result.choices[0]?.message.content, anchorOutput(type, withDefs));
            const config = f.sent.at(-1)?.generationConfig as Record<string, unknown>;
            assert.deepEqual(
              config.responseJsonSchema,
              googleAnchorFormat(type, withDefs).json_schema.schema,
            );
          }
        } finally {
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        }
      },
    );

    test(
      'Gemini definition-anchor-schema schemas use the same captured native text-stream transport' +
        ' ' +
        type +
        String(withDefs),
      async () => {
        const { createDirectGoogleTextStreamInvoker } = await import(
          '../src/providers/direct-google-stream.ts'
        );
        const sent: Record<string, unknown>[] = [];
        const format = googleAnchorFormat(type, withDefs);
        const expected = structuredClone(format.json_schema.schema);
        const invoke = createDirectGoogleTextStreamInvoker({
          registrations: [
            { providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' },
          ],
          resolveSecret: async () => {
            format.json_schema.schema.$defs.Payload.$anchor = 'mutated';
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
                      content: {
                        role: 'model',
                        parts: [{ text: anchorOutput(type, withDefs) }],
                      },
                      finishReason: 'STOP',
                    },
                  ],
                  usageMetadata: {
                    promptTokenCount: 2,
                    candidatesTokenCount: 1,
                    totalTokenCount: 3,
                  },
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
        assert.ok(
          JSON.stringify(seen).includes(JSON.stringify(anchorOutput(type, withDefs)).slice(1, -1)),
        );
        assert.deepEqual(
          (sent[0]?.generationConfig as Record<string, unknown> | undefined)?.responseJsonSchema,
          expected,
        );
      },
    );
  }
test('Gemini definition anchors keep strict tool and Anthropic rejection pre-secret for nonstream and Google stream', async () => {
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  let secrets = 0;
  let sends = 0;
  const stream = createDirectGoogleTextStreamInvoker({
    registrations: [{ providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' }],
    resolveSecret: async () => {
      secrets++;
      return 'fixture-key';
    },
    fetcher: async () => {
      sends++;
      throw new Error('unexpected');
    },
  });
  const candidate = {
    id: 'candidate',
    kind: 'managed',
    providerId: 'provider',
    upstreamModelId: 'model',
  } as const;
  for (const kind of ['google', 'anthropic'] as const)
    for (const controls of [
      {},
      { tool_choice: 'none' },
      { tools: [] },
      { parallel_tool_calls: true },
    ]) {
      const base = googleAnchorFormat('object', true);
      const format =
        kind === 'google' && Object.keys(controls).length === 0
          ? { ...base, json_schema: { ...base.json_schema, strict: true } }
          : base;
      const f = adapter(kind);
      const req = { ...input(format), ...controls } as unknown as ChatRequest;
      await assert.rejects(() => f.call(req));
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
      if (kind === 'google')
        await assert.rejects(() =>
          stream(candidate, { ...req, stream: true } as unknown as ChatRequest, () => {}),
        );
    }
  for (const strict of [null, undefined]) {
    const format = googleAnchorFormat('object');
    const req = input({
      ...format,
      json_schema: { ...format.json_schema, strict },
    }) as unknown as ChatRequest;
    await assert.rejects(() =>
      stream(candidate, { ...req, stream: true } as unknown as ChatRequest, () => {}),
    );
  }
  assert.equal(secrets, 0);
  assert.equal(sends, 0);
});

test('Gemini definition anchors reject malformed schemas and unsupported controls before credentials', async () => {
  const { validateGoogleResponseSchema: validate } = await import(
    '../src/providers/google-response-schema.ts'
  );
  const wrap = (schema: Record<string, unknown>) =>
    ({ type: 'json_schema', json_schema: { name: 'private', strict: false, schema } }) as const;
  const base = googleAnchorFormat('object').json_schema.schema;
  const invalidSchemas: Record<string, unknown>[] = [
    { $ref: '#Missing', $defs: base.$defs },
    ...['', 'a'.repeat(65), '1bad', 'a/b', 'a~b', 'a b', 'é', null, 1, [], {}].map(($anchor) => ({
      type: 'null',
      $defs: { A: { type: 'string', $anchor } },
    })),
    ...['#', '#%41nswer', '#Answer/child', 'https://example.invalid/#Answer'].map(($ref) => ({
      ...base,
      $ref,
    })),
    { ...base, $anchor: 'Root' },
    { ...base, $id: 'https://example.invalid/private' },
    {
      type: 'null',
      $defs: { A: { type: 'string', $anchor: 'Same' }, B: { type: 'null', $anchor: 'Same' } },
    },
    { type: 'null', $defs: { A: { $anchor: 'A', $ref: '#/$defs/B' }, B: { type: 'null' } } },
    {
      type: 'null',
      $defs: {
        A: {
          $anchor: 'A',
          type: 'object',
          properties: { child: { $anchor: 'Nested', type: 'string' } },
        },
      },
    },
    {
      type: 'null',
      $defs: { A: { $anchor: 'A', type: 'object', properties: { self: { $ref: '#A' } } } },
    },
    {
      type: 'null',
      $defs: { A: { $anchor: 'A', anyOf: [{ $ref: '#/$defs/B' }] }, B: { $ref: '#A' } },
    },
    { type: 'null', $defs: { A: { $anchor: 'A', type: 'string', pattern: 'private' } } },
    {
      type: 'null',
      $defs: { A: { $anchor: 'A', type: 'null', $defs: { B: { type: 'string' } } } },
    },
  ];
  for (const schema of invalidSchemas) {
    assert.throws(() => validate(wrap(schema)));
    for (const kind of ['google', 'anthropic'] as const) {
      const a = adapter(kind);
      await assert.rejects(a.call(input(wrap(schema)) as unknown as ChatRequest));
      assert.equal(a.secrets(), 0);
      assert.equal(a.sent.length, 0);
    }
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      const f = httpFixture('google');
      const response = await f.handler(request(path, wrap(schema)));
      assert.equal(response.status, 502);
      assert.equal(f.secrets(), 0);
      assert.equal(f.sent.length, 0);
      assert.equal(f.usage.length, 0);
      assert.doesNotMatch(
        JSON.stringify([await response.text(), f.audits]),
        /private|fixture-key/u,
      );
    }
  }
  for (const strict of [true, null, undefined]) {
    const format = { ...wrap(base), json_schema: { ...wrap(base).json_schema, strict } };
    for (const kind of ['google', 'anthropic'] as const) {
      const a = adapter(kind);
      await assert.rejects(a.call(input(format) as unknown as ChatRequest));
      assert.equal(a.secrets(), 0);
      assert.equal(a.sent.length, 0);
    }
  }
  const { createDirectGoogleTextStreamInvoker } = await import(
    '../src/providers/direct-google-stream.ts'
  );
  for (const schema of invalidSchemas) {
    let secrets = 0;
    let sends = 0;
    const invoke = createDirectGoogleTextStreamInvoker({
      registrations: [
        { providerId: 'provider', kind: 'google', credentialRef: 'secret/reference' },
      ],
      resolveSecret: async () => {
        secrets++;
        return 'fixture-key';
      },
      fetcher: async () => {
        sends++;
        throw new Error('unexpected');
      },
    });
    await assert.rejects(
      invoke(
        { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'model' },
        { ...input(wrap(schema)), stream: true } as unknown as ChatRequest,
        () => {},
      ),
    );
    assert.equal(secrets, 0);
    assert.equal(sends, 0);
  }
});

test('Gemini definition anchors retain canonical cycles, depth, visits and own-name bounds', async () => {
  const { validateGoogleResponseSchema: validate } = await import(
    '../src/providers/google-response-schema.ts'
  );
  const wrap = (schema: Record<string, unknown>) =>
    ({ type: 'json_schema', json_schema: { name: 'result', strict: false, schema } }) as const;
  for (const name of ['__proto__', 'constructor', 'toString', 'a'.repeat(64)]) {
    assert.doesNotThrow(() =>
      validate(wrap({ $ref: '#' + name, $defs: { Payload: { $anchor: name, type: 'string' } } })),
    );
  }
  for (const type of ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']) {
    const target = {
      $anchor: 'A',
      type,
      ...(type === 'array' ? { items: { type: 'string' } } : {}),
    };
    assert.doesNotThrow(() => validate(wrap({ $ref: '#A', $defs: { Target: target } })));
  }
  for (const target of [
    { type: ['string', 'null'] },
    { anyOf: [{ type: 'null' }] },
    { oneOf: [{ type: 'boolean' }] },
  ])
    assert.doesNotThrow(() =>
      validate(wrap({ $ref: '#A', $defs: { Target: { $anchor: 'A', ...target } } })),
    );
  for (const levels of [7, 8]) {
    const defs: Record<string, unknown> = { d0: { $anchor: 'a0', type: 'string' } };
    for (let i = 1; i <= levels; i++)
      defs['d' + i] = { $anchor: 'a' + i, anyOf: [{ $ref: '#a' + (i - 1) }] };
    const schema = { $ref: '#a' + levels, $defs: defs };
    if (levels === 7) {
      assert.doesNotThrow(() => validate(wrap(schema)));
      const nested = { type: 'object', properties: { value: { $ref: '#a7' } } };
      assert.doesNotThrow(() => validate(wrap({ ...nested, $defs: defs })));
      assert.throws(() => validate(wrap({ type: 'array', items: nested, $defs: defs })));
    } else assert.throws(() => validate(wrap(schema)));
  }
  for (const levels of [3, 4]) {
    const defs: Record<string, unknown> = { d0: { $anchor: 'a0', type: 'string' } };
    for (let i = 1; i <= levels; i++)
      defs['d' + i] = {
        $anchor: 'a' + i,
        anyOf: Array.from({ length: 16 }, () => ({ $ref: '#a' + (i - 1) })),
      };
    const schema = { type: 'null', $defs: defs };
    if (levels === 3) assert.doesNotThrow(() => validate(wrap(schema)));
    else assert.throws(() => validate(wrap(schema)));
  }
  for (const count of [128, 129]) {
    const defs = Object.fromEntries(
      Array.from({ length: count }, (_, i) => ['d' + i, { $anchor: 'a' + i, type: 'string' }]),
    );
    if (count === 128) assert.doesNotThrow(() => validate(wrap({ $ref: '#a127', $defs: defs })));
    else assert.throws(() => validate(wrap({ type: 'null', $defs: defs })));
  }
  assert.throws(() =>
    validate(
      wrap({
        type: 'null',
        $defs: {
          A: { $anchor: 'Alias', type: 'object', properties: { self: { $ref: '#/$defs/A' } } },
        },
      }),
    ),
  );
  // Definition names and anchor names are distinct namespaces.
  assert.doesNotThrow(() =>
    validate(
      wrap({
        $ref: '#A',
        $defs: { A: { $anchor: 'B', type: 'string' }, B: { $anchor: 'A', type: 'null' } },
      }),
    ),
  );
});
