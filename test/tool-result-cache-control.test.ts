import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { snapshotChatMessages } from '../src/gateway/chat-messages.ts';
import { prepareAnthropicMessages } from '../src/providers/anthropic-client-functions.ts';
import { nativeCacheUsage } from './anthropic-cache-usage-fixture.ts';
import {
  cachedTools,
  expectedNativeTools,
  toolCacheFixture,
  toolCachePrivacy,
} from './function-tool-cache-control-fixture.ts';
import { blockParts } from './text-block-cache-control-fixture.ts';
import {
  expectedResultHistory,
  expectedResults,
  resultHistory,
  resultInput,
  resultParts,
} from './tool-result-cache-control-fixture.ts';

const bases = ['/v1', '/api/v1'];
for (const kind of ['anthropic', 'openrouter'] as const)
  for (const stream of [false, true])
    for (const mode of ['text', 'refusal', 'function'] as const) {
      test(`${kind} ${mode} stream=${stream}: final-only result boundary maps exactly with/without automatic root`, async () => {
        for (const base of bases)
          for (const automatic of [false, true]) {
            const { cache_control, ...plain } = resultInput;
            const fields = { ...plain, ...(automatic ? { cache_control } : {}), stream };
            const f = toolCacheFixture(kind, { stream, mode });
            const r = await f.handler(f.request(base, fields));
            assert.equal(r.status, 200);
            const body = await r.text();
            if (stream) assert.ok(body.endsWith('data: [DONE]\n\n'));
            assert.doesNotMatch(body, /cache_control|private result prefix|private result end/u);
            assert.deepEqual(
              f.sent[0]?.messages,
              kind === 'anthropic' ? expectedResultHistory : resultHistory,
            );
            assert.deepEqual(
              f.sent[0]?.tools,
              kind === 'anthropic' ? expectedNativeTools : cachedTools,
            );
            if (kind === 'anthropic') assert.deepEqual(f.sent[0]?.system, blockParts);
            assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'cache_control'), automatic);
            if (automatic) assert.deepEqual(f.sent[0]?.cache_control, cache_control);
            assert.equal(f.records[0]?.usage.totalTokens, 3);
            toolCachePrivacy(f);
          }
        const f = toolCacheFixture(kind, { stream, mode });
        if (stream) await f.stream(true, resultInput);
        else await f.call(resultInput);
        assert.deepEqual(
          f.sent[0]?.messages,
          kind === 'anthropic' ? expectedResultHistory : resultHistory,
        );
      });
      test(`${kind} ${mode} stream=${stream}: final result caching retains every denial/persistence gate`, async () => {
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
            const r = await f.handler(f.request(base, { ...resultInput, stream }));
            assert.equal(r.status, stream && (gate === 'audit' || gate === 'usage') ? 200 : status);
            assert.doesNotMatch(
              await r.text(),
              /cache_control|private result|fixture-.*key|\[DONE\]/u,
            );
            assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0);
            toolCachePrivacy(f);
          }
      });
      test(`${kind} ${mode} stream=${stream}: result marker never fills missing usage`, async () => {
        const f = toolCacheFixture(kind, { stream, mode, missingUsage: true });
        const r = await f.handler(f.request('/api/v1', { ...resultInput, stream }));
        assert.equal(r.status, 200);
        await r.text();
        assert.equal(f.records[0]?.usage.status, 'missing');
        assert.equal(f.records[0]?.usage.totalTokens, null);
        toolCachePrivacy(f);
      });
    }
const historyWith = (content: unknown) =>
  resultHistory.map((m) => (m.role === 'tool' ? { ...m, content } : m));
for (const kind of ['anthropic', 'openrouter'] as const)
  for (const stream of [false, true]) {
    test(`${kind} stream=${stream}: final TTL/default and empty trailing message drive automatic collision checks`, async () => {
      for (const ttl of [undefined, '5m', '1h'] as const)
        for (const rootTtl of [undefined, '5m', '1h'] as const)
          for (const trailing of [false, true]) {
            const directive = { type: 'ephemeral', ...(ttl ? { ttl } : {}) };
            const messages = [
              ...historyWith(
                resultParts.map((p, i) => (i === 2 ? { ...p, cache_control: directive } : p)),
              ),
              ...(trailing ? [{ role: 'user', content: '' }] : []),
            ];
            const fields = {
              tools: cachedTools,
              messages,
              cache_control: { type: 'ephemeral', ...(rootTtl ? { ttl: rootTtl } : {}) },
            };
            const expected = (ttl ?? '5m') === (rootTtl ?? '5m') ? 200 : 400;
            const f = toolCacheFixture(kind, { stream });
            const r = await f.handler(f.request('/api/v1', { ...fields, stream }));
            assert.equal(r.status, expected);
            await r.text();
            if (expected === 400) {
              assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
              await assert.rejects(() => (stream ? f.stream(true, fields) : f.call(fields)));
              assert.equal(f.counts().secrets, 0);
            } else {
              assert.deepEqual(f.sent[0]?.cache_control, fields.cache_control);
              toolCachePrivacy(f);
            }
          }
    });
    test(`${kind} stream=${stream}: unsupported partial/multiple markers reject combined requests before routes`, async () => {
      for (const content of [
        [resultParts[2], { type: 'text', text: 'private suffix' }],
        [resultParts[2], { ...resultParts[2], text: 'private final' }],
        [{ ...resultParts[2], text: '' }],
        [{ ...resultParts[2], prompt_cache_breakpoint: { mode: 'explicit' } }],
      ]) {
        const fields = { ...resultInput, messages: historyWith(content) };
        const f = toolCacheFixture(kind, { stream });
        const r = await f.handler(f.request('/v1', { ...fields, stream }));
        assert.equal(r.status, 400);
        await r.text();
        assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
        await assert.rejects(() => (stream ? f.stream(true, fields) : f.call(fields)));
        assert.equal(f.counts().secrets, 0);
      }
    });
    test(`${kind} stream=${stream}: four explicit directives cannot borrow automatic slot`, async () => {
      const tools = [
        ...cachedTools,
        { ...cachedTools[0], function: { name: 'other', parameters: { type: 'object' } } },
      ];
      const f = toolCacheFixture(kind, { stream });
      const r = await f.handler(f.request('/v1', { ...resultInput, tools, stream }));
      assert.equal(r.status, 400);
      await r.text();
      assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
    });
    test(`${kind} stream=${stream}: adjacent parallel results preserve separate parent boundaries/order`, async () => {
      const messages = [
        resultHistory[0],
        resultHistory[1],
        {
          role: 'assistant',
          content: null,
          tool_calls: ['a', 'b'].map((id) => ({
            id,
            type: 'function',
            function: { name: 'lookup', arguments: '{}' },
          })),
        },
        ...['a', 'b'].map((tool_call_id) => ({ role: 'tool', tool_call_id, content: resultParts })),
      ];
      const fields = { tools: cachedTools, messages };
      const f = toolCacheFixture(kind, { stream });
      const r = await f.handler(f.request('/api/v1', { ...fields, stream }));
      assert.equal(r.status, 200);
      await r.text();
      assert.deepEqual(
        f.sent[0]?.messages,
        kind === 'anthropic'
          ? [
              expectedResultHistory[0],
              {
                role: 'assistant',
                content: ['a', 'b'].map((id) => ({
                  type: 'tool_use',
                  id,
                  name: 'lookup',
                  input: {},
                })),
              },
              {
                role: 'user',
                content: ['a', 'b'].map((tool_use_id) => ({ ...expectedResults[0], tool_use_id })),
              },
            ]
          : messages,
      );
      toolCachePrivacy(f);
    });
    test(`${kind} stream=${stream}: credential mutation cannot move final result marker or change text`, async () => {
      let contents = 0,
        directives = 0;
      const last = {
        type: 'text',
        text: ' private result end ',
        get cache_control() {
          directives++;
          return { type: 'ephemeral', ttl: '1h' };
        },
      };
      const parts = [resultParts[0], resultParts[1], last];
      const messages = resultHistory.map((m) =>
        m.role === 'tool'
          ? {
              role: 'tool',
              tool_call_id: m.tool_call_id,
              get content() {
                contents++;
                return parts;
              },
            }
          : m,
      );
      const f = toolCacheFixture(kind, {
        stream,
        mutate: () => {
          assert.deepEqual([contents, directives], [1, 1]);
          last.text = 'private changed';
          parts.push(last);
        },
      });
      const fields = { ...resultInput, messages };
      if (stream) await f.stream(true, fields);
      else await f.call(fields);
      assert.deepEqual(
        f.sent[0]?.messages,
        kind === 'anthropic' ? expectedResultHistory : resultHistory,
      );
      toolCachePrivacy(f);
    });
    test(`${kind} stream=${stream}: opened failure retains possibly-billed result attempt`, async () => {
      const f = toolCacheFixture(kind, { stream, transportFails: true });
      const r = await f.handler(f.request('/v1', { ...resultInput, stream }));
      assert.equal(r.status, 502);
      assert.doesNotMatch(await r.text(), /private result|cache_control|ephemeral/u);
      assert.equal(f.records[0]?.possiblyBilled, true);
      assert.equal(f.records[0]?.outcome, 'failed');
      toolCachePrivacy(f);
    });
  }
for (const stream of [false, true])
  test(`Anthropic stream=${stream}: final-only result cache retains reported aggregate usage`, async () => {
    const f = toolCacheFixture('anthropic', { stream, nativeUsage: nativeCacheUsage });
    const r = await f.handler(f.request('/api/v1', { ...resultInput, stream }));
    assert.equal(r.status, 200);
    await r.text();
    assert.equal(f.records[0]?.usage.promptTokens, 12);
    assert.equal(f.records[0]?.usage.totalTokens, 14);
    toolCachePrivacy(f);
  });
for (const kind of ['openai', 'google'] as const)
  test(`${kind}: final result directives remain unsupported before secrets`, async () => {
    for (const stream of [false, true]) {
      const f = toolCacheFixture(kind, { stream });
      await assert.rejects(() => (stream ? f.stream(true, resultInput) : f.call(resultInput)));
      assert.equal(f.counts().secrets, 0);
      assert.equal(f.sent.length, 0);
    }
  });
test('exported Anthropic converter applies only final nested boundary and rejects earlier markers', () => {
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(prepareAnthropicMessages(snapshotChatMessages(resultHistory).slice(1))),
    ),
    expectedResultHistory,
  );
  for (const content of [
    [resultParts[2], { type: 'text', text: 'private suffix' }],
    [resultParts[2], resultParts[2]],
  ])
    assert.throws(() =>
      prepareAnthropicMessages(snapshotChatMessages(historyWith(content)).slice(1)),
    );
});
for (const kind of ['anthropic', 'openrouter'] as const)
  test(`${kind}: final result function stream cancellation keeps audit/usage`, {
    timeout: 3000,
  }, async () => {
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
    const r = await handler(f.request('/api/v1', { ...resultInput, stream: true }));
    assert.equal(r.status, 200);
    const reader = r.body?.getReader();
    assert.ok(reader);
    assert.equal((await reader.read()).done, false);
    await reader.cancel('private result cancellation');
    await interrupted;
    assert.equal(f.records[0]?.possiblyBilled, true);
    assert.equal(f.records[0]?.outcome, 'failed');
    toolCachePrivacy(f);
  });
test('exported native result conversion rejects an empty marked final text block without relying on HTTP normalization', () => {
  const last = resultParts.at(-1);
  assert.ok(last);
  assert.throws(() =>
    prepareAnthropicMessages([
      { role: 'tool', tool_call_id: 'previous', content: [{ ...last, text: '' }] },
    ]),
  );
});
