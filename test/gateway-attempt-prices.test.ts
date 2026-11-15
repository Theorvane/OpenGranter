import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type ChatHandlerPorts, createChatHandler } from '../src/gateway/chat-handler.ts';
import type { AttemptPriceContext, UsageHandoff } from '../src/usage/capture-attempt.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

type Mode = 'json' | 'text' | 'function';
function fixture(kind: 'managed' | 'delegated', mode: Mode) {
  const records: UsageRecord[] = [];
  const order: string[] = [];
  const contexts: AttemptPriceContext[] = [];
  const price = {
    kind: 'flat-token' as const,
    priceVersion: 'trusted-version',
    currency: 'USD',
    inputPerToken: '0.1',
    outputPerToken: '0.2',
  };
  const usage = { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 };
  const complete = {
    id: 'generation',
    object: 'chat.completion',
    created: 4,
    model: 'chat',
    choices: [
      { index: 0, message: { role: 'assistant', content: 'answer' }, finish_reason: 'stop' },
    ],
    usage,
  };
  function dispatch() {
    order.push('dispatch');
    price.priceVersion = 'mutated-after-start';
    price.inputPerToken = '999';
  }
  const ports: Mutable<
    ChatHandlerPorts<typeof complete> & Pick<UsageHandoff, 'resolveAttemptPrice'>
  > = {
    newRequestId: () => 'request',
    now: () => 100,
    authenticate: async () => ({
      id: 'principal',
      active: true,
      credentialId: 'credential',
      policyVersions: [],
      statements: [
        {
          effect: 'Allow',
          actions: ['llm:InvokeModel', 'llm:UseProvider'],
          resources: ['model:chat', 'provider:openai'],
        },
      ],
    }),
    resolveRoute: async () =>
      kind === 'delegated'
        ? {
            kind,
            version: 'route-v1',
            credentialRef: 'ref',
            candidates: [
              { id: 'candidate', kind, providerId: 'openai', upstreamModelId: 'native' },
            ],
          }
        : {
            kind,
            version: 'route-v1',
            candidates: [
              { id: 'candidate', kind, providerId: 'openai', upstreamModelId: 'native' },
            ],
          },
    checkLimit: async () => {
      order.push('limit');
      return true;
    },
    resolveSecret: async () => undefined,
    resolveVerifiedProviderSlug: async () => 'OpenAI',
    writeAudit: async (event) => {
      order.push(event.kind);
    },
    writeUsage: async (record) => {
      order.push('usage');
      records.push(record);
    },
    resolveAttemptPrice: (context) => {
      order.push('price');
      contexts.push(context);
      return price;
    },
    invokeDirect: async () => {
      dispatch();
      return complete;
    },
    invokeOpenRouter: async () => {
      dispatch();
      return complete;
    },
    invokeDirectTextStream: async (_candidate, _request, onDelta) => {
      dispatch();
      await onDelta({
        kind: 'delta',
        id: 'generation',
        created: 4,
        model: 'chat',
        content: 'answer',
        finishReason: null,
      });
      await onDelta({
        kind: 'delta',
        id: 'generation',
        created: 4,
        model: 'chat',
        finishReason: 'stop',
      });
      return { status: 'complete', id: 'generation', model: 'chat', finishReason: 'stop', usage };
    },
    invokeOpenRouterTextStream: async (_ref, _attempt, _request, onDelta) => {
      dispatch();
      await onDelta({
        kind: 'delta',
        id: 'generation',
        created: 4,
        model: 'chat',
        content: 'answer',
        finishReason: null,
      });
      await onDelta({
        kind: 'delta',
        id: 'generation',
        created: 4,
        model: 'chat',
        finishReason: 'stop',
      });
      return { status: 'complete', id: 'generation', model: 'chat', finishReason: 'stop', usage };
    },
    invokeDirectFunctionStream: async (_candidate, _request, onDelta) => {
      dispatch();
      await onDelta({
        kind: 'delta',
        id: 'generation',
        created: 4,
        model: 'chat',
        toolCalls: [
          { index: 0, id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } },
        ],
        finishReason: null,
      });
      await onDelta({
        kind: 'delta',
        id: 'generation',
        created: 4,
        model: 'chat',
        finishReason: 'tool_calls',
      });
      return {
        status: 'complete',
        id: 'generation',
        model: 'chat',
        finishReason: 'tool_calls',
        usage,
        toolCalls: [
          { id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } },
        ],
      };
    },
    invokeOpenRouterFunctionStream: async (_ref, _attempt, _request, onDelta) => {
      dispatch();
      await onDelta({
        kind: 'delta',
        id: 'generation',
        created: 4,
        model: 'chat',
        toolCalls: [
          { index: 0, id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } },
        ],
        finishReason: null,
      });
      await onDelta({
        kind: 'delta',
        id: 'generation',
        created: 4,
        model: 'chat',
        finishReason: 'tool_calls',
      });
      return {
        status: 'complete',
        id: 'generation',
        model: 'chat',
        finishReason: 'tool_calls',
        usage,
        toolCalls: [
          { id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } },
        ],
      };
    },
  };
  function request() {
    return new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'chat',
        messages: [{ role: 'user', content: 'prompt' }],
        ...(mode === 'json' ? {} : { stream: true }),
        ...(mode === 'function'
          ? {
              tools: [
                {
                  type: 'function',
                  function: { name: 'lookup', parameters: { type: 'object', properties: {} } },
                },
              ],
            }
          : {}),
      }),
    });
  }
  return { ports, records, order, contexts, request };
}

for (const kind of ['managed', 'delegated'] as const) {
  for (const mode of ['json', 'text', 'function'] as const) {
    test(`${kind} ${mode} gateway forwards trusted attempt price before provider dispatch`, async () => {
      const f = fixture(kind, mode);
      const response = await createChatHandler(f.ports)(f.request());
      const body = await response.text();
      assert.equal(response.status, 200, body);
      assert.equal(f.contexts.length, 1);
      assert.ok(Object.isFrozen(f.contexts[0]));
      assert.deepEqual(f.contexts[0], {
        routeVersion: 'route-v1',
        requestId: 'request',
        routeKind: kind,
        modelAlias: 'chat',
        upstreamModelId: 'native',
        selectedCandidateId: 'candidate',
        attemptNumber: 1,
        startedAt: 100,
      });
      assert.ok(f.order.indexOf('limit') < f.order.indexOf('price'));
      assert.ok(f.order.indexOf('price') < f.order.indexOf('dispatch'));
      assert.deepEqual(f.records[0]?.estimatedCost, {
        amountDecimal: '0.4',
        currency: 'USD',
        priceVersion: 'trusted-version',
      });
      assert.ok(!body.includes('trusted-version'));
      if (mode !== 'json') assert.ok(body.includes('[DONE]'));
    });
    test(`${kind} ${mode} configured price failure stops dispatch and successful termination`, async () => {
      const f = fixture(kind, mode);
      f.ports.resolveAttemptPrice = () => {
        throw new Error('private pricing failure');
      };
      const response = await createChatHandler(f.ports)(f.request());
      const body = await response.text();
      assert.equal(response.status, 503, body);
      assert.ok(body.includes('usage_unavailable'));
      assert.ok(!body.includes('private pricing'));
      assert.ok(!body.includes('[DONE]'));
      assert.ok(!f.order.includes('dispatch'));
      assert.equal(f.records.length, 0);
    });
  }
  for (const gate of ['auth', 'deny', 'limit'] as const) {
    test(`${kind} ${gate} gate skips trusted pricing`, async () => {
      const f = fixture(kind, 'json');
      if (gate === 'auth') f.ports.authenticate = async () => undefined;
      if (gate === 'deny')
        f.ports.authenticate = async () => ({
          id: 'principal',
          active: true,
          credentialId: 'credential',
          policyVersions: [],
          statements: [],
        });
      if (gate === 'limit') f.ports.checkLimit = async () => false;
      const response = await createChatHandler(f.ports)(f.request());
      await response.text();
      assert.equal(response.status, gate === 'auth' ? 401 : gate === 'deny' ? 403 : 429);
      assert.equal(f.contexts.length, 0);
      assert.ok(!f.order.includes('dispatch'));
    });
  }
  test(`${kind} absent trusted resolver preserves unknown cost`, async () => {
    const f = fixture(kind, 'json');
    delete f.ports.resolveAttemptPrice;
    const response = await createChatHandler(f.ports)(f.request());
    await response.text();
    assert.equal(response.status, 200);
    assert.equal(f.records[0]?.estimatedCost, null);
  });
}

for (const kind of ['managed', 'delegated'] as const) {
  test(`${kind} HTTP body cannot install or replace the trusted price resolver`, async () => {
    const f = fixture(kind, 'json');
    const original = f.request();
    const body = (await original.json()) as Record<string, unknown>;
    const response = await createChatHandler(f.ports)(
      new Request(original.url, {
        method: 'POST',
        headers: original.headers,
        body: JSON.stringify({
          ...body,
          resolveAttemptPrice: {
            priceVersion: 'attacker',
            inputPerToken: '0',
            outputPerToken: '0',
          },
        }),
      }),
    );
    const result = await response.text();
    assert.equal(response.status, 400, result);
    assert.equal(f.contexts.length, 0);
    assert.ok(!f.order.includes('dispatch'));
  });
  test(`${kind} malformed trusted price fails closed`, async () => {
    const f = fixture(kind, 'json');
    f.ports.resolveAttemptPrice = () => ({
      kind: 'flat-token',
      priceVersion: 'bad',
      currency: 'USD',
      inputPerToken: '-1',
      outputPerToken: '0',
    });
    const response = await createChatHandler(f.ports)(f.request());
    assert.equal(response.status, 503, await response.text());
    assert.ok(!f.order.includes('dispatch'));
    assert.equal(f.records.length, 0);
  });
}
