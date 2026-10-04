import assert from 'node:assert/strict';
import test from 'node:test';
import { createDelegatedFunctionHttpStreamResponse } from '../src/streaming/delegated-http-stream.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

function fixture() {
  const audit: unknown[] = [],
    usage: UsageRecord[] = [];
  let calls = 0,
    callbacks = 0;
  const input: Parameters<typeof createDelegatedFunctionHttpStreamResponse>[0] = {
    principalId: 'user',
    credentialId: 'proxy',
    policyVersions: [],
    principalActive: true,
    requestId: 'req',
    routeVersion: 'v1',
    credentialRef: 'secret/openrouter',
    modelAlias: 'chat',
    candidates: [
      {
        id: 'candidate',
        kind: 'delegated',
        upstreamModelId: 'openai/example',
        providerId: 'openai',
      },
    ],
    statements: [
      { effect: 'Allow', actions: ['llm:InvokeModel', 'llm:UseProvider'], resources: ['*'] },
    ],
    request: { model: 'chat', messages: [{ role: 'user', content: 'private prompt' }] },
    signal: new AbortController().signal,
    format: 'openrouter',
    ports: {
      resolveVerifiedProviderSlug: async () => 'OpenAI',
      checkLimit: async () => true,
      writeAudit: async (event) => {
        audit.push(event);
      },
      writeUsage: async (record) => {
        usage.push(record);
      },
      invokeOpenRouterFunctionStream: async (_ref, attempt, _request, onDelta) => {
        calls++;
        assert.deepEqual(attempt.authorizedProviderSlugs, ['OpenAI']);
        callbacks++;
        await onDelta({
          kind: 'delta',
          id: 'gen',
          model: 'chat',
          created: 42,
          finishReason: null,
          toolCalls: [
            {
              index: 0,
              id: 'call',
              type: 'function',
              function: { name: 'lookup', arguments: 'private args\n\ndata: forged' },
            },
          ],
        });
        callbacks++;
        await onDelta({
          kind: 'delta',
          id: 'gen',
          model: 'chat',
          created: 42,
          finishReason: 'tool_calls',
        });
        return {
          status: 'complete',
          id: 'gen',
          model: 'chat',
          finishReason: 'tool_calls',
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          toolCalls: [
            {
              id: 'call',
              type: 'function',
              function: { name: 'lookup', arguments: 'private args' },
            },
          ],
        };
      },
    },
  };
  return { input, audit, usage, calls: () => calls, callbacks: () => callbacks };
}
test('function HTTP response preserves safe frames and accounts before final success', async () => {
  for (const format of ['opengranter', 'openrouter'] as const) {
    const f = fixture(),
      response = await createDelegatedFunctionHttpStreamResponse({ ...f.input, format });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.text();
    assert.equal(body.includes('args\n\ndata: forged'), false);
    const frames = body.split('\n\n').filter(Boolean);
    assert.equal(frames.length, 4);
    assert.equal(frames.at(-1), 'data: [DONE]');
    const first = JSON.parse(frames[0]!.slice(6));
    assert.equal(
      first.choices[0].delta.tool_calls[0].function.arguments,
      'private args\n\ndata: forged',
    );
    assert.equal(f.usage[0]?.outcome, 'succeeded');
    assert.equal(JSON.stringify([f.audit, f.usage]).includes('private'), false);
  }
});
test('bounded function HTTP delivery waits for demand before completion accounting', async () => {
  const f = fixture(),
    response = await createDelegatedFunctionHttpStreamResponse(f.input);
  assert.equal(f.callbacks(), 1);
  assert.equal(f.usage.length, 0);
  const reader = response.body!.getReader();
  await reader.read();
  await reader.read();
  const final = await reader.read();
  assert.ok(new TextDecoder().decode(final.value).includes('"usage"'));
  assert.equal(f.usage[0]?.outcome, 'succeeded');
  await reader.read();
  assert.equal((await reader.read()).done, true);
  reader.releaseLock();
});
test('Deny and limit return JSON before upstream function invocation', async () => {
  for (const deny of [true, false]) {
    const f = fixture();
    const response = await createDelegatedFunctionHttpStreamResponse({
      ...f.input,
      ...(deny
        ? {
            statements: [
              ...f.input.statements,
              { effect: 'Deny' as const, actions: ['llm:UseProvider'], resources: ['*'] },
            ],
          }
        : {}),
      ports: { ...f.input.ports, checkLimit: async () => (!deny ? false : true) },
    });
    assert.equal(response.status, deny ? 403 : 429);
    assert.equal(f.calls(), 0);
    assert.equal(f.usage.length, 0);
    assert.equal((await response.text()).includes('private'), false);
  }
});
test('partial output and persistence failures send safe errors without DONE', async () => {
  for (const variant of ['upstream', 'usage', 'audit'] as const) {
    for (const format of ['opengranter', 'openrouter'] as const) {
      const f = fixture(),
        original = f.input.ports.invokeOpenRouterFunctionStream;
      assert.ok(original);
      const response = await createDelegatedFunctionHttpStreamResponse({
        ...f.input,
        format,
        ports: {
          ...f.input.ports,
          ...(variant === 'usage'
            ? {
                writeUsage: async () => {
                  throw Error('private ledger');
                },
              }
            : {}),
          ...(variant === 'audit'
            ? {
                writeAudit: async (event) => {
                  if (event.kind === 'delegated-attempt') throw Error('private audit');
                  f.audit.push(event);
                },
              }
            : {}),
          ...(variant === 'upstream'
            ? {
                invokeOpenRouterFunctionStream: async (ref, attempt, chat, onDelta, signal) =>
                  original(
                    ref,
                    attempt,
                    chat,
                    async (delta) => {
                      await onDelta(delta);
                      throw Error('private failure');
                    },
                    signal,
                  ),
              }
            : {}),
        },
      });
      const body = await response.text();
      assert.equal(body.includes('[DONE]'), false);
      assert.equal(body.includes('private failure'), false);
      assert.equal(body.includes('private ledger'), false);
      assert.equal(body.includes('private audit'), false);
      assert.equal(
        f.audit.filter((event) => (event as { kind: string }).kind === 'stream-interrupted').length,
        1,
      );
      assert.equal(JSON.stringify([f.audit, f.usage]).includes('private'), false);
    }
  }
});
test('body cancellation aborts a pending callback and records one interruption', async () => {
  const f = fixture();
  let interrupted!: () => void;
  const done = new Promise<void>((resolve) => {
    interrupted = resolve;
  });
  let signal: AbortSignal | undefined;
  const original = f.input.ports.invokeOpenRouterFunctionStream;
  assert.ok(original);
  const response = await createDelegatedFunctionHttpStreamResponse({
    ...f.input,
    ports: {
      ...f.input.ports,
      writeAudit: async (event) => {
        f.audit.push(event);
        if (event.kind === 'stream-interrupted') interrupted();
      },
      invokeOpenRouterFunctionStream: async (ref, attempt, chat, onDelta, cancellation) => {
        signal = cancellation;
        return original(ref, attempt, chat, onDelta, cancellation);
      },
    },
  });
  await response.body!.cancel();
  await done;
  assert.equal(signal?.aborted, true);
  assert.equal(f.usage[0]?.outcome, 'failed');
  assert.equal(f.usage[0]?.possiblyBilled, true);
  assert.equal(f.calls(), 1);
});
