import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { type ChatRequest, createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import {
  createDirectChatInvoker,
  createDirectChatTransport,
} from '../src/providers/direct-chat.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

const candidate = {
  id: 'one',
  kind: 'managed' as const,
  providerId: 'google',
  upstreamModelId: 'gemini-exact',
};
const registrations = [
  {
    providerId: 'google',
    kind: 'google' as const,
    credentialRef: 'secret/google',
    maxOutputTokens: 64,
  },
];
const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'lookup',
      description: 'private schema',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
      strict: false,
    },
  },
];
const calls = [
  {
    id: 'call_a',
    type: 'function' as const,
    function: { name: 'lookup', arguments: '{"query":"private input"}' },
  },
  { id: 'call_b', type: 'function' as const, function: { name: 'lookup', arguments: '{}' } },
];
const history = [
  { role: 'user', content: 'private prompt' },
  { role: 'assistant', content: 'private answer', tool_calls: calls },
  { role: 'tool', tool_call_id: 'call_b', content: 'private result b' },
  { role: 'tool', tool_call_id: 'call_a', content: 'private result a' },
];
const nativeParts = [
  { text: 'private answer' },
  ...calls.map((c) => ({
    functionCall: {
      id: c.id,
      name: c.function.name,
      args: JSON.parse(c.function.arguments) as unknown,
    },
  })),
];
function body(
  parts: readonly object[] = nativeParts,
  finishReason = 'STOP',
  usage: unknown = { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 7 },
) {
  return {
    responseId: 'native',
    modelVersion: 'gemini-exact',
    candidates: [{ index: 0, content: { role: 'model', parts }, finishReason }],
    usageMetadata: usage,
  };
}
const signature = 'private-signature+/==';
const signedParts = nativeParts.map((part, index) =>
  index === 1 ? { ...part, thoughtSignature: signature } : part,
);
const toolBody = body(signedParts),
  textBody = body([{ text: 'done' }]);
const nativeHistory = [
  { role: 'user', parts: [{ text: 'private prompt' }] },
  { role: 'model', parts: nativeParts },
  {
    role: 'user',
    parts: [
      {
        functionResponse: {
          id: 'call_a',
          name: 'lookup',
          response: { output: 'private result a' },
        },
      },
      {
        functionResponse: {
          id: 'call_b',
          name: 'lookup',
          response: { output: 'private result b' },
        },
      },
    ],
  },
];

function fixture(
  options: {
    body?: unknown;
    mutate?: () => void;
    deny?: boolean;
    limit?: boolean;
    usageFail?: boolean;
    auditFail?: boolean;
    upstreamFail?: boolean;
    signatureRequired?: boolean;
  } = {},
) {
  let keys = 0;
  const sent: Record<string, unknown>[] = [],
    usage: UsageRecord[] = [],
    audits: unknown[] = [];
  const ports = {
    registrations,
    resolveSecret: async () => {
      keys++;
      options.mutate?.();
      return 'fixture-provider-key';
    },
    fetcher: (async (url, init) => {
      assert.equal(
        String(url),
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-exact:generateContent',
      );
      assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'fixture-provider-key');
      assert.equal(init?.redirect, 'error');
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const captured = sent.at(-1) as {
        contents?: {
          parts: { functionCall?: object; thoughtSignature?: string; functionResponse?: object }[];
        }[];
      };
      if (
        options.signatureRequired &&
        captured.contents?.some((m) => m.parts.some((p) => p.functionResponse))
      ) {
        const parts = captured.contents.find((m) => m.parts.some((p) => p.functionCall))?.parts;
        if (parts?.find((p) => p.functionCall)?.thoughtSignature !== signature)
          return new Response('private missing signature', { status: 400 });
      }
      return options.upstreamFail
        ? new Response('private upstream fixture-provider-key', { status: 400 })
        : Response.json(options.body ?? (sent.length === 1 ? toolBody : textBody));
    }) as typeof fetch,
  };
  const invoke = createDirectChatInvoker(ports);
  const handler = createChatHandler({
    newRequestId: () => 'request',
    authenticate: async () => ({
      id: 'user',
      active: true,
      credentialId: 'credential',
      policyVersions: [],
      statements: [
        { effect: 'Allow', actions: ['llm:*'], resources: ['*'] },
        ...(options.deny
          ? [
              {
                effect: 'Deny' as const,
                actions: ['llm:UseProvider'],
                resources: ['provider:google'],
              },
            ]
          : []),
      ],
    }),
    resolveRoute: async () => ({ kind: 'managed', version: 'v1', candidates: [candidate] }),
    checkLimit: async () => !options.limit,
    resolveSecret: async () => {
      assert.fail('unexpected delegated credential');
    },
    invokeDirect: invoke,
    writeUsage: async (record) => {
      if (options.usageFail) throw new Error('private usage');
      usage.push(record);
    },
    writeAudit: async (event) => {
      if (options.auditFail) throw new Error('private audit');
      audits.push(event);
    },
  });
  return { ports, invoke, handler, keys: () => keys, sent, usage, audits };
}
function input(fields: Record<string, unknown> = {}) {
  return {
    model: 'chat',
    messages: [{ role: 'user', content: 'private prompt' }],
    tools,
    max_tokens: 100,
    ...fields,
  };
}
function request(base: string, fields: Record<string, unknown> = {}) {
  return new Request(`http://gateway${base}/chat/completions`, {
    method: 'POST',
    headers: { authorization: 'Bearer proxy', 'content-type': 'application/json' },
    body: JSON.stringify(input(fields)),
  });
}

const signedCalls = calls.map((call, index) =>
  index === 0 ? { ...call, extra_content: { google: { thought_signature: signature } } } : call,
);
const signedHistory = [
  history[0],
  { role: 'assistant', content: 'private answer', tool_calls: signedCalls },
  history[2],
  history[3],
];
function privacy(f: ReturnType<typeof fixture>) {
  assert.doesNotMatch(
    JSON.stringify([f.usage, f.audits]),
    /private|signature|fixture-provider-key|call_a|call_b/u,
  );
}
for (const base of ['/v1', '/api/v1']) {
  test(`Gemini ${base} returns exact signature on its function call and replays it on that native part`, async () => {
    const f = fixture({ signatureRequired: true });
    const first = await f.handler(request(base));
    assert.equal(first.status, 200);
    const result = (await first.json()) as { choices: { message: { tool_calls: unknown[] } }[] };
    assert.deepEqual(result.choices[0]?.message.tool_calls, signedCalls);
    const second = await f.handler(request(base, { messages: signedHistory }));
    assert.equal(second.status, 200);
    const contents = f.sent[1]?.contents as { parts: unknown[] }[];
    assert.deepEqual(contents[1]?.parts, signedParts);
    assert.deepEqual(contents[2]?.parts, (nativeHistory[2] as { parts: unknown[] }).parts);
    assert.equal(f.keys(), 2);
    privacy(f);
  });
  for (const [options, status] of [
    [{ deny: true }, 403],
    [{ limit: true }, 429],
    [{ auditFail: true }, 503],
    [{ usageFail: true }, 503],
    [{ upstreamFail: true }, 502],
  ] as const)
    test(`Gemini signatures ${base} preserve ${JSON.stringify(options)} safety gates`, async () => {
      const f = fixture(options),
        response = await f.handler(request(base, { messages: signedHistory }));
      assert.equal(response.status, status);
      if (options.deny || options.limit || options.auditFail) assert.equal(f.keys(), 0);
      assert.doesNotMatch(await response.text(), /private|signature|fixture-provider-key/u);
      privacy(f);
    });
}
test('Gemini captures nested signature metadata before credentials', async () => {
  const messages = structuredClone(signedHistory),
    first = messages[1] as { tool_calls: typeof signedCalls };
  const call = first.tool_calls[0];
  assert.ok(call && 'extra_content' in call);
  const extra = call.extra_content as { google: { thought_signature: string } };
  const f = fixture({
    body: textBody,
    mutate: () => {
      extra.google.thought_signature = 'private changed';
    },
  });
  await f.invoke(candidate, input({ messages }) as ChatRequest);
  const contents = f.sent[0]?.contents as { parts: { thoughtSignature?: string }[] }[];
  assert.equal(contents[1]?.parts[1]?.thoughtSignature, signature);
});
for (const extra_content of [
  null,
  {},
  [],
  { google: null },
  { google: {} },
  { google: { thought_signature: null } },
  { google: { thought_signature: 1 } },
  { google: { thought_signature: '' } },
  { google: { thought_signature: signature, other: true } },
  { google: { thought_signature: signature }, other: true },
  { google: { thought_signature: 'x'.repeat(1048577) } },
])
  test('malformed signature request metadata rejects before keys without content exposure', async () => {
    const f = fixture(),
      messages = [
        history[0],
        { role: 'assistant', content: null, tool_calls: [{ ...calls[0], extra_content }] },
        { role: 'tool', tool_call_id: 'call_a', content: 'private result' },
      ];
    const response = await f.handler(request('/v1', { messages }));
    assert.equal(response.status, 400);
    assert.equal(f.keys(), 0);
    assert.doesNotMatch(await response.text(), /private|signature/u);
  });
for (const thoughtSignature of [null, 1, '', 'x'.repeat(1048577)])
  test('malformed or oversized native signature fails safely possibly billed', async () => {
    const f = fixture({
      body: body([{ functionCall: { id: 'call', name: 'lookup', args: {} }, thoughtSignature }]),
    });
    const response = await f.handler(request('/v1'));
    assert.equal(response.status, 502);
    assert.equal(f.usage[0]?.possiblyBilled, true);
    privacy(f);
  });
test('Gemini rejects signatures on flattened text without inventing native association', async () => {
  const f = fixture({ body: body([{ text: 'private text', thoughtSignature: signature }]) });
  assert.equal((await f.handler(request('/v1'))).status, 502);
  privacy(f);
});
test('Gemini missing-ID signed function retains signature on replay without inventing native ID', async () => {
  const f = fixture({
    body: body([{ functionCall: { name: 'lookup' }, thoughtSignature: signature }]),
  });
  const completion = await f.invoke(candidate, input() as ChatRequest);
  const returned = completion.choices[0]?.message.tool_calls;
  assert.ok(returned?.[0]);
  await f.invoke(
    candidate,
    input({
      messages: [
        history[0],
        { role: 'assistant', content: null, tool_calls: returned },
        { role: 'tool', tool_call_id: returned[0].id, content: 'private result' },
      ],
    }) as ChatRequest,
  );
  const contents = f.sent[1]?.contents as { parts: unknown[] }[];
  assert.deepEqual(contents[1]?.parts, [
    { functionCall: { name: 'lookup', args: {} }, thoughtSignature: signature },
  ]);
});
test('Gemini preserves separate signed sequential tool steps', async () => {
  const next = {
    ...calls[0],
    id: 'call_c',
    extra_content: { google: { thought_signature: 'private-next-signature' } },
  };
  const f = fixture({ body: textBody });
  await f.invoke(
    candidate,
    input({
      messages: [
        ...signedHistory,
        { role: 'assistant', content: null, tool_calls: [next] },
        { role: 'tool', tool_call_id: 'call_c', content: 'private result c' },
      ],
    }) as ChatRequest,
  );
  const contents = f.sent[0]?.contents as { parts: { thoughtSignature?: string }[] }[];
  assert.equal(contents[1]?.parts[1]?.thoughtSignature, signature);
  assert.equal(contents[3]?.parts[0]?.thoughtSignature, 'private-next-signature');
});
for (const kind of ['openai', 'anthropic'] as const)
  test(`${kind} rejects Gemini signature history before native credentials`, async () => {
    let keys = 0;
    const invoke = createDirectChatInvoker({
      registrations: [{ ...registrations[0]!, kind }],
      resolveSecret: async () => {
        keys++;
        return 'fixture-key';
      },
      fetcher: async () => assert.fail('unexpected upstream'),
    });
    await assert.rejects(invoke(candidate, input({ messages: signedHistory }) as ChatRequest));
    assert.equal(keys, 0);
  });
for (const mode of ['google-text', 'function'] as const)
  test(`${mode} rejects signed history before native credentials`, async () => {
    const f = fixture();
    await assert.rejects(
      createDirectChatTransport(f.ports)(
        candidate,
        input({ messages: signedHistory }) as ChatRequest,
        mode,
      ),
    );
    assert.equal(f.keys(), 0);
  });
test('delegated nonstream and stream reject native Google signatures before keys', async () => {
  const { createOpenRouterChatInvoker } = await import('../src/providers/openrouter-chat.ts');
  const { createOpenRouterFunctionStreamInvoker } = await import(
    '../src/providers/openrouter-function-stream.ts'
  );
  let keys = 0;
  const ports = {
    credentialRef: 'ref',
    resolveSecret: async () => {
      keys++;
      return 'fixture';
    },
    fetcher: async () => assert.fail('unexpected upstream'),
  };
  const attempt = { upstreamModelId: 'google/model', authorizedProviderSlugs: ['Google'] };
  await assert.rejects(
    createOpenRouterChatInvoker(ports)(attempt, input({ messages: signedHistory }) as ChatRequest),
  );
  await assert.rejects(
    createOpenRouterFunctionStreamInvoker(ports)(
      attempt,
      input({ messages: signedHistory }) as ChatRequest,
      () => {},
    ),
  );
  assert.equal(keys, 0);
});
for (const base of ['/v1', '/api/v1'])
  for (const sdkKind of ['openai', 'openrouter'] as const)
    test(`${sdkKind} ${base} measures exact signed continuation support or SDK stripping`, async () => {
      const options = { deny: false, signatureRequired: true };
      const f = fixture(options),
        server = createNodeRequestServer(f.handler);
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const url = `http://127.0.0.1:${address.port}${base}`;
      try {
        if (sdkKind === 'openai') {
          const sdk = new OpenAI({ baseURL: url, apiKey: 'fixture-proxy', maxRetries: 0 });
          const first = await sdk.chat.completions.create(
            input() as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
          );
          const message = first.choices[0]?.message;
          assert.ok(message);
          assert.deepEqual(message.tool_calls, signedCalls);
          const next = await sdk.chat.completions.create(
            input({
              messages: [history[0], message, history[2], history[3]],
            }) as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
          );
          assert.equal(next.choices[0]?.message.content, 'done');
          assert.equal(f.keys(), 2);
          options.deny = true;
          await assert.rejects(
            sdk.chat.completions.create(
              input({
                messages: [history[0], message, history[2], history[3]],
              }) as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
            ),
            (e) => e instanceof OpenAI.APIError && e.status === 403,
          );
          assert.equal(f.keys(), 2);
        } else {
          const sdk = new OpenRouter({
            serverURL: url,
            apiKey: 'fixture-proxy',
            retryConfig: { strategy: 'none' },
          });
          const first = await sdk.chat.send({
            chatRequest: {
              model: 'chat',
              messages: [{ role: 'user', content: 'private prompt' }],
              tools,
            },
          });
          assert.ok('choices' in first);
          const returned = first.choices[0]?.message.toolCalls;
          assert.ok(returned?.[0]);
          assert.equal(Object.hasOwn(returned[0], 'extra_content'), false);
          await assert.rejects(
            sdk.chat.send({
              chatRequest: {
                model: 'chat',
                messages: [
                  { role: 'user', content: 'private prompt' },
                  { role: 'assistant', content: null, toolCalls: returned },
                  ...returned.map((c) => ({
                    role: 'tool' as const,
                    content: 'private result',
                    toolCallId: c.id,
                  })),
                ],
                tools,
              },
            }),
          );
          assert.equal(f.keys(), 2);
          assert.equal(f.usage[1]?.outcome, 'failed');
        }
        privacy(f);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
      }
    });
test('Gemini bounds aggregate signature units before credentials across a parallel history group', async () => {
  const group = calls.map((call) => ({
    ...call,
    extra_content: { google: { thought_signature: 'x'.repeat(600000) } },
  }));
  const f = fixture();
  await assert.rejects(
    f.invoke(
      candidate,
      input({
        messages: [
          history[0],
          { role: 'assistant', content: null, tool_calls: group },
          history[2],
          history[3],
        ],
      }) as ChatRequest,
    ),
  );
  assert.equal(f.keys(), 0);
});
test('Gemini bounds aggregate native signature units safely possibly billed', async () => {
  const parts = calls.map((call) => ({
    functionCall: { id: call.id, name: 'lookup', args: {} },
    thoughtSignature: 'x'.repeat(600000),
  }));
  const f = fixture({ body: body(parts) });
  assert.equal((await f.handler(request('/v1'))).status, 502);
  assert.equal(f.usage[0]?.possiblyBilled, true);
  privacy(f);
});
for (const kind of ['openai', 'delegated'] as const)
  test(`${kind} unsupported signature response fails safely without silently stripping it`, async () => {
    const native = {
      id: 'completion',
      created: 1,
      model: 'google/model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: null, tool_calls: signedCalls },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    };
    const ports = {
      resolveSecret: async () => 'fixture-key',
      fetcher: async () => Response.json(native),
    };
    let operation: Promise<unknown>;
    if (kind === 'openai')
      operation = createDirectChatInvoker({
        ...ports,
        registrations: [{ providerId: 'google', kind: 'openai', credentialRef: 'ref' }],
      })(candidate, input() as ChatRequest);
    else {
      const { createOpenRouterChatInvoker } = await import('../src/providers/openrouter-chat.ts');
      operation = createOpenRouterChatInvoker({ ...ports, credentialRef: 'ref' })(
        { upstreamModelId: 'google/model', authorizedProviderSlugs: ['Google'] },
        input() as ChatRequest,
      );
    }
    await assert.rejects(
      operation,
      (e) =>
        e instanceof Error &&
        'possiblyBilled' in e &&
        e.possiblyBilled === true &&
        'responseStarted' in e &&
        e.responseStarted === true &&
        !e.message.includes(signature),
    );
  });
