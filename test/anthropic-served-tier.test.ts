import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import {
  responseChunks,
  type ServedTierOptions,
  servedTierFixture,
  servedTierPrivacy,
  type TierReport,
} from './anthropic-served-tier-fixture.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';

const bases = ['/v1', '/api/v1'];
for (const stream of [false, true])
  for (const mode of ['text', 'refusal', 'function'] as const) {
    const controls = { stream, ...(mode === 'function' ? { tools: probabilityTools } : {}) };
    test(`Anthropic ${mode} stream=${stream}: provider-reported nullable string tier reaches both bases exactly`, async () => {
      for (const report of [
        {},
        { tier: 'standard' },
        { tier: 'priority' },
        { tier: 'batch' },
        { tier: null },
        { tier: 'future-tier' },
        { tier: '' },
      ] as TierReport[])
        for (const base of bases) {
          const f = servedTierFixture({ stream, mode, ...report });
          const r = await f.handler(f.request(base, controls));
          assert.equal(r.status, 200);
          const body = await r.text();
          const chunks = responseChunks(body, stream);
          assert.equal(chunks.at(-1)?.service_tier, report.tier);
          assert.equal(
            Object.hasOwn(chunks.at(-1) ?? {}, 'service_tier'),
            Object.hasOwn(report, 'tier'),
          );
          if (stream) {
            assert.ok(body.endsWith('data: [DONE]\n\n'));
            for (const chunk of chunks.slice(0, -1))
              assert.equal(Object.hasOwn(chunk, 'service_tier'), false);
          }
          assert.equal(f.records[0]?.usage.totalTokens, 5);
          servedTierPrivacy(f);
        }
    });
    test(`Anthropic ${mode} stream=${stream}: tier-only reports cannot manufacture token usage or cost`, async () => {
      const f = servedTierFixture({ stream, mode, tier: 'standard', missingUsage: true });
      const r = await f.handler(f.request('/api/v1', controls));
      assert.equal(r.status, 200);
      const chunks = responseChunks(await r.text(), stream);
      assert.equal(chunks.at(-1)?.service_tier, 'standard');
      assert.equal(f.records[0]?.usage.status, 'missing');
      assert.equal(f.records[0]?.usage.totalTokens, null);
      servedTierPrivacy(f);
    });
    test(`Anthropic ${mode} stream=${stream}: malformed selected tier fails privately with possible billing`, async () => {
      for (const tier of [0, false, [], {}, { detail: 'private tier payload' }]) {
        const f = servedTierFixture({ stream, mode, tier });
        const r = await f.handler(f.request('/api/v1', controls));
        const body = await r.text();
        if (!stream) assert.equal(r.status, 502);
        assert.doesNotMatch(body, /service_tier|private tier payload|fixture-.*key|\[DONE\]/u);
        assert.equal(f.records[0]?.outcome, 'failed');
        assert.equal(f.records[0]?.possiblyBilled, true);
        servedTierPrivacy(f);
      }
    });
    test(`Anthropic ${mode} stream=${stream}: served metadata preserves auth/Deny/limits and required audit/usage`, async () => {
      for (const [gate, status] of [
        ['auth', 401],
        ['implicit', 403],
        ['model', 403],
        ['provider', 403],
        ['limit', 429],
        ['selection', 503],
        ['audit', 503],
        ['usage', 503],
      ] as const) {
        const f = servedTierFixture({ stream, mode, tier: 'priority', gate });
        const r = await f.handler(f.request('/api/v1', controls));
        assert.equal(r.status, stream && (gate === 'audit' || gate === 'usage') ? 200 : status);
        assert.doesNotMatch(await r.text(), /service_tier|fixture-.*key|\[DONE\]/u);
        assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0);
        servedTierPrivacy(f);
      }
    });
  }
for (const mode of ['text', 'refusal', 'function'] as const)
  test(`Anthropic ${mode} stream: latest report wins, omission retains and explicit null replaces`, async () => {
    const cases: readonly [ServedTierOptions, unknown][] = [
      [{ tier: 'priority' }, 'priority'],
      [{ tier: 'standard', updates: [{}, { tier: 'priority' }, {}] }, 'priority'],
      [{ tier: 'priority', final: { tier: null } }, null],
      [{ tier: null, updates: [{ tier: 'batch' }] }, 'batch'],
      [{ final: { tier: 'future-tier' } }, 'future-tier'],
      [{ tier: 'standard', updates: [{ tier: null }, {}] }, null],
      [{ updates: [{}] }, undefined],
    ];
    for (const [reports, expected] of cases) {
      const f = servedTierFixture({ stream: true, mode, ...reports });
      const r = await f.handler(
        f.request('/api/v1', {
          stream: true,
          ...(mode === 'function' ? { tools: probabilityTools } : {}),
        }),
      );
      assert.equal(r.status, 200);
      const chunks = responseChunks(await r.text(), true);
      assert.equal(chunks.at(-1)?.service_tier, expected);
      assert.equal(Object.hasOwn(chunks.at(-1) ?? {}, 'service_tier'), expected !== undefined);
      assert.equal(f.records[0]?.usage.totalTokens, 5);
      servedTierPrivacy(f);
    }
  });
for (const mode of ['text', 'function'] as const) {
  test(`Anthropic ${mode}: malformed late tier suppresses final metadata and terminal success`, async () => {
    const f = servedTierFixture({
      stream: true,
      mode,
      tier: 'standard',
      final: { tier: { private: 'private tier payload' } },
    });
    const r = await f.handler(
      f.request('/api/v1', {
        stream: true,
        ...(mode === 'function' ? { tools: probabilityTools } : {}),
      }),
    );
    const body = await r.text();
    assert.doesNotMatch(body, /service_tier|private tier payload|fixture-.*key|\[DONE\]/u);
    assert.equal(f.records[0]?.outcome, 'failed');
    assert.equal(f.records[0]?.possiblyBilled, true);
    servedTierPrivacy(f);
  });
  test(`Anthropic ${mode}: body cancellation retains interruption without emitting pending tier`, {
    timeout: 3000,
  }, async () => {
    const f = servedTierFixture({ stream: true, mode, tier: 'priority' });
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
        ...(mode === 'function' ? { tools: probabilityTools } : {}),
      }),
    );
    assert.equal(r.status, 200);
    const reader = r.body?.getReader();
    assert.ok(reader);
    const first = await reader.read();
    assert.equal(first.done, false);
    assert.doesNotMatch(new TextDecoder().decode(first.value), /service_tier/u);
    await reader.cancel('private cancellation');
    await interrupted;
    assert.equal(f.records[0]?.outcome, 'failed');
    assert.equal(f.records[0]?.possiblyBilled, true);
    servedTierPrivacy(f);
  });
}
