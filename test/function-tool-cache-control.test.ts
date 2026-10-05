import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { snapshotFunctionTools } from '../src/gateway/chat-tools.ts';
import { prepareAnthropicFunctions } from '../src/providers/anthropic-client-functions.ts';
import { prepareGoogleFunctions } from '../src/providers/google-client-functions.ts';
import { nativeCacheUsage } from './anthropic-cache-usage-fixture.ts';
import {
  cachedTools,
  expectedNativeTools,
  toolCacheFixture,
  toolCachePrivacy,
} from './function-tool-cache-control-fixture.ts';
import {
  blockHistory,
  blockParts,
  expectedNativeHistory,
  expectedSystem,
} from './text-block-cache-control-fixture.ts';

const bases = ['/v1', '/api/v1'];
for (const kind of ['anthropic', 'openrouter'] as const)
  for (const stream of [false, true])
    for (const mode of ['text', 'refusal', 'function'] as const) {
      const fields = { stream, tools: cachedTools, messages: blockHistory };
      test(
        kind +
          ' ' +
          mode +
          ' stream=' +
          stream +
          ': cached tool and complete history map exactly across both bases',
        async () => {
          for (const base of bases) {
            const f = toolCacheFixture(kind, { stream, mode });
            const r = await f.handler(f.request(base, fields));
            assert.equal(r.status, 200);
            const body = await r.text();
            assert.doesNotMatch(body, /cache_control|private function|ephemeral/u);
            if (stream) assert.ok(body.endsWith('data: [DONE]\n\n'));
            assert.deepEqual(
              f.sent[0]?.tools,
              kind === 'anthropic' ? expectedNativeTools : cachedTools,
            );
            assert.deepEqual(
              f.sent[0]?.messages,
              kind === 'anthropic' ? expectedNativeHistory : blockHistory,
            );
            if (kind === 'anthropic') assert.deepEqual(f.sent[0]?.system, expectedSystem);
            assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'cache_control'), false);
            assert.equal(f.records[0]?.usage.totalTokens, 3);
            toolCachePrivacy(f);
          }
        },
      );
      test(
        kind +
          ' ' +
          mode +
          ' stream=' +
          stream +
          ': tool caching retains auth/IAM/Deny/limits/persistence',
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
              const f = toolCacheFixture(kind, { stream, mode, gate });
              const r = await f.handler(f.request(base, fields));
              assert.equal(
                r.status,
                stream && (gate === 'audit' || gate === 'usage') ? 200 : status,
              );
              assert.doesNotMatch(
                await r.text(),
                /cache_control|private function|fixture-.*key|\[DONE\]/u,
              );
              assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0);
              toolCachePrivacy(f);
            }
        },
      );
      test(
        kind + ' ' + mode + ' stream=' + stream + ': cache directives never fill missing usage',
        async () => {
          const f = toolCacheFixture(kind, { stream, mode, missingUsage: true });
          const r = await f.handler(f.request('/api/v1', fields));
          assert.equal(r.status, 200);
          await r.text();
          assert.equal(f.records[0]?.usage.status, 'missing');
          assert.equal(f.records[0]?.usage.totalTokens, null);
          toolCachePrivacy(f);
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
  { type: 'ephemeral', extra: 'private' },
];
for (const kind of ['openai', 'anthropic', 'google', 'openrouter'] as const)
  for (const stream of [false, true])
    test(
      kind + ' stream=' + stream + ': invalid wrapper/nested directives reject before route/secret',
      async () => {
        for (const cache_control of invalid)
          for (const base of bases) {
            const f = toolCacheFixture(kind, { stream });
            const r = await f.handler(
              f.request(base, { stream, tools: [{ ...cachedTools[0], cache_control }] }),
            );
            assert.equal(r.status, 400);
            assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
            assert.doesNotMatch(await r.text(), /private|ephemeral/u);
          }
        for (const cache_control of [
          ...invalid,
          new Date(),
          Object.create({ type: 'ephemeral' }),
        ]) {
          const f = toolCacheFixture(kind, { stream });
          const fields = { tools: [{ ...cachedTools[0], cache_control }] };
          await assert.rejects(() => (stream ? f.stream(true, fields) : f.call(fields)));
          assert.equal(f.counts().secrets, 0);
        }
        for (const fields of [
          {
            tools: [
              {
                type: 'function',
                function: { name: 'lookup', cache_control: { type: 'ephemeral' } },
              },
            ],
          },
          { tools: [{ ...cachedTools[0], type: 'custom' }] },
          { tools: [{ ...cachedTools[0], extra: 'private' }] },
        ]) {
          const f = toolCacheFixture(kind, { stream });
          const r = await f.handler(f.request('/v1', { stream, ...fields }));
          assert.equal(r.status, 400);
          assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
        }
      },
    );
for (const kind of ['anthropic', 'openrouter'] as const)
  for (const stream of [false, true]) {
    test(
      kind +
        ' stream=' +
        stream +
        ': omitted/5m/1h TTL and plain tools preserve defaults/choice/parallel',
      async () => {
        for (const ttl of [undefined, '5m', '1h'] as const)
          for (const tool_choice of ['none', 'auto', 'required'] as const) {
            const tools = [
              { ...cachedTools[0], cache_control: { type: 'ephemeral', ...(ttl ? { ttl } : {}) } },
            ];
            const f = toolCacheFixture(kind, { stream });
            const r = await f.handler(
              f.request('/api/v1', { stream, tools, tool_choice, parallel_tool_calls: false }),
            );
            assert.equal(r.status, 200);
            await r.text();
            const sent = f.sent[0];
            assert.deepEqual(
              sent?.tools,
              kind === 'anthropic'
                ? [{ ...expectedNativeTools[0], cache_control: tools[0]?.cache_control }]
                : tools,
            );
            assert.deepEqual(
              sent?.tool_choice,
              kind === 'anthropic'
                ? {
                    type: tool_choice === 'required' ? 'any' : tool_choice,
                    ...(tool_choice === 'none' ? {} : { disable_parallel_tool_use: true }),
                  }
                : tool_choice,
            );
            toolCachePrivacy(f);
          }
        const tools = cachedTools.map(({ cache_control, ...tool }) => tool);
        const f = toolCacheFixture(kind, { stream });
        const r = await f.handler(f.request('/v1', { stream, tools }));
        assert.equal(r.status, 200);
        await r.text();
        assert.doesNotMatch(JSON.stringify(f.sent), /cache_control/u);
      },
    );
    test(
      kind + ' stream=' + stream + ': complete prompt counts/order inspect tools before messages',
      async () => {
        for (const [toolTtls, messageTtls, status] of [
          [['1h', '1h'], ['5m', undefined], 200],
          [['1h', '1h', '1h'], ['1h', '1h'], 400],
          [['5m'], ['1h'], 400],
          [[undefined], ['1h'], 400],
          [['1h'], ['1h', '5m'], 200],
          [['5m', '1h'], [], 400],
        ] as const) {
          const tools = toolTtls.map((ttl, i) => ({
            ...cachedTools[0],
            function: { name: 'lookup' + i, parameters: { type: 'object' } },
            cache_control: { type: 'ephemeral', ...(ttl ? { ttl } : {}) },
          }));
          const messages = messageTtls.length
            ? messageTtls.map((ttl) => ({
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: 'private',
                    cache_control: { type: 'ephemeral', ...(ttl ? { ttl } : {}) },
                  },
                ],
              }))
            : [{ role: 'user', content: 'private' }];
          const f = toolCacheFixture(kind, { stream });
          const input = { tools, messages };
          const r = await f.handler(f.request('/api/v1', { stream, ...input }));
          assert.equal(r.status, status);
          await r.text();
          if (status === 400) {
            assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
            await assert.rejects(() => (stream ? f.stream(true, input) : f.call(input)));
            assert.equal(f.counts().secrets, 0);
          } else {
            assert.equal(f.counts().secrets, 1);
            toolCachePrivacy(f);
          }
        }
      },
    );
    test(
      kind +
        ' stream=' +
        stream +
        ': mixed root/OpenAI cache formats reject before routing/credentials',
      async () => {
        for (const extra of [
          { cache_control: { type: 'ephemeral' } },
          { prompt_cache_options: { mode: 'explicit' } },
          {
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'private', prompt_cache_breakpoint: { mode: 'explicit' } },
                ],
              },
            ],
          },
        ]) {
          const f = toolCacheFixture(kind, { stream });
          const fields = { tools: cachedTools, ...extra };
          const r = await f.handler(f.request('/v1', { stream, ...fields }));
          assert.equal(r.status, 400);
          assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
          await assert.rejects(() => (stream ? f.stream(true, fields) : f.call(fields)));
          assert.equal(f.counts().secrets, 0);
        }
      },
    );
    test(
      kind +
        ' stream=' +
        stream +
        ': tool root/wrapper/directive/type/TTL capture once before credential mutation',
      async () => {
        let roots = 0,
          wrappers = 0,
          directives = 0,
          types = 0,
          ttls = 0;
        const cache = Object.defineProperties(
          {},
          {
            type: {
              enumerable: true,
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
                return ttls === 1 ? '1h' : 'private';
              },
            },
          },
        );
        const original = cachedTools[0];
        assert.ok(original);
        const tool = { ...original, function: { ...original.function } };
        Object.defineProperty(tool, 'cache_control', {
          enumerable: true,
          get() {
            directives++;
            return cache;
          },
        });
        const tools = Object.defineProperty([tool], '0', {
          enumerable: true,
          get() {
            wrappers++;
            return tool;
          },
        });
        const fields = {
          get tools() {
            roots++;
            return tools;
          },
        };
        const f = toolCacheFixture(kind, {
          stream,
          mutate: () => {
            assert.deepEqual([roots, wrappers, directives, types, ttls], [1, 1, 1, 1, 1]);
            Object.defineProperty(cache, 'ttl', { value: 'private', enumerable: true });
            tool.function.description = 'private changed';
            tools.push(tool);
          },
        });
        if (stream) await f.stream(true, fields);
        else await f.call(fields);
        assert.deepEqual(
          f.sent[0]?.tools,
          kind === 'anthropic' ? expectedNativeTools : cachedTools,
        );
        toolCachePrivacy(f);
      },
    );
    test(
      kind + ' stream=' + stream + ': throwing private directive accessors fail safely pre-secret',
      async () => {
        for (const member of ['cache_control', 'type', 'ttl']) {
          const cache = { type: 'ephemeral', ttl: '1h' },
            tool = { ...cachedTools[0], cache_control: cache };
          Object.defineProperty(member === 'cache_control' ? tool : cache, member, {
            enumerable: true,
            get() {
              throw Error('private ' + member);
            },
          });
          const f = toolCacheFixture(kind, { stream });
          const fields = { tools: [tool] };
          await assert.rejects(
            () => (stream ? f.stream(true, fields) : f.call(fields)),
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
      kind + ' stream=' + stream + ': opened failures remain possibly billed without cache echoes',
      async () => {
        const f = toolCacheFixture(kind, { stream, transportFails: true });
        const r = await f.handler(f.request('/v1', { stream, tools: cachedTools }));
        assert.equal(r.status, 502);
        assert.doesNotMatch(await r.text(), /cache_control|private|ephemeral/u);
        assert.equal(f.records[0]?.outcome, 'failed');
        assert.equal(f.records[0]?.possiblyBilled, true);
        toolCachePrivacy(f);
      },
    );
  }
for (const kind of ['openai', 'google'] as const)
  test(kind + ': native cached tools reject before secrets without substitutes', async () => {
    for (const stream of [false, true]) {
      const f = toolCacheFixture(kind, { stream });
      const fields = { tools: cachedTools };
      await assert.rejects(() => (stream ? f.stream(true, fields) : f.call(fields)));
      assert.equal(f.counts().secrets, 0);
      assert.equal(f.sent.length, 0);
    }
  });
test('exported native function converters retain Anthropic directive and reject Gemini loss', () => {
  const captured = snapshotFunctionTools(cachedTools);
  assert.deepEqual(
    JSON.parse(JSON.stringify(prepareAnthropicFunctions(captured, undefined, undefined))),
    { tools: expectedNativeTools },
  );
  assert.throws(() => prepareGoogleFunctions(captured, undefined, undefined));
});
for (const stream of [false, true])
  test(
    'Anthropic stream=' + stream + ': cached tools retain reported-only aggregate usage',
    async () => {
      const f = toolCacheFixture('anthropic', { stream, nativeUsage: nativeCacheUsage });
      const r = await f.handler(f.request('/api/v1', { stream, tools: cachedTools }));
      assert.equal(r.status, 200);
      await r.text();
      assert.equal(f.records[0]?.usage.promptTokens, 12);
      assert.equal(f.records[0]?.usage.totalTokens, 14);
      toolCachePrivacy(f);
    },
  );
for (const kind of ['anthropic', 'openrouter'] as const)
  test(kind + ': cached function stream cancellation preserves audit/usage', {
    timeout: 3000,
  }, async () => {
    for (const base of bases) {
      const f = toolCacheFixture(kind, { stream: true, mode: 'function' });
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
      const r = await handler(f.request(base, { stream: true, tools: cachedTools }));
      assert.equal(r.status, 200);
      const reader = r.body?.getReader();
      assert.ok(reader);
      assert.equal((await reader.read()).done, false);
      await reader.cancel('private cancellation');
      await interrupted;
      assert.equal(f.records[0]?.outcome, 'failed');
      assert.equal(f.records[0]?.possiblyBilled, true);
      toolCachePrivacy(f);
    }
  });
