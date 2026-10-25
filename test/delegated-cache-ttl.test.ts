import assert from 'node:assert/strict';
import test from 'node:test';
import { ttlHistory } from './breakpoint-ttl-fixture.ts';
import { delegatedCacheOptions } from './delegated-cache-ttl-fixture.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';
import { cacheOptionsFixture, cacheOptionsPrivacy } from './prompt-cache-options-fixture.ts';

const bases = ['/v1', '/api/v1'];
for (const stream of [false, true])
  for (const mode of ['text', 'refusal', 'function'] as const) {
    const controls = { stream, ...(mode === 'function' ? { tools: probabilityTools } : {}) };
    test(`delegated ${mode} stream=${stream}: 12h root options preserve both bases and independent text boundary TTL`, async () => {
      for (const base of bases)
        for (const messages of [undefined, ttlHistory('30m')]) {
          const f = cacheOptionsFixture('openrouter', { mode, stream });
          const r = await f.handler(
            f.request(base, {
              ...controls,
              prompt_cache_options: delegatedCacheOptions,
              ...(messages ? { messages } : {}),
            }),
          );
          assert.equal(r.status, 200);
          const body = await r.text();
          assert.doesNotMatch(body, /prompt_cache_options|"ttl"|12h|private reusable/u);
          if (stream) assert.ok(body.endsWith('data: [DONE]\n\n'));
          assert.deepEqual(f.sent[0]?.prompt_cache_options, delegatedCacheOptions);
          if (messages) assert.deepEqual(f.sent[0]?.messages, messages);
          assert.deepEqual(f.sent[0]?.provider, { only: ['provider'] });
          assert.equal(f.records[0]?.usage.totalTokens, 3);
          cacheOptionsPrivacy(f);
          assert.doesNotMatch(JSON.stringify([f.records, f.audits]), /12h/u);
        }
    });
    test(`delegated ${mode} stream=${stream}: root12h retains authentication, policy, limits and required persistence`, async () => {
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
          const f = cacheOptionsFixture('openrouter', { mode, stream, gate });
          const r = await f.handler(
            f.request(base, { ...controls, prompt_cache_options: delegatedCacheOptions }),
          );
          assert.equal(r.status, stream && (gate === 'audit' || gate === 'usage') ? 200 : status);
          assert.doesNotMatch(await r.text(), /prompt_cache_options|12h|fixture-.*key|\[DONE\]/u);
          assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0);
          cacheOptionsPrivacy(f);
        }
    });
  }
for (const stream of [false, true]) {
  test(`delegated stream=${stream}: root12h captures own getters before credentials and ignores mutation`, async () => {
    let roots = 0,
      modes = 0,
      ttls = 0;
    const options = {
      get mode() {
        modes++;
        return 'explicit';
      },
      get ttl() {
        ttls++;
        return ttls === 1 ? '12h' : 'private late TTL';
      },
    };
    const fields = {
      get prompt_cache_options() {
        roots++;
        return options;
      },
    };
    const f = cacheOptionsFixture('openrouter', {
      stream,
      mutate: () => {
        assert.deepEqual([roots, modes, ttls], [1, 1, 1]);
        Object.defineProperty(options, 'ttl', { value: '30m', enumerable: true });
      },
    });
    if (stream) await f.stream(false, fields);
    else await f.call(fields);
    assert.deepEqual([roots, modes, ttls], [1, 1, 1]);
    assert.deepEqual(f.sent[0]?.prompt_cache_options, delegatedCacheOptions);
    cacheOptionsPrivacy(f);
  });
  test(`delegated stream=${stream}: root12h never invents cache usage or hides possible billing on failure`, async () => {
    for (const options of [{ missingUsage: true }, { transportFails: true }]) {
      const f = cacheOptionsFixture('openrouter', { stream, ...options });
      const r = await f.handler(
        f.request('/api/v1', { stream, prompt_cache_options: delegatedCacheOptions }),
      );
      await r.text();
      assert.equal(f.sent.length, 1);
      assert.equal(f.records.length, 1);
      assert.equal(f.records[0]?.usage.status, 'missing');
      assert.equal(f.records[0]?.usage.totalTokens, null);
      if ('transportFails' in options) {
        assert.equal(r.status, 502);
        assert.equal(f.records[0]?.possiblyBilled, true);
      }
      cacheOptionsPrivacy(f);
    }
  });
}
for (const kind of ['openai', 'anthropic', 'google'] as const)
  for (const stream of [false, true])
    for (const mode of ['text', 'refusal', 'function'] as const)
      test(`${kind} ${mode} stream=${stream}: root12h remains unsupported before any native credentials`, async () => {
        for (const base of bases) {
          const f = cacheOptionsFixture(kind, { mode, stream });
          const r = await f.handler(
            f.request(base, {
              stream,
              prompt_cache_options: delegatedCacheOptions,
              ...(mode === 'function' ? { tools: probabilityTools } : {}),
            }),
          );
          assert.equal(r.status, 502);
          assert.equal(f.counts().secrets, 0);
          assert.equal(f.sent.length, 0);
          assert.doesNotMatch(await r.text(), /private|12h|prompt_cache_options/u);
          cacheOptionsPrivacy(f);
        }
        const f = cacheOptionsFixture(kind, { mode, stream });
        const fields = {
          prompt_cache_options: delegatedCacheOptions,
          ...(mode === 'function' ? { tools: probabilityTools } : {}),
        };
        await assert.rejects(() =>
          stream ? f.stream(mode === 'function', fields) : f.call(fields),
        );
        assert.equal(f.counts().secrets, 0);
      });
