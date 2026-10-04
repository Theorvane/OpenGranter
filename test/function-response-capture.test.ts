import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeAssistantResponse } from '../src/providers/assistant-response.ts';

const call = () => ({
  id: 'call',
  type: 'function',
  function: { name: 'lookup', arguments: '{}' },
});
function changing(first: unknown, later: unknown) {
  let reads = 0;
  return { get: () => (++reads === 1 ? first : later), reads: () => reads };
}
function normalize(tool_calls: unknown) {
  return normalizeAssistantResponse({ role: 'assistant', content: null, tool_calls }, 'tool_calls');
}

test('response call scalars use their first validated capture', () => {
  for (const field of ['id', 'name', 'arguments'] as const) {
    const item = call();
    const target = field === 'id' ? item : item.function;
    const value = field === 'arguments' ? '{}' : field === 'id' ? 'call' : 'lookup';
    const capture = changing(value, 42);
    Object.defineProperty(target, field, { get: capture.get });
    assert.deepEqual(normalize([item])?.tool_calls, [call()]);
    assert.equal(capture.reads(), 1);
  }
});

test('response legacy function control is captured once', () => {
  for (const first of [null, undefined, { name: 'legacy', arguments: '{}' }]) {
    const capture = changing(first, first == null ? { name: 'legacy' } : null);
    const message = { role: 'assistant', content: 'text' };
    Object.defineProperty(message, 'function_call', { get: capture.get });
    assert.deepEqual(
      normalizeAssistantResponse(message, 'stop'),
      first == null ? { role: 'assistant', content: 'text' } : undefined,
    );
    assert.equal(capture.reads(), 1);
  }
});

test('response call array uses one bounded count and fixed positions', () => {
  const entries = Array.from({ length: 129 }, (_, i) => ({ ...call(), id: `call_${i}` }));
  let reads = 0;
  const list = new Proxy(entries, {
    get(target, key, receiver) {
      if (key === 'length') return ++reads === 1 ? 1 : 129;
      return Reflect.get(target, key, receiver);
    },
  });
  assert.deepEqual(normalize(list)?.tool_calls, [entries[0]]);
  assert.equal(reads, 1);
  for (const count of [129, -1, 0.5, Number.NaN]) {
    const invalid = new Proxy([call()], {
      get(target, key, receiver) {
        return key === 'length' ? count : Reflect.get(target, key, receiver);
      },
    });
    assert.equal(normalize(invalid), undefined);
  }
  const original = call();
  const array = [original, { ...call(), id: 'second' }];
  Object.defineProperty(original, 'id', {
    get() {
      array[1] = { ...call(), id: 'replacement' };
      return 'call';
    },
  });
  assert.equal(normalize(array)?.tool_calls?.[1]?.id, 'second');
});

test('response projection preserves inherited fields and ignores unknown keys', () => {
  const operation = Object.assign(Object.create({ name: 'lookup', arguments: '{}' }), {
    extra: 42,
  });
  const item = Object.assign(Object.create({ id: 'call', type: 'function', function: operation }), {
    extra: 42,
  });
  assert.deepEqual(normalize([item])?.tool_calls, [call()]);
  assert.equal(normalize([call(), call()]), undefined);
  for (const field of ['id', 'name', 'arguments'] as const) {
    const item = call();
    const capture = changing(42, 'valid later');
    Object.defineProperty(field === 'id' ? item : item.function, field, { get: capture.get });
    assert.equal(normalize([item]), undefined);
    assert.equal(capture.reads(), 1);
  }
});

test('delegated public invoker sanitizes throwing response normalization', async () => {
  const { createOpenRouterChatInvoker, OpenRouterChatFailure } = await import(
    '../src/providers/openrouter-chat.ts'
  );
  const invoke = createOpenRouterChatInvoker({
    credentialRef: 'secret/reference',
    resolveSecret: async () => 'fixture-key',
    fetcher: async () => {
      const response = Response.json({});
      Object.defineProperty(response, 'json', {
        value: async () => ({
          id: 'completion',
          created: 1,
          model: 'model',
          choices: [
            {
              index: 0,
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    ...call(),
                    function: {
                      name: 'lookup',
                      get arguments() {
                        throw new Error('private getter fixture-key');
                      },
                    },
                  },
                ],
              },
            },
          ],
        }),
      });
      return response;
    },
  });
  await assert.rejects(
    invoke(
      { upstreamModelId: 'model', authorizedProviderSlugs: ['provider'] },
      {
        model: 'chat',
        messages: [{ role: 'user', content: 'private prompt' }],
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof OpenRouterChatFailure);
      assert.equal(error.category, 'upstream');
      assert.equal(error.responseStarted, true);
      assert.equal(error.possiblyBilled, true);
      assert.doesNotMatch(error.message, /private getter|fixture-key/u);
      return true;
    },
  );
});

test('response call captures preserve type, function reference and duplicate validation', () => {
  const item = call();
  const type = changing('function', 'invalid');
  const operation = changing(item.function, null);
  Object.defineProperty(item, 'type', { get: type.get });
  Object.defineProperty(item, 'function', { get: operation.get });
  assert.deepEqual(normalize([item])?.tool_calls, [call()]);
  assert.equal(type.reads(), 1);
  assert.equal(operation.reads(), 1);
  const duplicate = call();
  const id = changing('call', 'unique later');
  Object.defineProperty(duplicate, 'id', { get: id.get });
  assert.equal(normalize([call(), duplicate]), undefined);
  assert.equal(id.reads(), 1);
  assert.equal(normalize(new Array(1)), undefined);
  assert.equal(
    normalize(Array.from({ length: 128 }, (_, i) => ({ ...call(), id: `call_${i}` })))?.tool_calls
      ?.length,
    128,
  );
});
