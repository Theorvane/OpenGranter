import assert from 'node:assert/strict';
import test from 'node:test';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';
import { cacheKeyFixture, cacheKeyPrivacy, suppliedCacheKey } from './prompt-cache-key-fixture.ts';

const bases = ['/v1', '/api/v1'];
for (const kind of ['openai', 'openrouter'] as const)
  test(`${kind}: caller attribution and cache preferences remain independent on both bases`, async () => {
    for (const base of bases)
      for (const stream of [false, true]) {
        const f = cacheKeyFixture(kind, { stream });
        const response = await f.handler(
          f.request(base, {
            user: 'private distinct end-user',
            prompt_cache_key: suppliedCacheKey,
            ...(stream ? { stream: true } : {}),
          }),
        );
        assert.equal(response.status, 200);
        assert.doesNotMatch(await response.text(), /distinct end-user|supplied cache key/u);
        assert.equal(f.sent[0]?.user, 'private distinct end-user');
        assert.equal(f.sent[0]?.prompt_cache_key, suppliedCacheKey);
        assert.equal(f.records[0]?.usage.totalTokens, 3);
        cacheKeyPrivacy(f);
      }
  });
for (const kind of ['anthropic', 'google'] as const)
  test(`${kind}: null cache keys preserve native nonstream defaults`, async () => {
    for (const base of bases) {
      const f = cacheKeyFixture(kind);
      const response = await f.handler(f.request(base, { prompt_cache_key: null }));
      assert.equal(response.status, 200);
      assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'prompt_cache_key'), false);
      assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'cachedContent'), false);
      assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'cache_control'), false);
      cacheKeyPrivacy(f);
    }
  });
const values = [
  undefined,
  null,
  '',
  '  CaseSensitive User  ',
  suppliedCacheKey,
  'private'.repeat(1024),
];
test('prompt cache key retains the existing complete HTTP body size limit', async () => {
  for (const base of bases) {
    const f = cacheKeyFixture('openai');
    const response = await f.handler(
      f.request(base, { prompt_cache_key: 'private'.repeat(150000) }),
    );
    assert.equal(response.status, 400);
    assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
    assert.equal(f.records.length, 0);
    assert.doesNotMatch(await response.text(), /private|fixture-.*key/u);
  }
});
for (const kind of ['openai', 'openrouter'] as const)
  for (const stream of [false, true])
    for (const mode of ['text', 'refusal', 'function'] as const) {
      test(`${kind} ${mode} stream=${stream}: exact prompt cache key strings and omission survive both bases`, async () => {
        for (const base of bases)
          for (const prompt_cache_key of values) {
            const f = cacheKeyFixture(kind, { stream, mode });
            const response = await f.handler(
              f.request(base, {
                ...(prompt_cache_key === undefined ? {} : { prompt_cache_key }),
                ...(stream ? { stream: true } : {}),
                ...(mode === 'function' ? { tools: probabilityTools } : {}),
              }),
            );
            assert.equal(response.status, 200);
            const body = await response.text();
            assert.doesNotMatch(body, /supplied cache key|CaseSensitive User/u);
            if (stream) assert.ok(body.endsWith('data: [DONE]\n\n'));
            assert.equal(f.sent[0]?.prompt_cache_key, prompt_cache_key ?? undefined);
            assert.equal(
              Object.hasOwn(f.sent[0] ?? {}, 'prompt_cache_key'),
              prompt_cache_key != null,
            );
            if (kind === 'openrouter')
              assert.deepEqual(f.sent[0]?.provider, { only: ['provider'] });
            assert.equal(f.records[0]?.outcome, 'succeeded');
            assert.equal(f.records[0]?.usage.totalTokens, 3);
            cacheKeyPrivacy(f);
          }
      });
      test(`${kind} ${mode} stream=${stream}: cache key metadata cannot manufacture missing usage`, async () => {
        const f = cacheKeyFixture(kind, { stream, mode, missingUsage: true });
        const response = await f.handler(
          f.request('/api/v1', {
            prompt_cache_key: suppliedCacheKey,
            ...(stream ? { stream: true } : {}),
            ...(mode === 'function' ? { tools: probabilityTools } : {}),
          }),
        );
        assert.equal(response.status, 200);
        assert.doesNotMatch(await response.text(), /supplied cache key/u);
        assert.equal(f.records[0]?.usage.totalTokens, null);
        assert.equal(f.records[0]?.usage.status, 'missing');
        cacheKeyPrivacy(f);
      });
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
        test(`${kind} ${mode} stream=${stream}: prompt cache key preserves ${gate} gate`, async () => {
          for (const base of bases) {
            const f = cacheKeyFixture(kind, { stream, mode, gate });
            const response = await f.handler(
              f.request(base, {
                prompt_cache_key: suppliedCacheKey,
                ...(stream ? { stream: true } : {}),
                ...(mode === 'function' ? { tools: probabilityTools } : {}),
              }),
            );
            assert.equal(
              response.status,
              stream && (gate === 'audit' || gate === 'usage') ? 200 : status,
            );
            const body = await response.text();
            assert.doesNotMatch(body, /supplied cache key|fixture-.*key|\[DONE\]/u);
            assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0);
            cacheKeyPrivacy(f);
          }
        });
    }
for (const kind of ['openai', 'openrouter', 'anthropic', 'google'] as const)
  for (const stream of [false, true])
    test(`${kind} stream=${stream}: malformed prompt cache key values reject before routes and secrets`, async () => {
      for (const base of bases)
        for (const prompt_cache_key of [false, 0, [], {}, { toString: 'private' }]) {
          const f = cacheKeyFixture(kind, { stream });
          const response = await f.handler(
            f.request(base, { prompt_cache_key, ...(stream ? { stream: true } : {}) }),
          );
          assert.equal(response.status, 400);
          assert.doesNotMatch(await response.text(), /private|forged|fixture-.*key/u);
          assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
          assert.equal(f.records.length, 0);
          cacheKeyPrivacy(f);
        }
      for (const prompt_cache_key of [false, 0, [], {}]) {
        const f = cacheKeyFixture(kind, { stream });
        await assert.rejects(() =>
          stream ? f.stream(false, { prompt_cache_key }) : f.call({ prompt_cache_key }),
        );
        assert.equal(f.counts().secrets, 0);
      }
    });
for (const kind of ['anthropic', 'google'] as const) {
  test(`${kind}: prompt cache key never silently translates to unrelated native fields`, async () => {
    for (const base of bases) {
      const omitted = cacheKeyFixture(kind);
      assert.equal((await omitted.handler(omitted.request(base))).status, 200);
      assert.equal(Object.hasOwn(omitted.sent[0] ?? {}, 'prompt_cache_key'), false);
      for (const prompt_cache_key of ['', suppliedCacheKey]) {
        const f = cacheKeyFixture(kind);
        const response = await f.handler(f.request(base, { prompt_cache_key }));
        assert.equal(response.status, 502);
        assert.equal(f.counts().secrets, 0);
        assert.doesNotMatch(await response.text(), /private|forged|fixture-.*key/u);
        cacheKeyPrivacy(f);
        for (const functions of [false, true])
          await assert.rejects(() => f.stream(functions, { prompt_cache_key }));
        assert.equal(f.counts().secrets, 0);
      }
    }
  });
}
for (const kind of ['openai', 'openrouter'] as const) {
  for (const stream of [false, true])
    test(`${kind} stream=${stream}: mutable caller prompt_cache_key is captured once before secrets`, async () => {
      let reads = 0;
      const fields = {
        get prompt_cache_key() {
          reads++;
          return reads === 1 ? suppliedCacheKey : { private: 'changed' };
        },
      };
      const f = cacheKeyFixture(kind, {
        stream,
        mutate: () => {
          assert.equal(reads, 1);
        },
      });
      if (stream) {
        Object.defineProperty(fields, 'tools', { enumerable: true, value: probabilityTools });
        await f.stream(true, fields);
      } else await f.call(fields);
      assert.equal(f.sent[0]?.prompt_cache_key, suppliedCacheKey);
      assert.equal(reads, 1);
    });
  test(`${kind}: cache key metadata preserves sanitized transport failure accounting`, async () => {
    const f = cacheKeyFixture(kind, { transportFails: true });
    const response = await f.handler(f.request('/api/v1', { prompt_cache_key: suppliedCacheKey }));
    assert.equal(response.status, 502);
    assert.equal(f.counts().secrets, 1);
    assert.equal(f.records[0]?.outcome, 'failed');
    assert.doesNotMatch(await response.text(), /private|forged|fixture-.*key/u);
    cacheKeyPrivacy(f);
  });
  test(`${kind}: throwing prompt_cache_key accessors fail with fixed errors before credentials`, async () => {
    for (const stream of [false, true]) {
      const f = cacheKeyFixture(kind, { stream });
      const fields = {
        get prompt_cache_key() {
          throw new Error('private supplied cache key');
        },
      };
      await assert.rejects(
        () => (stream ? f.stream(false, fields) : f.call(fields)),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.doesNotMatch(error.message, /private|supplied/u);
          return true;
        },
      );
      assert.equal(f.counts().secrets, 0);
    }
  });
}
