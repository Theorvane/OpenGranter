import assert from 'node:assert/strict';
import test from 'node:test';
import {
  encodeOpenRouterFunctionSse,
  encodeOpenRouterTextSse,
} from '../src/streaming/openrouter-client-sse.ts';

for (const [name, encode] of [
  ['text', encodeOpenRouterTextSse],
  ['function', encodeOpenRouterFunctionSse],
] as const)
  test(`${name}: reported tier survives absent/incomplete counters without fabricated usage`, () => {
    for (const serviceTier of ['standard', 'future-tier', null, ''])
      for (const usage of [
        undefined,
        { prompt_tokens: 3 },
        { prompt_tokens: null, completion_tokens: 2, total_tokens: null },
      ]) {
        const event = {
          kind: 'usage' as const,
          id: 'gen',
          model: 'chat',
          created: 42,
          finishReason: 'stop' as const,
          usage,
        };
        const frame = encode({ ...event, serviceTier });
        assert.ok(frame);
        const body = JSON.parse(frame.slice(6));
        assert.equal(body.service_tier, serviceTier);
        assert.equal(Object.hasOwn(body, 'usage'), false);
        assert.equal(body.choices[0].finish_reason, 'stop');
        assert.equal(encode(event), undefined);
      }
  });
