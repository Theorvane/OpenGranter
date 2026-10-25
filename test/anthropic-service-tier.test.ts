import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { anthropicTierFixture, anthropicTierPrivacy } from './anthropic-service-tier-fixture.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';

const bases = ['/v1', '/api/v1'];

for (const stream of [false, true])
  for (const mode of ['text', 'refusal', 'function'] as const) {
    const controls = { stream, ...(mode === 'function' ? { tools: probabilityTools } : {}) };
    test(`Anthropic ${mode} stream=${stream}: exact native tier mapping and omission through both bases and invokers`, async () => {
      for (const tier of ['auto', 'default', null, undefined] as const) {
        for (const base of bases) {
          const f = anthropicTierFixture({ stream, mode });
          const r = await f.handler(
            f.request(base, { ...controls, ...(tier === undefined ? {} : { service_tier: tier }) }),
          );
          assert.equal(r.status, 200);
          const body = await r.text();
          assert.doesNotMatch(body, /service_tier|standard_only/u);
          if (stream) assert.ok(body.endsWith('data: [DONE]\n\n'));
          assert.equal(
            f.sent[0]?.service_tier,
            tier == null ? undefined : tier === 'default' ? 'standard_only' : 'auto',
          );
          assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'service_tier'), tier != null);
          assert.equal(f.sent[0]?.model, 'upstream-model');
          assert.equal(f.sent[0]?.max_tokens, 128);
          assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'speed'), false);
          assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'inference_geo'), false);
          assert.equal(f.records[0]?.usage.totalTokens, 5);
          anthropicTierPrivacy(f);
        }
        const f = anthropicTierFixture({ stream, mode });
        const fields = { ...controls, service_tier: tier };
        if (stream) await f.stream(mode === 'function', fields);
        else await f.call(fields);
        assert.equal(
          f.sent[0]?.service_tier,
          tier == null ? undefined : tier === 'default' ? 'standard_only' : 'auto',
        );
        anthropicTierPrivacy(f);
      }
    });
    test(`Anthropic ${mode} stream=${stream}: tiers retain auth, implicit/model/provider Deny, limits and required persistence`, async () => {
      for (const [gate, status] of [
        ['auth', 401],
        ['implicit', 403],
        ['model', 403],
        ['provider', 403],
        ['limit', 429],
        ['selection', 503],
        ['audit', 503],
        ['usage', 503],
      ] as const)
        for (const base of bases) {
          const f = anthropicTierFixture({ stream, mode, gate });
          const r = await f.handler(f.request(base, { ...controls, service_tier: 'default' }));
          assert.equal(r.status, stream && (gate === 'audit' || gate === 'usage') ? 200 : status);
          assert.doesNotMatch(await r.text(), /service_tier|standard_only|fixture-.*key|\[DONE\]/u);
          assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0);
          anthropicTierPrivacy(f);
        }
    });
    test(`Anthropic ${mode} stream=${stream}: requested tiers never invent usage or hide opened failure billing`, async () => {
      for (const options of [{ missingUsage: true }, { transportFails: true }]) {
        const f = anthropicTierFixture({ stream, mode, ...options });
        const r = await f.handler(f.request('/api/v1', { ...controls, service_tier: 'auto' }));
        await r.text();
        assert.equal(f.sent.length, 1);
        assert.equal(f.records[0]?.usage.status, 'missing');
        assert.equal(f.records[0]?.usage.totalTokens, null);
        if ('transportFails' in options) {
          assert.equal(r.status, 502);
          assert.equal(f.records[0]?.possiblyBilled, true);
        }
        anthropicTierPrivacy(f);
      }
    });
  }
for (const stream of [false, true]) {
  test(`Anthropic stream=${stream}: captured default cannot be changed at credential awaits`, async () => {
    let reads = 0;
    const input = {
      get service_tier() {
        reads++;
        return reads === 1 ? 'default' : 'priority';
      },
    };
    const f = anthropicTierFixture({
      stream,
      mutate: () => {
        assert.equal(reads, 1);
        Object.defineProperty(input, 'service_tier', { value: 'auto', enumerable: true });
      },
    });
    if (stream) await f.stream(false, input);
    else await f.call(input);
    assert.equal(reads, 1);
    assert.equal(f.sent[0]?.service_tier, 'standard_only');
    anthropicTierPrivacy(f);
  });
  test(`Anthropic stream=${stream}: unsupported/native literals and private getters reject before secrets`, async () => {
    for (const service_tier of [
      'flex',
      'scale',
      'priority',
      'fast',
      'ultrafast',
      'standard_only',
      'AUTO',
      ' default',
      {},
      new String('auto'),
    ]) {
      const f = anthropicTierFixture({ stream });
      await assert.rejects(() =>
        stream ? f.stream(false, { service_tier }) : f.call({ service_tier }),
      );
      assert.equal(f.counts().secrets, 0);
      assert.equal(f.sent.length, 0);
      anthropicTierPrivacy(f);
    }
    const f = anthropicTierFixture({ stream });
    const fields = {
      get service_tier() {
        throw Error('private tier getter');
      },
    };
    await assert.rejects(
      () => (stream ? f.stream(false, fields) : f.call(fields)),
      (e: unknown) => {
        assert.ok(e instanceof Error);
        assert.doesNotMatch(e.message, /private|getter/u);
        return true;
      },
    );
    assert.equal(f.counts().secrets, 0);
  });
}
for (const mode of ['text', 'function'] as const)
  test(`Anthropic ${mode}: tier mapping preserves audited body cancellation`, {
    timeout: 3000,
  }, async () => {
    const f = anthropicTierFixture({ stream: true, mode });
    let done: () => void = () => {};
    const interrupted = new Promise<void>((resolve) => {
      done = resolve;
    });
    const handler = createChatHandler({
      ...f.ports,
      writeAudit: async (event) => {
        await f.ports.writeAudit(event);
        if (event.kind === 'stream-interrupted') done();
      },
    });
    const r = await handler(
      f.request('/api/v1', {
        stream: true,
        service_tier: 'default',
        ...(mode === 'function' ? { tools: probabilityTools } : {}),
      }),
    );
    assert.equal(r.status, 200);
    const reader = r.body?.getReader();
    assert.ok(reader);
    assert.equal((await reader.read()).done, false);
    await reader.cancel('private tier cancellation');
    await interrupted;
    assert.equal(f.records[0]?.outcome, 'failed');
    assert.equal(f.records[0]?.possiblyBilled, true);
    anthropicTierPrivacy(f);
  });
