import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { nativeCacheUsage } from './anthropic-cache-usage-fixture.ts';
import {
  combinedHistory as history,
  combinedCacheInput as input,
  expectedCombinedHistory as nativeHistory,
} from './automatic-explicit-cache-control-fixture.ts';
import {
  cachedTools,
  expectedNativeTools,
  toolCacheFixture,
  toolCachePrivacy,
} from './function-tool-cache-control-fixture.ts';
import { expectedSystem } from './text-block-cache-control-fixture.ts';

const root = { type: 'ephemeral' as const };
const long = { type: 'ephemeral' as const, ttl: '1h' as const };
const short = { type: 'ephemeral' as const, ttl: '5m' as const };
const part = (cache_control = long) => ({
  type: 'text' as const,
  text: 'private prefix',
  cache_control,
});
const tools = cachedTools.map(({ cache_control, ...t }) => t);
const bases = ['/v1', '/api/v1'];

for (const kind of ['anthropic', 'openrouter'] as const)
  for (const stream of [false, true])
    for (const mode of ['text', 'refusal', 'function'] as const) {
      test(`${kind} ${mode} stream=${stream}: automatic plus three tool/text directives preserve exact wire on both bases`, async () => {
        for (const base of bases) {
          const f = toolCacheFixture(kind, { stream, mode });
          const r = await f.handler(f.request(base, { ...input, stream }));
          assert.equal(r.status, 200);
          const body = await r.text();
          if (stream) assert.ok(body.endsWith('data: [DONE]\n\n'));
          assert.doesNotMatch(body, /cache_control|ephemeral|private prefix/u);
          assert.deepEqual(f.sent[0]?.cache_control, root);
          assert.deepEqual(
            f.sent[0]?.tools,
            kind === 'anthropic' ? expectedNativeTools : cachedTools,
          );
          assert.deepEqual(f.sent[0]?.messages, kind === 'anthropic' ? nativeHistory : history);
          if (kind === 'anthropic') assert.deepEqual(f.sent[0]?.system, expectedSystem);
          assert.equal(f.records[0]?.usage.totalTokens, 3);
          toolCachePrivacy(f);
        }
        const f = toolCacheFixture(kind, { stream, mode });
        if (stream) await f.stream(true, input);
        else await f.call(input);
        assert.deepEqual(f.sent[0]?.cache_control, root);
      });
      test(`${kind} ${mode} stream=${stream}: combined caching preserves denial and delivery gates`, async () => {
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
            const r = await f.handler(f.request(base, { ...input, stream }));
            assert.equal(r.status, stream && (gate === 'audit' || gate === 'usage') ? 200 : status);
            assert.doesNotMatch(
              await r.text(),
              /cache_control|private prefix|private function|private audit|private ledger|fixture-.*key|\[DONE\]/u,
            );
            assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0);
            toolCachePrivacy(f);
          }
      });
      test(`${kind} ${mode} stream=${stream}: no usage is inferred from joint cache directives`, async () => {
        const f = toolCacheFixture(kind, { stream, mode, missingUsage: true });
        const r = await f.handler(f.request('/api/v1', { ...input, stream }));
        assert.equal(r.status, 200);
        await r.text();
        assert.equal(f.records[0]?.usage.status, 'missing');
        assert.equal(f.records[0]?.usage.totalTokens, null);
        toolCachePrivacy(f);
      });
    }

const cases: { name: string; fields: Record<string, unknown>; status: number }[] = [
  {
    name: 'default root and final default explicit are equivalent',
    fields: { messages: [{ role: 'user', content: [{ ...part(), cache_control: root }] }] },
    status: 200,
  },
  {
    name: 'omitted root and final5m are equivalent',
    fields: { messages: [{ role: 'user', content: [{ ...part(), cache_control: short }] }] },
    status: 200,
  },
  {
    name: '5m root and omitted final are equivalent',
    fields: {
      cache_control: short,
      messages: [{ role: 'user', content: [{ ...part(), cache_control: root }] }],
    },
    status: 200,
  },
  {
    name: '1h root and final1h are equivalent',
    fields: { cache_control: long, messages: [{ role: 'user', content: [part()] }] },
    status: 200,
  },
  {
    name: 'same TTL final marker still reserves a slot',
    fields: {
      cache_control: long,
      messages: [{ role: 'user', content: Array.from({ length: 4 }, () => part()) }],
    },
    status: 400,
  },
  {
    name: 'three explicit plus matching final still fits',
    fields: {
      cache_control: long,
      messages: [{ role: 'user', content: Array.from({ length: 3 }, () => part()) }],
    },
    status: 200,
  },
  {
    name: 'four explicit plus unmarked target does not fit',
    fields: {
      messages: [
        {
          role: 'user',
          content: [
            ...Array.from({ length: 4 }, () => part()),
            { type: 'text', text: 'private suffix' },
          ],
        },
      ],
    },
    status: 400,
  },
  {
    name: 'final1h conflicts with default root',
    fields: { messages: [{ role: 'user', content: [part()] }] },
    status: 400,
  },
  {
    name: 'final5m conflicts with long root',
    fields: {
      cache_control: long,
      messages: [{ role: 'user', content: [{ ...part(), cache_control: short }] }],
    },
    status: 400,
  },
  {
    name: 'long prefix and automatic short unmarked target fit',
    fields: {
      messages: [{ role: 'user', content: [part(), { type: 'text', text: 'private suffix' }] }],
    },
    status: 200,
  },
  {
    name: 'short prefix before long automatic fails order',
    fields: {
      cache_control: long,
      messages: [
        {
          role: 'user',
          content: [
            { ...part(), cache_control: root },
            { type: 'text', text: 'private suffix' },
          ],
        },
      ],
    },
    status: 400,
  },
  {
    name: 'long root walks back over empty trailing part',
    fields: {
      cache_control: long,
      messages: [{ role: 'user', content: [part(), { type: 'text', text: '' }] }],
    },
    status: 200,
  },
  {
    name: 'short root walkback detects previous long marker collision',
    fields: { messages: [{ role: 'user', content: [part(), { type: 'text', text: '' }] }] },
    status: 400,
  },
  {
    name: 'empty trailing message walks back to matching marker',
    fields: {
      cache_control: long,
      messages: [
        { role: 'user', content: [part()] },
        { role: 'user', content: '' },
      ],
    },
    status: 200,
  },
  {
    name: 'empty trailing message does not hide marker collision',
    fields: {
      messages: [
        { role: 'user', content: [part()] },
        { role: 'user', content: '' },
      ],
    },
    status: 400,
  },
  {
    name: 'instruction newline is unmarked eligible target',
    fields: {
      messages: [
        { role: 'system', content: [part()] },
        { role: 'developer', content: '' },
        { role: 'user', content: '' },
      ],
    },
    status: 200,
  },
  {
    name: 'one instruction marker remains target through empty user',
    fields: {
      messages: [
        { role: 'system', content: [part()] },
        { role: 'user', content: '' },
      ],
    },
    status: 400,
  },
  {
    name: 'tool definitions are fallback eligible targets',
    fields: { tools: cachedTools, messages: [{ role: 'user', content: '' }] },
    status: 400,
  },
  {
    name: 'matching tool definition fallback is accepted',
    fields: { cache_control: long, tools: cachedTools, messages: [{ role: 'user', content: '' }] },
    status: 200,
  },
  {
    name: 'joined empty instructions have eligible newline after tools',
    fields: {
      tools: cachedTools,
      messages: [
        { role: 'system', content: '' },
        { role: 'developer', content: '' },
        { role: 'user', content: '' },
      ],
    },
    status: 200,
  },
  {
    name: 'combined partial nested tool result remains unsupported',
    fields: {
      tools,
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'previous', type: 'function', function: { name: 'lookup', arguments: '{}' } },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'previous',
          content: [
            { ...part(), cache_control: root },
            { type: 'text', text: 'private suffix' },
          ],
        },
      ],
    },
    status: 400,
  },
  {
    name: 'root options remain different unsupported format',
    fields: {
      prompt_cache_options: { mode: 'explicit' },
      messages: [{ role: 'user', content: [{ ...part(), cache_control: root }] }],
    },
    status: 400,
  },
  {
    name: 'OpenAI text breakpoint remains different unsupported format',
    fields: {
      messages: [
        { role: 'user', content: [{ ...part(), prompt_cache_breakpoint: { mode: 'explicit' } }] },
      ],
    },
    status: 400,
  },
];
for (const result of ['', 'private result'])
  cases.push({
    name: 'outer tool result target is eligible with content ' + JSON.stringify(result),
    fields: {
      tools: cachedTools,
      messages: [
        {
          role: 'assistant',
          content: [part()],
          tool_calls: [
            { id: 'previous', type: 'function', function: { name: 'lookup', arguments: '{}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'previous', content: result },
      ],
    },
    status: 200,
  });
for (const kind of ['anthropic', 'openrouter'] as const)
  for (const stream of [false, true])
    for (const c of cases)
      test(`${kind} stream=${stream}: ${c.name}`, async () => {
        const fields = { cache_control: root, ...c.fields };
        for (const base of bases) {
          const f = toolCacheFixture(kind, { stream });
          const r = await f.handler(f.request(base, { ...fields, stream }));
          assert.equal(r.status, c.status);
          await r.text();
          if (c.status === 400) assert.deepEqual(f.counts(), { routes: 0, secrets: 0 });
          else {
            assert.equal(f.counts().secrets, 1);
            assert.deepEqual(f.sent[0]?.cache_control, fields.cache_control);
          }
          toolCachePrivacy(f);
        }
        const f = toolCacheFixture(kind, { stream });
        const invoke = () => (stream ? f.stream(true, fields) : f.call(fields));
        if (c.status === 400) {
          await assert.rejects(invoke);
          assert.equal(f.counts().secrets, 0);
        } else await invoke();
      });
for (const kind of ['anthropic', 'openrouter'] as const)
  for (const stream of [false, true]) {
    test(`${kind} stream=${stream}: cache root and nested parts are captured once before mutation`, async () => {
      let roots = 0,
        types = 0,
        ttls = 0,
        parts = 0;
      const directive = Object.defineProperties(
        {},
        {
          type: {
            enumerable: true,
            get() {
              types++;
              return 'ephemeral';
            },
          },
          ttl: {
            enumerable: true,
            configurable: true,
            get() {
              ttls++;
              return '1h';
            },
          },
        },
      );
      const marked = {
        type: 'text',
        text: 'private prefix',
        get cache_control() {
          parts++;
          return directive;
        },
      };
      const messages = [{ role: 'user', content: [marked] }];
      const fields = {
        messages,
        get cache_control() {
          roots++;
          return directive;
        },
      };
      const f = toolCacheFixture(kind, {
        stream,
        mutate: () => {
          assert.deepEqual([roots, types, ttls, parts], [1, 2, 2, 1]);
          Object.defineProperty(directive, 'ttl', { value: '5m', enumerable: true });
          marked.text = 'private changed';
          messages.push({ role: 'user', content: [marked] });
        },
      });
      if (stream) await f.stream(false, fields);
      else await f.call(fields);
      assert.deepEqual(f.sent[0]?.cache_control, long);
      assert.deepEqual(f.sent[0]?.messages, [{ role: 'user', content: [part()] }]);
      toolCachePrivacy(f);
    });
    test(`${kind} stream=${stream}: opened failures retain possible billing with combined caches`, async () => {
      const f = toolCacheFixture(kind, { stream, transportFails: true });
      const r = await f.handler(f.request('/v1', { ...input, stream }));
      assert.equal(r.status, 502);
      assert.doesNotMatch(await r.text(), /private|cache_control|ephemeral/u);
      assert.equal(f.records[0]?.possiblyBilled, true);
      assert.equal(f.records[0]?.outcome, 'failed');
      toolCachePrivacy(f);
    });
  }
for (const stream of [false, true])
  test(`Anthropic stream=${stream}: combined preferences preserve reported aggregate cache usage`, async () => {
    const f = toolCacheFixture('anthropic', { stream, nativeUsage: nativeCacheUsage });
    const r = await f.handler(f.request('/api/v1', { ...input, stream }));
    assert.equal(r.status, 200);
    await r.text();
    assert.equal(f.records[0]?.usage.promptTokens, 12);
    assert.equal(f.records[0]?.usage.totalTokens, 14);
    toolCachePrivacy(f);
  });
for (const kind of ['openai', 'google'] as const)
  for (const stream of [false, true])
    test(`${kind} stream=${stream}: native same-format combination remains unsupported pre-secret`, async () => {
      const f = toolCacheFixture(kind, { stream });
      await assert.rejects(() => (stream ? f.stream(true, input) : f.call(input)));
      assert.equal(f.counts().secrets, 0);
      assert.equal(f.sent.length, 0);
    });
for (const kind of ['anthropic', 'openrouter'] as const)
  test(`${kind}: combined function stream cancellation persists interruption`, {
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
    const r = await handler(f.request('/api/v1', { ...input, stream: true }));
    assert.equal(r.status, 200);
    const reader = r.body?.getReader();
    assert.ok(reader);
    assert.equal((await reader.read()).done, false);
    await reader.cancel('private cancellation');
    await interrupted;
    assert.equal(f.records[0]?.possiblyBilled, true);
    assert.equal(f.records[0]?.outcome, 'failed');
    toolCachePrivacy(f);
  });
