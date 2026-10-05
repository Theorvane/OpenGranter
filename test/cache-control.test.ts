import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { nativeCacheUsage } from './anthropic-cache-usage-fixture.ts';
import {
  cacheControlFixture,
  cacheControlPrivacy,
  suppliedCacheControl,
} from './cache-control-fixture.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';

const bases = ['/v1', '/api/v1'];
const valid = [
  undefined,
  { type: 'ephemeral' },
  { type: 'ephemeral', ttl: '5m' },
  suppliedCacheControl,
];
const invalid = [
  null,
  '',
  false,
  0,
  [],
  {},
  { type: 'private' },
  { type: 'ephemeral', ttl: null },
  { type: 'ephemeral', ttl: 5 },
  { type: 'ephemeral', ttl: '24h' },
  { type: 'ephemeral', ttl: '' },
  { type: 'ephemeral', private: 'forged' },
];
for (const kind of ['openrouter', 'anthropic'] as const)
  for (const stream of [false, true])
    for (const mode of ['text', 'refusal', 'function'] as const) {
      const controls = {
        ...(stream ? { stream: true } : {}),
        ...(mode === 'function' ? { tools: probabilityTools } : {}),
      };
      test(`${kind} ${mode} stream=${stream}: exact optional automatic cache directive survives both bases`, async () => {
        for (const base of bases)
          for (const cache_control of valid) {
            const f = cacheControlFixture(kind, { stream, mode });
            const response = await f.handler(
              f.request(base, {
                ...controls,
                ...(cache_control === undefined ? {} : { cache_control }),
              }),
            );
            assert.equal(response.status, 200);
            const body = await response.text();
            assert.doesNotMatch(body, /cache_control|ephemeral|"ttl"/u);
            if (stream) assert.ok(body.endsWith('data: [DONE]\n\n'));
            assert.deepEqual(f.sent[0]?.cache_control, cache_control);
            assert.equal(
              Object.hasOwn(f.sent[0] ?? {}, 'cache_control'),
              cache_control !== undefined,
            );
            assert.equal(f.sent[0]?.model, 'upstream-model');
            if (kind === 'openrouter')
              assert.deepEqual(f.sent[0]?.provider, { only: ['provider'] });
            else assert.equal(f.sent[0]?.max_tokens, 128);
            assert.equal(f.records[0]?.outcome, 'succeeded');
            assert.equal(f.records[0]?.usage.totalTokens, 3);
            cacheControlPrivacy(f);
          }
      });
      test(`${kind} ${mode} stream=${stream}: cache preference retains authorization/limits/persistence gates`, async () => {
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
            const f = cacheControlFixture(kind, { stream, mode, gate });
            const response = await f.handler(
              f.request(base, { ...controls, cache_control: suppliedCacheControl }),
            );
            assert.equal(
              response.status,
              stream && (gate === 'audit' || gate === 'usage') ? 200 : status,
              gate,
            );
            assert.doesNotMatch(
              await response.text(),
              /cache_control|ephemeral|"ttl"|fixture-.*key|\[DONE\]/u,
            );
            assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0, gate);
            cacheControlPrivacy(f);
          }
      });
      test(`${kind} ${mode} stream=${stream}: requesting caching cannot manufacture absent usage`, async () => {
        const f = cacheControlFixture(kind, { stream, mode, missingUsage: true });
        const response = await f.handler(
          f.request('/api/v1', { ...controls, cache_control: suppliedCacheControl }),
        );
        assert.equal(response.status, 200);
        assert.doesNotMatch(await response.text(), /cache_control|ephemeral|"ttl"/u);
        assert.equal(f.records[0]?.usage.status, 'missing');
        assert.equal(f.records[0]?.usage.totalTokens, null);
        cacheControlPrivacy(f);
      });
    }
for (const kind of ['openai', 'openrouter', 'anthropic', 'google'] as const)
  for (const stream of [false, true])
    test(`${kind} stream=${stream}: malformed cache controls reject before routes/secrets`, async () => {
      for (const base of bases)
        for (const cache_control of invalid) {
          const f = cacheControlFixture(kind, { stream });
          const response = await f.handler(
            f.request(base, { cache_control, ...(stream ? { stream: true } : {}) }),
          );
          assert.equal(response.status, 400);
          assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
          assert.doesNotMatch(await response.text(), /private|forged|ephemeral|fixture-.*key/u);
          cacheControlPrivacy(f);
        }
      for (const cache_control of [...invalid, new Date(), Object.create({ type: 'ephemeral' })]) {
        const f = cacheControlFixture(kind, { stream });
        await assert.rejects(
          () => (stream ? f.stream(false, { cache_control }) : f.call({ cache_control })),
          (e: unknown) => {
            assert.ok(e instanceof Error);
            assert.doesNotMatch(e.message, /private|forged/u);
            return true;
          },
        );
        assert.equal(f.counts().secrets, 0);
      }
    });
for (const kind of ['openai', 'google'] as const)
  test(`${kind}: supplied directives reject before secrets without native cache substitutions`, async () => {
    for (const stream of [false, true])
      for (const cache_control of valid.slice(1)) {
        const f = cacheControlFixture(kind, { stream });
        await assert.rejects(() =>
          stream ? f.stream(false, { cache_control }) : f.call({ cache_control }),
        );
        assert.equal(f.counts().secrets, 0);
        assert.equal(f.sent.length, 0);
      }
    for (const base of bases) {
      const f = cacheControlFixture(kind);
      const response = await f.handler(f.request(base));
      assert.equal(response.status, 200);
      assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'cache_control'), false);
      assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'cachedContent'), false);
      cacheControlPrivacy(f);
    }
  });
for (const kind of ['openrouter', 'anthropic'] as const) {
  for (const stream of [false, true]) {
    test(`${kind} stream=${stream}: directive root/type/TTL snapshots survive mutation before credentials`, async () => {
      let roots = 0,
        types = 0,
        ttls = 0;
      const directive: Record<string, unknown> = Object.create(null);
      Object.defineProperties(directive, {
        type: {
          enumerable: true,
          configurable: true,
          get() {
            types++;
            return types === 1 ? 'ephemeral' : 'private';
          },
        },
        ttl: {
          enumerable: true,
          configurable: true,
          get() {
            ttls++;
            return ttls === 1 ? '1h' : null;
          },
        },
      });
      const fields = {
        get cache_control() {
          roots++;
          return roots === 1 ? directive : null;
        },
      };
      const f = cacheControlFixture(kind, {
        stream,
        mode: 'function',
        mutate: () => {
          assert.deepEqual([roots, types, ttls], [1, 1, 1]);
          Object.defineProperties(directive, {
            type: { value: 'private', enumerable: true },
            ttl: { value: 'private', enumerable: true },
          });
          directive.private = 'late';
        },
      });
      Object.defineProperty(fields, 'tools', { value: probabilityTools, enumerable: true });
      if (stream) await f.stream(true, fields);
      else await f.call(fields);
      assert.deepEqual(f.sent[0]?.cache_control, suppliedCacheControl);
      assert.deepEqual([roots, types, ttls], [1, 1, 1]);
      cacheControlPrivacy(f);
    });
    test(`${kind} stream=${stream}: throwing root/type/TTL getters fail safely before secrets`, async () => {
      for (const fields of [
        {
          get cache_control() {
            throw Error('private root');
          },
        },
        {
          cache_control: {
            get type() {
              throw Error('private type');
            },
          },
        },
        {
          cache_control: {
            type: 'ephemeral',
            get ttl() {
              throw Error('private TTL');
            },
          },
        },
      ]) {
        const f = cacheControlFixture(kind, { stream });
        await assert.rejects(
          () => (stream ? f.stream(false, fields) : f.call(fields)),
          (e: unknown) => {
            assert.ok(e instanceof Error);
            assert.doesNotMatch(e.message, /private|TTL|type|root/u);
            return true;
          },
        );
        assert.equal(f.counts().secrets, 0);
      }
    });
  }
  test(`${kind}: caching request retains sanitized opened failure accounting`, async () => {
    const f = cacheControlFixture(kind, { transportFails: true });
    const response = await f.handler(f.request('/api/v1', { cache_control: suppliedCacheControl }));
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /private|cache_control|ephemeral|fixture-.*key/u);
    assert.equal(f.records[0]?.outcome, 'failed');
    assert.equal(f.records[0]?.possiblyBilled, true);
    cacheControlPrivacy(f);
  });
}
for (const stream of [false, true])
  for (const mode of ['text', 'refusal', 'function'] as const)
    test(`Anthropic ${mode} stream=${stream}: cache-aware usage comes from reported counters alone`, async () => {
      for (const cache_control of valid) {
        const f = cacheControlFixture('anthropic', { stream, mode, nativeUsage: nativeCacheUsage });
        const response = await f.handler(
          f.request('/api/v1', {
            ...(stream ? { stream: true } : {}),
            ...(mode === 'function' ? { tools: probabilityTools } : {}),
            ...(cache_control === undefined ? {} : { cache_control }),
          }),
        );
        assert.equal(response.status, 200);
        await response.text();
        assert.equal(f.records[0]?.usage.promptTokens, 12);
        assert.equal(f.records[0]?.usage.totalTokens, 14);
        cacheControlPrivacy(f);
      }
    });
test('delegated cache directive remains independent from caller attribution/cache placement/metadata', async () => {
  for (const stream of [false, true]) {
    const f = cacheControlFixture('openrouter', { stream });
    const response = await f.handler(
      f.request('/api/v1', {
        cache_control: suppliedCacheControl,
        prompt_cache_key: 'private placement',
        user: 'private client',
        metadata: { cache_control: 'private arbitrary tag' },
        ...(stream ? { stream: true } : {}),
      }),
    );
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /private placement|private client|arbitrary tag/u);
    assert.deepEqual(f.sent[0]?.cache_control, suppliedCacheControl);
    assert.equal(f.sent[0]?.prompt_cache_key, 'private placement');
    assert.equal(f.sent[0]?.user, 'private client');
    assert.deepEqual(f.sent[0]?.metadata, { cache_control: 'private arbitrary tag' });
    cacheControlPrivacy(f);
  }
});

for (const kind of ['openrouter', 'anthropic'] as const)
  for (const mode of ['text', 'function'] as const)
    test(`${kind} ${mode}: cache preference preserves body-cancellation accounting`, {
      timeout: 3000,
    }, async () => {
      for (const base of bases) {
        const f = cacheControlFixture(kind, { stream: true, mode });
        let finish: () => void = () => {};
        const interrupted = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const writeAudit = f.ports.writeAudit;
        const handler = createChatHandler({
          ...f.ports,
          writeAudit: async (event) => {
            await writeAudit(event);
            if (event.kind === 'stream-interrupted') finish();
          },
        });
        const response = await handler(
          f.request(base, {
            stream: true,
            cache_control: suppliedCacheControl,
            ...(mode === 'function' ? { tools: probabilityTools } : {}),
          }),
        );
        assert.equal(response.status, 200);
        const reader = response.body?.getReader();
        assert.ok(reader);
        const first = await reader.read();
        assert.equal(first.done, false);
        await reader.cancel('private caller cancellation');
        await interrupted;
        assert.equal(f.records.length, 1);
        assert.equal(f.records[0]?.outcome, 'failed');
        assert.equal(f.records[0]?.possiblyBilled, true);
        assert.deepEqual(f.sent[0]?.cache_control, suppliedCacheControl);
        cacheControlPrivacy(f);
      }
    });
