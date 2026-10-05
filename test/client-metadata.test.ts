import assert from 'node:assert/strict';
import test from 'node:test';
import { metadataFixture, metadataPrivacy, suppliedMetadata } from './client-metadata-fixture.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';

const bases = ['/v1', '/api/v1'];
const boundaryMap = Object.fromEntries(
  Array.from({ length: 16 }, (_, i) => [String(i).padStart(64, 'k'), 'v'.repeat(512)]),
);
const specialMap = JSON.parse(
  '{"__proto__":"private prototype tag","constructor":"private constructor tag","":""," Whitespace ":"  CaseSensitive  "}',
);
const values = [
  undefined,
  {},
  suppliedMetadata,
  boundaryMap,
  specialMap,
  { ['💡'.repeat(64)]: '💡'.repeat(512) },
];
const invalid = [
  null,
  false,
  0,
  '',
  [],
  { private: null },
  { private: 1 },
  { private: {} },
  { private: ['private'] },
  Object.fromEntries(Array.from({ length: 17 }, (_, i) => [String(i), 'private'])),
  { ['k'.repeat(65)]: 'private' },
  { private: 'v'.repeat(513) },
  { ['💡'.repeat(65)]: 'private' },
  { private: '💡'.repeat(513) },
];

for (const kind of ['openai', 'openrouter'] as const)
  for (const stream of [false, true])
    for (const mode of ['text', 'refusal', 'function'] as const) {
      const controls = {
        ...(stream ? { stream: true } : {}),
        ...(mode === 'function' ? { tools: probabilityTools } : {}),
      };
      test(`${kind} ${mode} stream=${stream}: bounded exact metadata and omission survive both bases`, async () => {
        for (const base of bases)
          for (const metadata of values) {
            const f = metadataFixture(kind, { stream, mode });
            const response = await f.handler(
              f.request(base, { ...controls, ...(metadata === undefined ? {} : { metadata }) }),
            );
            assert.equal(response.status, 200);
            const body = await response.text();
            assert.doesNotMatch(body, /supplied metadata|forged principal|prototype tag/u);
            if (stream) assert.ok(body.endsWith('data: [DONE]\n\n'));
            assert.deepEqual(f.sent[0]?.metadata, metadata);
            assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'metadata'), metadata !== undefined);
            assert.equal(f.sent[0]?.model, 'upstream-model');
            if (kind === 'openrouter')
              assert.deepEqual(f.sent[0]?.provider, { only: ['provider'] });
            assert.equal(f.records[0]?.usage.totalTokens, 3);
            assert.equal(f.records[0]?.outcome, 'succeeded');
            assert.equal(Object.hasOwn(Object.prototype, 'private'), false);
            metadataPrivacy(f);
          }
      });
      test(`${kind} ${mode} stream=${stream}: caller tags retain all authorization and delivery gates`, async () => {
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
            const f = metadataFixture(kind, { stream, mode, gate });
            const response = await f.handler(
              f.request(base, { ...controls, metadata: suppliedMetadata }),
            );
            assert.equal(
              response.status,
              stream && (gate === 'audit' || gate === 'usage') ? 200 : status,
              gate,
            );
            assert.doesNotMatch(
              await response.text(),
              /supplied metadata|forged principal|forged credential|unapproved model|fixture-.*key|\[DONE\]/u,
            );
            assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0, gate);
            metadataPrivacy(f);
          }
      });
      test(`${kind} ${mode} stream=${stream}: metadata never supplies missing usage`, async () => {
        const f = metadataFixture(kind, { stream, mode, missingUsage: true });
        const response = await f.handler(
          f.request('/api/v1', { ...controls, metadata: suppliedMetadata }),
        );
        assert.equal(response.status, 200);
        assert.doesNotMatch(await response.text(), /supplied metadata/u);
        assert.equal(f.records[0]?.usage.status, 'missing');
        assert.equal(f.records[0]?.usage.totalTokens, null);
        metadataPrivacy(f);
      });
    }
for (const kind of ['openai', 'openrouter', 'anthropic', 'google'] as const)
  for (const stream of [false, true])
    test(`${kind} stream=${stream}: malformed/beyond-bound metadata fails before routes or secrets`, async () => {
      for (const base of bases)
        for (const metadata of invalid) {
          const f = metadataFixture(kind, { stream });
          const response = await f.handler(
            f.request(base, { metadata, ...(stream ? { stream: true } : {}) }),
          );
          assert.equal(response.status, 400);
          assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
          assert.equal(f.records.length, 0);
          assert.doesNotMatch(await response.text(), /private|forged|fixture-.*key/u);
          metadataPrivacy(f);
        }
      for (const metadata of [...invalid, new Date(), Object.create({ private: 'inherited' })]) {
        const f = metadataFixture(kind, { stream });
        await assert.rejects(
          () => (stream ? f.stream(false, { metadata }) : f.call({ metadata })),
          (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.doesNotMatch(error.message, /private|forged/u);
            return true;
          },
        );
        assert.equal(f.counts().secrets, 0);
      }
    });
for (const kind of ['anthropic', 'google'] as const)
  test(`${kind}: supplied maps reject before credentials without native translation`, async () => {
    for (const metadata of [{}, suppliedMetadata])
      for (const stream of [false, true]) {
        const f = metadataFixture(kind, { stream });
        await assert.rejects(() => (stream ? f.stream(false, { metadata }) : f.call({ metadata })));
        assert.equal(f.counts().secrets, 0);
        assert.equal(f.sent.length, 0);
      }
    for (const base of bases) {
      const f = metadataFixture(kind);
      const response = await f.handler(f.request(base, {}));
      assert.equal(response.status, 200);
      assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'metadata'), false);
      assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'labels'), false);
      metadataPrivacy(f);
    }
  });
for (const kind of ['openai', 'openrouter'] as const) {
  for (const stream of [false, true]) {
    test(`${kind} stream=${stream}: top-level and nested accessors capture once before mutable secret awaits`, async () => {
      let rootReads = 0,
        valueReads = 0;
      const metadata: Record<string, unknown> = Object.create(null);
      Object.defineProperty(metadata, 'private nested', {
        enumerable: true,
        configurable: true,
        get() {
          valueReads++;
          return valueReads === 1 ? 'private original' : 42;
        },
      });
      const fields = {
        get metadata() {
          rootReads++;
          return rootReads === 1 ? metadata : null;
        },
      };
      const f = metadataFixture(kind, {
        stream,
        mutate: () => {
          assert.equal(rootReads, 1);
          assert.equal(valueReads, 1);
          Object.defineProperty(metadata, 'private nested', {
            value: 'private changed',
            enumerable: true,
          });
          metadata.private = 'private late key';
        },
      });
      if (stream) {
        Object.defineProperty(fields, 'tools', { enumerable: true, value: probabilityTools });
        await f.stream(true, fields);
      } else await f.call(fields);
      assert.deepEqual(f.sent[0]?.metadata, { 'private nested': 'private original' });
      assert.equal(rootReads, 1);
      assert.equal(valueReads, 1);
      metadataPrivacy(f);
    });
    test(`${kind} stream=${stream}: throwing root/nested getters fail safely before credentials`, async () => {
      for (const fields of [
        {
          get metadata() {
            throw Error('private root');
          },
        },
        {
          metadata: {
            get private() {
              throw Error('private nested');
            },
          },
        },
      ]) {
        const f = metadataFixture(kind, { stream });
        await assert.rejects(
          () => (stream ? f.stream(false, fields) : f.call(fields)),
          (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.doesNotMatch(error.message, /private|nested|root/u);
            return true;
          },
        );
        assert.equal(f.counts().secrets, 0);
      }
    });
    test(`${kind} stream=${stream}: user/cache fields and tag identity are independent`, async () => {
      const f = metadataFixture(kind, { stream });
      const response = await f.handler(
        f.request('/api/v1', {
          metadata: suppliedMetadata,
          user: 'private end-user',
          prompt_cache_key: 'private cache key',
          ...(stream ? { stream: true } : {}),
        }),
      );
      assert.equal(response.status, 200);
      assert.doesNotMatch(
        await response.text(),
        /supplied metadata|forged principal|forged credential|private end-user|private cache key/u,
      );
      assert.deepEqual(f.sent[0]?.metadata, suppliedMetadata);
      assert.equal(f.sent[0]?.user, 'private end-user');
      assert.equal(f.sent[0]?.prompt_cache_key, 'private cache key');
      assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'store'), false);
      assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'trace'), false);
      metadataPrivacy(f);
    });
  }
  test(`${kind}: opened transport failure keeps safe possibly-billed missing accounting`, async () => {
    const f = metadataFixture(kind, { transportFails: true });
    const response = await f.handler(f.request('/api/v1', { metadata: suppliedMetadata }));
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /private|forged|fixture-.*key/u);
    assert.equal(f.records[0]?.outcome, 'failed');
    assert.equal(f.records[0]?.possiblyBilled, true);
    metadataPrivacy(f);
  });
}
