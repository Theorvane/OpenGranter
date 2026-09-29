import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type ChatRequest, createChatHandler } from '../src/gateway/chat-handler.ts';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import { createOpenRouterChatInvoker } from '../src/providers/openrouter-chat.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

const kinds = ['openai', 'google', 'openrouter'] as const;
type Kind = (typeof kinds)[number] | 'anthropic';
const request: ChatRequest = {
  model: 'chat',
  messages: [{ role: 'user', content: 'private prompt fixture' }],
};
function nativeBody(kind: Kind, collection?: unknown) {
  if (kind === 'anthropic')
    return {
      id: 'reply',
      content: [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 2, output_tokens: 1 },
    };
  if (kind === 'google')
    return {
      candidates: collection,
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
    };
  return {
    id: 'reply',
    created: 1,
    model: 'model',
    choices: collection,
    usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
  };
}
function choice(kind: Kind, index: unknown = 0) {
  return kind === 'google'
    ? {
        ...(index === undefined ? {} : { index }),
        content: { parts: [{ text: 'private reply fixture' }] },
        finishReason: 'STOP',
      }
    : {
        index,
        message: { role: 'assistant', content: 'private reply fixture' },
        finish_reason: 'stop',
      };
}
function fixture(
  kind: Kind,
  collection: unknown,
  options: { deny?: boolean; limited?: boolean; auditFails?: boolean } = {},
) {
  let calls = 0;
  const events: unknown[] = [];
  const records: UsageRecord[] = [];
  const candidate = {
    id: 'candidate',
    kind: kind === 'openrouter' ? ('delegated' as const) : ('managed' as const),
    providerId: 'provider',
    upstreamModelId: 'model',
  };
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json(nativeBody(kind, collection));
  };
  const invoke =
    kind === 'openrouter'
      ? createOpenRouterChatInvoker({
          credentialRef: 'reference',
          resolveSecret: async () => 'fixture-key',
          fetcher,
        })
      : createDirectChatInvoker({
          registrations: [
            { providerId: 'provider', kind, credentialRef: 'reference', maxOutputTokens: 32 },
          ],
          resolveSecret: async () => 'fixture-key',
          fetcher,
        });
  const call = () =>
    kind === 'openrouter'
      ? (invoke as ReturnType<typeof createOpenRouterChatInvoker>)(
          { upstreamModelId: 'model', authorizedProviderSlugs: ['provider'] },
          request,
        )
      : (invoke as ReturnType<typeof createDirectChatInvoker>)(candidate, request);
  const handler = createChatHandler({
    newRequestId: () => 'request',
    authenticate: async () => ({
      id: 'user',
      active: true,
      credentialId: 'credential',
      policyVersions: [],
      statements: options.deny ? [] : [{ effect: 'Allow', actions: ['*'], resources: ['*'] }],
    }),
    resolveRoute: async () =>
      kind === 'openrouter'
        ? { kind: 'delegated', version: 'v1', credentialRef: 'reference', candidates: [candidate] }
        : { version: 'v1', candidates: [candidate] },
    checkLimit: async () => !options.limited,
    resolveSecret: async () => 'fixture-key',
    resolveVerifiedProviderSlug: async () => 'provider',
    invokeDirect: async () => call(),
    invokeOpenRouter: async () => call(),
    writeAudit: async (event) => {
      if (options.auditFails) throw new Error('private fixture error');
      events.push(event);
    },
    writeUsage: async (record) => {
      records.push(record);
    },
  });
  return { call, handler, records, events, calls: () => calls };
}
for (const kind of kinds) {
  test(`${kind} retains the valid native singleton and optional Gemini index`, async () => {
    for (const item of kind === 'google'
      ? [
          choice(kind),
          { content: { parts: [{ text: 'private reply fixture' }] }, finishReason: 'STOP' },
        ]
      : [choice(kind)]) {
      const completion = await fixture(kind, [item]).call();
      assert.equal(completion.choices.length, 1);
      assert.equal(completion.choices[0]?.index, 0);
      assert.equal(completion.choices[0]?.message.content, 'private reply fixture');
      assert.equal(completion.usage?.total_tokens, 3);
    }
  });
  test(`${kind} rejects alternative truncation and invalid native indices after a response`, async () => {
    const sparse = new Array(2);
    sparse[0] = choice(kind);
    const collections = [
      [choice(kind), choice(kind, 1)],
      [choice(kind), null],
      sparse,
      [],
      {},
      [null],
      ...[1, -1, '0', null].map((index) => [choice(kind, index)]),
      ...(kind === 'google'
        ? []
        : [{ choices: 1 }, [{ message: { role: 'assistant', content: 'private reply fixture' } }]]),
    ];
    for (const collection of collections) {
      const f = fixture(kind, collection);
      await assert.rejects(f.call(), (error: unknown) => {
        const failure = error as {
          possiblyBilled: boolean;
          responseStarted: boolean;
          message: string;
        };
        assert.equal(failure.possiblyBilled, true);
        assert.equal(failure.responseStarted, true);
        assert.doesNotMatch(failure.message, /private reply fixture|fixture-key/u);
        return true;
      });
      assert.equal(f.calls(), 1);
    }
  });
}
test('Anthropic multiple text blocks remain one successful choice', async () => {
  const completion = await fixture('anthropic', undefined).call();
  assert.equal(completion.choices.length, 1);
  assert.equal(completion.choices[0]?.message.content, 'firstsecond');
  assert.equal(completion.usage?.total_tokens, 3);
});
test('both HTTP paths audit and account possibly billed invalid multiplicity without leaking content', async () => {
  for (const kind of kinds) {
    for (const path of ['/v1/chat/completions', '/api/v1/chat/completions']) {
      const f = fixture(kind, [choice(kind), choice(kind, 1)]);
      const response = await f.handler(
        new Request(`http://localhost${path}`, {
          method: 'POST',
          headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
          body: JSON.stringify(request),
        }),
      );
      assert.equal(response.status, 502);
      assert.match(await response.text(), /upstream_failed/u);
      assert.equal(f.calls(), 1);
      assert.equal(f.records.length, 1);
      assert.equal(f.records[0]?.outcome, 'failed');
      assert.equal(f.records[0]?.possiblyBilled, true);
      assert.equal(f.records[0]?.usage.status, 'missing');
      assert.ok(f.events.some((event) => (event as { outcome?: string }).outcome === 'failed'));
      assert.doesNotMatch(
        JSON.stringify(f.records),
        /private prompt fixture|private reply fixture|fixture-key/u,
      );
      assert.doesNotMatch(
        JSON.stringify(f.events),
        /private prompt fixture|private reply fixture|fixture-key/u,
      );
    }
  }
});
test('IAM, limits and required audit still prevent invalid-response transport', async () => {
  for (const kind of ['openai', 'openrouter'] as const) {
    for (const [options, status] of [
      [{ deny: true }, 403],
      [{ limited: true }, 429],
      [{ auditFails: true }, 503],
    ] as const) {
      const f = fixture(kind, [choice(kind), choice(kind, 1)], options);
      const response = await f.handler(
        new Request('http://localhost/api/v1/chat/completions', {
          method: 'POST',
          headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
          body: JSON.stringify(request),
        }),
      );
      assert.equal(response.status, status);
      assert.equal(f.calls(), 0);
      assert.equal(f.records.length, 0);
    }
  }
});
