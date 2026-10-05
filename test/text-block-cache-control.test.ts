import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { snapshotChatMessages } from '../src/gateway/chat-messages.ts';
import { prepareAnthropicMessages } from '../src/providers/anthropic-client-functions.ts';
import { prepareGoogleMessages } from '../src/providers/google-client-functions.ts';
import { nativeCacheUsage } from './anthropic-cache-usage-fixture.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';
import {
  blockFixture,
  blockHistory,
  blockParts,
  blockPrivacy,
  delegatedBlockHistory,
  expectedNativeHistory,
  expectedSystem,
} from './text-block-cache-control-fixture.ts';

const bases = ['/v1', '/api/v1'];
const messages = (content: unknown) => [{ role: 'user', content }];
for (const kind of ['anthropic', 'openrouter'] as const)
  for (const stream of [false, true])
    for (const mode of ['text', 'refusal', 'function'] as const) {
      const history = kind === 'anthropic' ? blockHistory : delegatedBlockHistory;
      const fields = {
        messages: history,
        stream,
        ...(mode === 'function' ? { tools: probabilityTools } : {}),
      };
      test(
        kind +
          ' ' +
          mode +
          ' stream=' +
          stream +
          ': exact text blocks preserve native/delegated history and both bases',
        async () => {
          for (const base of bases) {
            const f = blockFixture(kind, { stream, mode });
            const r = await f.handler(f.request(base, fields));
            assert.equal(r.status, 200);
            const body = await r.text();
            assert.doesNotMatch(body, /cache_control|ephemeral|private prefix|changing suffix/u);
            if (stream) assert.ok(body.endsWith('data: [DONE]\n\n'));
            assert.deepEqual(
              f.sent[0]?.messages,
              kind === 'anthropic' ? expectedNativeHistory : history,
            );
            if (kind === 'anthropic') assert.deepEqual(f.sent[0]?.system, expectedSystem);
            assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'cache_control'), false);
            assert.equal(f.records[0]?.usage.totalTokens, 3);
            blockPrivacy(f);
          }
        },
      );
      test(
        kind +
          ' ' +
          mode +
          ' stream=' +
          stream +
          ': block boundaries retain authentication/Deny/limits/persistence',
        async () => {
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
              const f = blockFixture(kind, { stream, mode, gate });
              const r = await f.handler(f.request(base, fields));
              assert.equal(
                r.status,
                stream && (gate === 'audit' || gate === 'usage') ? 200 : status,
              );
              assert.doesNotMatch(
                await r.text(),
                /cache_control|ephemeral|private prefix|fixture-.*key|\[DONE\]/u,
              );
              assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0);
              blockPrivacy(f);
            }
        },
      );
      test(
        kind +
          ' ' +
          mode +
          ' stream=' +
          stream +
          ': requested block caching never manufactures missing usage',
        async () => {
          const f = blockFixture(kind, { stream, mode, missingUsage: true });
          const r = await f.handler(f.request('/api/v1', fields));
          assert.equal(r.status, 200);
          await r.text();
          assert.equal(f.records[0]?.usage.status, 'missing');
          assert.equal(f.records[0]?.usage.totalTokens, null);
          blockPrivacy(f);
        },
      );
    }
const invalid = [
  null,
  1,
  'private',
  [],
  {},
  { type: 'private' },
  { type: 'ephemeral', ttl: null },
  { type: 'ephemeral', ttl: '30m' },
  { type: 'ephemeral', private: 'forged' },
];
for (const kind of ['openai', 'anthropic', 'google', 'openrouter'] as const)
  for (const stream of [false, true])
    test(
      kind + ' stream=' + stream + ': invalid block directive rejects before routes or secrets',
      async () => {
        for (const cache_control of invalid)
          for (const base of bases) {
            const f = blockFixture(kind, { stream });
            const r = await f.handler(
              f.request(base, {
                stream,
                messages: messages([{ type: 'text', text: 'private', cache_control }]),
              }),
            );
            assert.equal(r.status, 400);
            assert.deepEqual(f.counts(), { routes: 0, secrets: 0 });
            assert.doesNotMatch(await r.text(), /private|forged|ephemeral/u);
          }
        for (const cache_control of [
          ...invalid,
          new Date(),
          Object.create({ type: 'ephemeral' }),
        ]) {
          const f = blockFixture(kind, { stream });
          const fields = { messages: messages([{ type: 'text', text: 'private', cache_control }]) };
          await assert.rejects(() => (stream ? f.stream(false, fields) : f.call(fields)));
          assert.equal(f.counts().secrets, 0);
        }
      },
    );
for (const kind of ['anthropic', 'openrouter'] as const)
  for (const stream of [false, true]) {
    test(
      kind + ' stream=' + stream + ': exact omitted/5m/1h TTL and unchanged unmarked strings',
      async () => {
        for (const ttl of [undefined, '5m', '1h'] as const)
          for (const base of bases) {
            const content = [
              {
                type: 'text',
                text: ' private 思考 ',
                cache_control: { type: 'ephemeral', ...(ttl ? { ttl } : {}) },
              },
              { type: 'text', text: '' },
            ];
            const f = blockFixture(kind, { stream });
            const r = await f.handler(f.request(base, { stream, messages: messages(content) }));
            assert.equal(r.status, 200);
            await r.text();
            assert.deepEqual(f.sent[0]?.messages, messages(content));
            blockPrivacy(f);
          }
        const f = blockFixture(kind, { stream });
        const r = await f.handler(
          f.request('/v1', {
            stream,
            messages: messages([
              { type: 'text', text: 'private A' },
              { type: 'text', text: ' B' },
            ]),
          }),
        );
        assert.equal(r.status, 200);
        await r.text();
        assert.deepEqual(f.sent[0]?.messages, messages('private A B'));
      },
    );
    test(
      kind +
        ' stream=' +
        stream +
        ': four markers and ordered mixed TTL succeed; five or reversed TTL reject',
      async () => {
        for (const [ttls, status] of [
          [['1h', '1h', '5m', undefined], 200],
          [['1h', '1h', '1h', '1h', '1h'], 400],
          [['5m', '1h'], 400],
          [[undefined, '1h'], 400],
        ] as const) {
          const input = ttls.map((ttl) => ({
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'private',
                cache_control: { type: 'ephemeral', ...(ttl ? { ttl } : {}) },
              },
            ],
          }));
          const f = blockFixture(kind, { stream });
          const r = await f.handler(f.request('/api/v1', { stream, messages: input }));
          assert.equal(r.status, status);
          await r.text();
          if (status === 400) assert.deepEqual(f.counts(), { routes: 0, secrets: 0 });
          else assert.deepEqual(f.sent[0]?.messages, input);
        }
      },
    );
    test(
      kind +
        ' stream=' +
        stream +
        ': 128 parts preserve order and 129/sparse/rich/refusal/prediction/empty marked reject',
      async () => {
        for (const length of [128, 129]) {
          const parts = Array.from({ length }, (_, i) => ({
            type: 'text',
            text: 'private ' + i,
            ...(i === 0 ? { cache_control: { type: 'ephemeral' } } : {}),
          }));
          const f = blockFixture(kind, { stream });
          const r = await f.handler(f.request('/v1', { stream, messages: messages(parts) }));
          assert.equal(r.status, length === 128 ? 200 : 400);
          await r.text();
          if (length === 128) assert.deepEqual(f.sent[0]?.messages, messages(parts));
          else assert.equal(f.counts().secrets, 0);
        }
        for (const content of [
          [null, blockParts[0]],
          [{ ...blockParts[0], type: 'image' }],
          [{ ...blockParts[0], extra: 'private' }],
          [{ ...blockParts[0], text: '' }],
          [{ type: 'refusal', refusal: 'private', cache_control: { type: 'ephemeral' } }],
        ]) {
          const f = blockFixture(kind, { stream });
          const r = await f.handler(f.request('/v1', { stream, messages: messages(content) }));
          assert.equal(r.status, 400);
          assert.equal(f.counts().secrets, 0);
        }
        const f = blockFixture(kind, { stream });
        const r = await f.handler(
          f.request('/v1', {
            stream,
            messages: messages('private'),
            prediction: { type: 'content', content: blockParts },
          }),
        );
        assert.equal(r.status, 400);
        assert.equal(f.counts().secrets, 0);
      },
    );
    test(
      kind +
        ' stream=' +
        stream +
        ': invalid final TTL and unverified format combinations reject before routes/secrets',
      async () => {
        for (const fields of [
          { cache_control: { type: 'ephemeral' }, messages: messages([blockParts[0]]) },
          { prompt_cache_options: { mode: 'explicit' } },
          {
            messages: [
              ...messages(blockParts),
              ...messages([
                { type: 'text', text: 'private', prompt_cache_breakpoint: { mode: 'explicit' } },
              ]),
            ],
          },
          {
            messages: messages([
              { ...blockParts[0], prompt_cache_breakpoint: { mode: 'explicit' } },
            ]),
          },
        ]) {
          const f = blockFixture(kind, { stream });
          const input = { messages: messages(blockParts), ...fields };
          const r = await f.handler(f.request('/api/v1', { stream, ...input }));
          assert.equal(r.status, 400);
          assert.deepEqual(f.counts(), { routes: 0, secrets: 0 });
          await assert.rejects(() => (stream ? f.stream(false, input) : f.call(input)));
          assert.equal(f.counts().secrets, 0);
        }
      },
    );
    test(
      kind +
        ' stream=' +
        stream +
        ': single directive/root/part/type/text/TTL capture survives credential mutation',
      async () => {
        let roots = 0,
          indices = 0,
          types = 0,
          texts = 0,
          directives = 0,
          ctypes = 0,
          ttls = 0;
        const cache = Object.defineProperties(
          {},
          {
            type: {
              enumerable: true,
              configurable: true,
              get() {
                ctypes++;
                return ctypes === 1 ? 'ephemeral' : 'private';
              },
            },
            ttl: {
              enumerable: true,
              configurable: true,
              get() {
                ttls++;
                return ttls === 1 ? '1h' : 'private';
              },
            },
          },
        );
        const p = Object.defineProperties(
          {},
          {
            type: {
              enumerable: true,
              get() {
                types++;
                return 'text';
              },
            },
            text: {
              enumerable: true,
              configurable: true,
              get() {
                texts++;
                return texts === 1 ? 'private captured' : 'late';
              },
            },
            cache_control: {
              enumerable: true,
              get() {
                directives++;
                return cache;
              },
            },
          },
        );
        const parts = Object.defineProperty([p], '0', {
          enumerable: true,
          get() {
            indices++;
            return p;
          },
        });
        const fields = {
          get messages() {
            roots++;
            return messages(parts);
          },
        };
        const f = blockFixture(kind, {
          stream,
          mutate: () => {
            assert.deepEqual(
              [roots, indices, types, texts, directives, ctypes, ttls],
              [1, 1, 1, 1, 1, 1, 1],
            );
            Object.defineProperty(cache, 'ttl', { value: 'private', enumerable: true });
            Object.defineProperty(p, 'text', { value: 'private mutation', enumerable: true });
            parts.push('late');
          },
        });
        if (stream) await f.stream(false, fields);
        else await f.call(fields);
        assert.deepEqual(
          f.sent[0]?.messages,
          messages([
            {
              type: 'text',
              text: 'private captured',
              cache_control: { type: 'ephemeral', ttl: '1h' },
            },
          ]),
        );
        blockPrivacy(f);
      },
    );
    test(
      kind + ' stream=' + stream + ': throwing private cache accessors fail safely before secrets',
      async () => {
        for (const member of ['cache_control', 'type', 'ttl']) {
          const cache = { type: 'ephemeral', ttl: '1h' },
            part = { type: 'text', text: 'private', cache_control: cache };
          Object.defineProperty(member === 'cache_control' ? part : cache, member, {
            enumerable: true,
            get() {
              throw Error('private ' + member);
            },
          });
          const f = blockFixture(kind, { stream });
          const input = { messages: messages([part]) };
          await assert.rejects(
            () => (stream ? f.stream(false, input) : f.call(input)),
            (e: unknown) => {
              assert.ok(e instanceof Error);
              assert.doesNotMatch(e.message, /private|ttl|ephemeral/u);
              return true;
            },
          );
          assert.equal(f.counts().secrets, 0);
        }
      },
    );
    test(
      kind + ' stream=' + stream + ': opened failures retain possibly-billed accounting',
      async () => {
        const f = blockFixture(kind, { stream, transportFails: true });
        const r = await f.handler(f.request('/api/v1', { stream, messages: messages(blockParts) }));
        assert.equal(r.status, 502);
        assert.doesNotMatch(await r.text(), /cache_control|private|ephemeral/u);
        assert.equal(f.records[0]?.possiblyBilled, true);
        assert.equal(f.records[0]?.outcome, 'failed');
        blockPrivacy(f);
      },
    );
  }
for (const kind of ['openai', 'google'] as const)
  test(kind + ': block directives reject before secrets without format conversion', async () => {
    for (const stream of [false, true]) {
      const f = blockFixture(kind, { stream });
      const fields = { messages: messages(blockParts) };
      await assert.rejects(() => (stream ? f.stream(false, fields) : f.call(fields)));
      assert.equal(f.counts().secrets, 0);
      assert.equal(f.sent.length, 0);
    }
  });
test('native Anthropic rejects nested tool-result directives before secrets', async () => {
  for (const stream of [false, true]) {
    const f = blockFixture('anthropic', { stream });
    const fields = { messages: delegatedBlockHistory };
    await assert.rejects(() => (stream ? f.stream(true, fields) : f.call(fields)));
    assert.equal(f.counts().secrets, 0);
    assert.equal(f.sent.length, 0);
  }
});
test('native converters preserve supported assistant blocks and reject inequivalent arrays', () => {
  const captured = snapshotChatMessages(blockHistory);
  assert.deepEqual(
    JSON.parse(JSON.stringify(prepareAnthropicMessages(captured.slice(2)))),
    expectedNativeHistory,
  );
  assert.throws(() => prepareGoogleMessages(captured));
  assert.throws(() =>
    prepareAnthropicMessages(snapshotChatMessages(delegatedBlockHistory).slice(2)),
  );
});
for (const stream of [false, true])
  test(
    'Anthropic stream=' + stream + ': block preferences preserve reported-only cache usage',
    async () => {
      const f = blockFixture('anthropic', { stream, nativeUsage: nativeCacheUsage });
      const r = await f.handler(f.request('/api/v1', { stream, messages: messages(blockParts) }));
      assert.equal(r.status, 200);
      await r.text();
      assert.equal(f.records[0]?.usage.promptTokens, 12);
      assert.equal(f.records[0]?.usage.totalTokens, 14);
      blockPrivacy(f);
    },
  );
for (const kind of ['anthropic', 'openrouter'] as const)
  for (const mode of ['text', 'function'] as const)
    test(kind + ' ' + mode + ': public cancellation retains safe accounting', {
      timeout: 3000,
    }, async () => {
      for (const base of bases) {
        const f = blockFixture(kind, { stream: true, mode });
        let done: () => void = () => {};
        const interrupted = new Promise<void>((r) => {
          done = r;
        });
        const handler = createChatHandler({
          ...f.ports,
          writeAudit: async (e) => {
            await f.ports.writeAudit(e);
            if (e.kind === 'stream-interrupted') done();
          },
        });
        const r = await handler(
          f.request(base, {
            stream: true,
            messages: messages(blockParts),
            ...(mode === 'function' ? { tools: probabilityTools } : {}),
          }),
        );
        assert.equal(r.status, 200);
        const reader = r.body?.getReader();
        assert.ok(reader);
        assert.equal((await reader.read()).done, false);
        await reader.cancel('private cancellation');
        await interrupted;
        assert.equal(f.records[0]?.outcome, 'failed');
        assert.equal(f.records[0]?.possiblyBilled, true);
        blockPrivacy(f);
      }
    });

for (const sendPrompt of [false, true])
  test(`block input preserves Jev opt-in plain-text disclosure sendPrompt=${sendPrompt}`, async () => {
    for (const base of bases) {
      const f = blockFixture('anthropic');
      const bodies: unknown[] = [];
      const route = await f.ports.resolveRoute('chat');
      assert.ok(route);
      const handler = createChatHandler({
        ...f.ports,
        resolveRoute: async () => ({
          ...route,
          jev: { credentialRef: 'secret/jev', minimumConfidence: 0.6, sendPrompt },
        }),
        resolveSecret: async () => 'fixture-jev-key',
        fetchJev: async (_url, init) => {
          const body: unknown = JSON.parse(String(init.body));
          bodies.push(body);
          return {
            ok: true,
            json: async () => ({
              model: 'jev-1',
              answers: { route: { type: 'choice', choice: 'candidate', confidence: 0.9 } },
            }),
          };
        },
      });
      const r = await handler(f.request(base, { messages: blockHistory }));
      assert.equal(r.status, 200);
      await r.text();
      assert.equal(bodies.length, 1);
      const serialized = JSON.stringify(bodies[0]);
      assert.doesNotMatch(serialized, /cache_control|\[object Object\]/u);
      if (sendPrompt) assert.ok(serialized.includes('private prefix'));
      else assert.doesNotMatch(serialized, /private prefix|changing suffix/u);
      assert.deepEqual(f.sent[0]?.messages, expectedNativeHistory);
      assert.deepEqual(f.sent[0]?.system, expectedSystem);
      blockPrivacy(f);
    }
  });

for (const kind of ['anthropic', 'openrouter'] as const)
  test(
    kind + ': developer-marked instruction keeps boundaries and prior newline text view',
    async () => {
      for (const base of bases) {
        const history = [
          { role: 'system', content: 'private system' },
          { role: 'developer', content: blockParts },
          { role: 'user', content: 'private question' },
        ];
        const f = blockFixture(kind);
        const r = await f.handler(f.request(base, { messages: history }));
        assert.equal(r.status, 200);
        await r.text();
        if (kind === 'anthropic') {
          assert.deepEqual(f.sent[0]?.system, [
            { type: 'text', text: 'private system' },
            { type: 'text', text: '\n' },
            ...blockParts,
          ]);
          assert.deepEqual(f.sent[0]?.messages, [{ role: 'user', content: 'private question' }]);
        } else assert.deepEqual(f.sent[0]?.messages, history);
        blockPrivacy(f);
      }
    },
  );
