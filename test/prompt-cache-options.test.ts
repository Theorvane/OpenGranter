import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';
import {
  cacheOptionsFixture,
  cacheOptionsPrivacy,
  suppliedCacheOptions,
} from './prompt-cache-options-fixture.ts';

const bases = ['/v1', '/api/v1'];
const valid = [
  undefined,
  null,
  { mode: 'explicit' },
  { mode: 'explicit', ttl: null },
  suppliedCacheOptions,
];
const invalid = [
  '',
  false,
  0,
  [],
  {},
  { mode: 'private' },
  { mode: 'implicit' },
  { mode: 'explicit', ttl: 5 },
  { mode: 'explicit', ttl: '24h' },
  { mode: 'explicit', ttl: '' },
  { mode: 'explicit', private: 'forged' },
];
for (const kind of ['openrouter', 'openai'] as const)
  for (const stream of [false, true])
    for (const mode of ['text', 'refusal', 'function'] as const) {
      const controls = {
        ...(stream ? { stream: true } : {}),
        ...(mode === 'function' ? { tools: probabilityTools } : {}),
      };
      test(`${kind} ${mode} stream=${stream}: exact optional explicit cache options survives both bases`, async () => {
        for (const base of bases)
          for (const prompt_cache_options of valid) {
            const f = cacheOptionsFixture(kind, { stream, mode });
            const response = await f.handler(
              f.request(base, {
                ...controls,
                ...(prompt_cache_options === undefined ? {} : { prompt_cache_options }),
              }),
            );
            assert.equal(response.status, 200);
            const body = await response.text();
            assert.doesNotMatch(body, /prompt_cache_options|explicit|"ttl"/u);
            if (stream) assert.ok(body.endsWith('data: [DONE]\n\n'));
            assert.deepEqual(
              f.sent[0]?.prompt_cache_options,
              prompt_cache_options == null
                ? undefined
                : {
                    mode: 'explicit',
                    ...(prompt_cache_options.ttl == null ? {} : { ttl: prompt_cache_options.ttl }),
                  },
            );
            assert.equal(
              Object.hasOwn(f.sent[0] ?? {}, 'prompt_cache_options'),
              prompt_cache_options != null,
            );
            assert.equal(f.sent[0]?.model, 'upstream-model');
            if (kind === 'openrouter')
              assert.deepEqual(f.sent[0]?.provider, { only: ['provider'] });
            assert.equal(f.records[0]?.outcome, 'succeeded');
            assert.equal(f.records[0]?.usage.totalTokens, 3);
            cacheOptionsPrivacy(f);
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
            const f = cacheOptionsFixture(kind, { stream, mode, gate });
            const response = await f.handler(
              f.request(base, { ...controls, prompt_cache_options: suppliedCacheOptions }),
            );
            assert.equal(
              response.status,
              stream && (gate === 'audit' || gate === 'usage') ? 200 : status,
              gate,
            );
            assert.doesNotMatch(
              await response.text(),
              /prompt_cache_options|explicit|"ttl"|fixture-.*key|\[DONE\]/u,
            );
            assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0, gate);
            cacheOptionsPrivacy(f);
          }
      });
      test(`${kind} ${mode} stream=${stream}: requesting caching cannot manufacture absent usage`, async () => {
        const f = cacheOptionsFixture(kind, { stream, mode, missingUsage: true });
        const response = await f.handler(
          f.request('/api/v1', { ...controls, prompt_cache_options: suppliedCacheOptions }),
        );
        assert.equal(response.status, 200);
        assert.doesNotMatch(await response.text(), /prompt_cache_options|explicit|"ttl"/u);
        assert.equal(f.records[0]?.usage.status, 'missing');
        assert.equal(f.records[0]?.usage.totalTokens, null);
        cacheOptionsPrivacy(f);
      });
    }
for (const kind of ['openai', 'openrouter', 'anthropic', 'google'] as const)
  for (const stream of [false, true])
    test(`${kind} stream=${stream}: malformed cache controls reject before routes/secrets`, async () => {
      for (const base of bases)
        for (const prompt_cache_options of invalid) {
          const f = cacheOptionsFixture(kind, { stream });
          const response = await f.handler(
            f.request(base, { prompt_cache_options, ...(stream ? { stream: true } : {}) }),
          );
          assert.equal(response.status, 400);
          assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
          assert.doesNotMatch(await response.text(), /private|forged|explicit|fixture-.*key/u);
          cacheOptionsPrivacy(f);
        }
      for (const prompt_cache_options of [
        ...invalid,
        new Date(),
        Object.create({ mode: 'explicit' }),
      ]) {
        const f = cacheOptionsFixture(kind, { stream });
        await assert.rejects(
          () =>
            stream ? f.stream(false, { prompt_cache_options }) : f.call({ prompt_cache_options }),
          (e: unknown) => {
            assert.ok(e instanceof Error);
            assert.doesNotMatch(e.message, /private|forged/u);
            return true;
          },
        );
        assert.equal(f.counts().secrets, 0);
      }
    });
for (const kind of ['anthropic', 'google'] as const)
  test(`${kind}: supplied options reject before secrets without native cache substitutions`, async () => {
    for (const stream of [false, true])
      for (const prompt_cache_options of valid.slice(2)) {
        const f = cacheOptionsFixture(kind, { stream });
        await assert.rejects(() =>
          stream ? f.stream(false, { prompt_cache_options }) : f.call({ prompt_cache_options }),
        );
        assert.equal(f.counts().secrets, 0);
        assert.equal(f.sent.length, 0);
      }
    for (const base of bases) {
      const f = cacheOptionsFixture(kind);
      const response = await f.handler(f.request(base));
      assert.equal(response.status, 200);
      await response.text();
      assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'prompt_cache_options'), false);
      assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'cachedContent'), false);
      cacheOptionsPrivacy(f);
    }
  });
for (const kind of ['openrouter', 'openai'] as const) {
  for (const stream of [false, true]) {
    test(`${kind} stream=${stream}: options root/mode/TTL snapshots survive mutation before credentials`, async () => {
      let roots = 0,
        modes = 0,
        ttls = 0;
      const directive: Record<string, unknown> = Object.create(null);
      Object.defineProperties(directive, {
        mode: {
          enumerable: true,
          configurable: true,
          get() {
            modes++;
            return modes === 1 ? 'explicit' : 'private';
          },
        },
        ttl: {
          enumerable: true,
          configurable: true,
          get() {
            ttls++;
            return ttls === 1 ? '30m' : null;
          },
        },
      });
      const fields = {
        get prompt_cache_options() {
          roots++;
          return roots === 1 ? directive : null;
        },
      };
      const f = cacheOptionsFixture(kind, {
        stream,
        mode: 'function',
        mutate: () => {
          assert.deepEqual([roots, modes, ttls], [1, 1, 1]);
          Object.defineProperties(directive, {
            mode: { value: 'private', enumerable: true },
            ttl: { value: 'private', enumerable: true },
          });
          directive.private = 'late';
        },
      });
      Object.defineProperty(fields, 'tools', { value: probabilityTools, enumerable: true });
      if (stream) await f.stream(true, fields);
      else await f.call(fields);
      assert.deepEqual(f.sent[0]?.prompt_cache_options, suppliedCacheOptions);
      assert.deepEqual([roots, modes, ttls], [1, 1, 1]);
      cacheOptionsPrivacy(f);
    });
    test(`${kind} stream=${stream}: throwing root/mode/TTL getters fail safely before secrets`, async () => {
      for (const fields of [
        {
          get prompt_cache_options() {
            throw Error('private root');
          },
        },
        {
          prompt_cache_options: {
            get mode() {
              throw Error('private type');
            },
          },
        },
        {
          prompt_cache_options: {
            mode: 'explicit',
            get ttl() {
              throw Error('private TTL');
            },
          },
        },
      ]) {
        const f = cacheOptionsFixture(kind, { stream });
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
    const f = cacheOptionsFixture(kind, { transportFails: true });
    const response = await f.handler(
      f.request('/api/v1', { prompt_cache_options: suppliedCacheOptions }),
    );
    assert.equal(response.status, 502);
    assert.doesNotMatch(
      await response.text(),
      /private|prompt_cache_options|explicit|fixture-.*key/u,
    );
    assert.equal(f.records[0]?.outcome, 'failed');
    assert.equal(f.records[0]?.possiblyBilled, true);
    cacheOptionsPrivacy(f);
  });
}
test('delegated cache options remains independent from caller attribution/cache placement/metadata', async () => {
  for (const stream of [false, true]) {
    const f = cacheOptionsFixture('openrouter', { stream });
    const response = await f.handler(
      f.request('/api/v1', {
        prompt_cache_options: suppliedCacheOptions,
        prompt_cache_key: 'private placement',
        user: 'private client',
        metadata: { prompt_cache_options: 'private arbitrary tag' },
        ...(stream ? { stream: true } : {}),
      }),
    );
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /private placement|private client|arbitrary tag/u);
    assert.deepEqual(f.sent[0]?.prompt_cache_options, suppliedCacheOptions);
    assert.equal(f.sent[0]?.prompt_cache_key, 'private placement');
    assert.equal(f.sent[0]?.user, 'private client');
    assert.deepEqual(f.sent[0]?.metadata, { prompt_cache_options: 'private arbitrary tag' });
    cacheOptionsPrivacy(f);
  }
});

for (const kind of ['openrouter', 'openai'] as const)
  for (const mode of ['text', 'function'] as const)
    test(`${kind} ${mode}: cache preference preserves body-cancellation accounting`, {
      timeout: 3000,
    }, async () => {
      for (const base of bases) {
        const f = cacheOptionsFixture(kind, { stream: true, mode });
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
            prompt_cache_options: suppliedCacheOptions,
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
        assert.deepEqual(f.sent[0]?.prompt_cache_options, suppliedCacheOptions);
        cacheOptionsPrivacy(f);
      }
    });

for (const kind of ['openai', 'openrouter'] as const)
  for (const stream of [false, true]) {
    test(`${kind} stream=${stream}: options reject unverified automatic-cache coexistence before routes and credentials`, async () => {
      for (const base of bases) {
        const f = cacheOptionsFixture(kind, { stream });
        const response = await f.handler(
          f.request(base, {
            stream,
            prompt_cache_options: suppliedCacheOptions,
            cache_control: { type: 'ephemeral' },
          }),
        );
        assert.equal(response.status, 400);
        assert.deepEqual(f.counts(), { routes: 0, secrets: 0 });
        assert.doesNotMatch(await response.text(), /explicit|30m|ephemeral/u);
      }
      const f = cacheOptionsFixture(kind, { stream });
      await assert.rejects(() =>
        stream
          ? f.stream(false, {
              prompt_cache_options: suppliedCacheOptions,
              cache_control: { type: 'ephemeral' },
            })
          : f.call({
              prompt_cache_options: suppliedCacheOptions,
              cache_control: { type: 'ephemeral' },
            }),
      );
      assert.equal(f.counts().secrets, 0);
    });
    test(`${kind} stream=${stream}: exact options preserve tool-result history and independent controls`, async () => {
      const f = cacheOptionsFixture(kind, { stream, mode: 'function' });
      const response = await f.handler(
        f.request('/api/v1', {
          stream,
          prompt_cache_options: suppliedCacheOptions,
          tools: probabilityTools,
          prompt_cache_key: 'private key',
          user: 'private user',
          metadata: { tag: 'private tag' },
          max_tokens: 10,
          messages: [
            { role: 'user', content: 'private prompt' },
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } },
              ],
            },
            { role: 'tool', tool_call_id: 'call', content: 'private result' },
          ],
        }),
      );
      assert.equal(response.status, 200);
      await response.text();
      assert.deepEqual(f.sent[0]?.prompt_cache_options, suppliedCacheOptions);
      assert.equal(f.sent[0]?.prompt_cache_key, 'private key');
      assert.equal(f.sent[0]?.max_tokens, 10);
      cacheOptionsPrivacy(f);
    });
    test(`${kind} stream=${stream}: options do not replace predicted content or fabricate cache usage`, async () => {
      const f = cacheOptionsFixture(kind, { stream });
      const prediction = { type: 'content', content: 'private expected' };
      const response = await f.handler(
        f.request('/api/v1', { stream, prompt_cache_options: suppliedCacheOptions, prediction }),
      );
      assert.equal(response.status, 200);
      assert.doesNotMatch(await response.text(), /private expected|cache_write_tokens/u);
      assert.deepEqual(f.sent[0]?.prediction, prediction);
      assert.deepEqual(f.sent[0]?.prompt_cache_options, suppliedCacheOptions);
      assert.equal(f.records[0]?.usage.totalTokens, 3);
      cacheOptionsPrivacy(f);
    });
  }

for (const kind of ['anthropic', 'google'] as const)
  test(`${kind}: nullable options preserve native HTTP defaults`, async () => {
    for (const base of bases) {
      const f = cacheOptionsFixture(kind);
      const response = await f.handler(f.request(base, { prompt_cache_options: null }));
      assert.equal(response.status, 200);
      await response.text();
      assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'prompt_cache_options'), false);
      cacheOptionsPrivacy(f);
    }
  });
for (const stream of [false, true])
  test(`delegated stream=${stream}: null options do not restrict existing automatic caching`, async () => {
    let options = 0,
      automatic = 0;
    const f = cacheOptionsFixture('openrouter', { stream });
    const fields = {
      get prompt_cache_options() {
        options++;
        return null;
      },
      get cache_control() {
        automatic++;
        return { type: 'ephemeral' };
      },
    };
    if (stream) await f.stream(false, fields);
    else await f.call(fields);
    assert.deepEqual([options, automatic], [1, 1]);
    assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'prompt_cache_options'), false);
    assert.deepEqual(f.sent[0]?.cache_control, { type: 'ephemeral' });
    cacheOptionsPrivacy(f);
  });
