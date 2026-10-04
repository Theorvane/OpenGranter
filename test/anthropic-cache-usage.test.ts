import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeDirectAnthropicFunctionResponse } from '../src/streaming/direct-anthropic-function-response.ts';
import { consumeDirectAnthropicTextResponse } from '../src/streaming/direct-anthropic-text-response.ts';
import {
  cacheUsageFixture,
  cacheUsageOutput,
  expectedCacheUsage,
  nativeCacheUsage,
} from './anthropic-cache-usage-fixture.ts';
import { frames, start, stop, terminal, text } from './anthropic-function-stream-fixture.ts';

const details = { prompt_tokens_details: { cached_tokens: 5, cache_write_tokens: 4 } };
const scenarios = [
  {
    name: 'reported disjoint caches included once',
    native: nativeCacheUsage,
    usage: expectedCacheUsage,
    status: 'reported',
    prompt: 12,
    total: 14,
  },
  {
    name: 'explicit zero caches',
    native: {
      input_tokens: 3,
      output_tokens: 2,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    usage: {
      prompt_tokens: 3,
      completion_tokens: 2,
      total_tokens: 5,
      prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    },
    status: 'reported',
    prompt: 3,
    total: 5,
  },
  {
    name: 'legacy absent cache fields',
    native: { input_tokens: 3, output_tokens: 2 },
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    status: 'reported',
    prompt: 3,
    total: 5,
  },
  {
    name: 'initial null caches stay unknown',
    native: {
      input_tokens: 3,
      output_tokens: 2,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
    usage: { completion_tokens: 2 },
    status: 'partial',
    prompt: null,
    total: null,
  },
  {
    name: 'missing write cannot be assumed zero',
    native: { input_tokens: 3, output_tokens: 2, cache_read_input_tokens: 5 },
    usage: { completion_tokens: 2, prompt_tokens_details: { cached_tokens: 5 } },
    status: 'partial',
    prompt: null,
    total: null,
  },
  {
    name: 'missing read cannot be assumed zero',
    native: { input_tokens: 3, output_tokens: 2, cache_creation_input_tokens: 4 },
    usage: { completion_tokens: 2, prompt_tokens_details: { cache_write_tokens: 4 } },
    status: 'partial',
    prompt: null,
    total: null,
  },
  {
    name: 'invalid cache read invalidates prompt aggregate',
    native: { ...nativeCacheUsage, cache_read_input_tokens: -1 },
    usage: {
      prompt_tokens: null,
      completion_tokens: 2,
      prompt_tokens_details: { cache_write_tokens: 4 },
    },
    status: 'invalid',
    prompt: null,
    total: null,
  },
  {
    name: 'malformed write cannot claim valid input total',
    native: { ...nativeCacheUsage, cache_creation_input_tokens: 'private invalid' },
    usage: {
      prompt_tokens: null,
      completion_tokens: 2,
      prompt_tokens_details: { cached_tokens: 5 },
    },
    status: 'invalid',
    prompt: null,
    total: null,
  },
  {
    name: 'unsafe prompt sum is invalid',
    native: {
      input_tokens: Number.MAX_SAFE_INTEGER,
      output_tokens: 2,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 1,
    },
    usage: {
      prompt_tokens: null,
      completion_tokens: 2,
      prompt_tokens_details: { cached_tokens: 1, cache_write_tokens: 0 },
    },
    status: 'invalid',
    prompt: null,
    total: null,
  },
  {
    name: 'unsafe total stays invalid',
    native: {
      input_tokens: Number.MAX_SAFE_INTEGER,
      output_tokens: 2,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    usage: {
      prompt_tokens: Number.MAX_SAFE_INTEGER,
      completion_tokens: 2,
      total_tokens: null,
      prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    },
    status: 'invalid',
    prompt: null,
    total: null,
  },
  {
    name: 'missing uncached input cannot be supplied by details',
    native: { output_tokens: 2, cache_creation_input_tokens: 4, cache_read_input_tokens: 5 },
    usage: { completion_tokens: 2, ...details },
    status: 'partial',
    prompt: null,
    total: null,
  },
  {
    name: 'cache details alone cannot manufacture usage',
    native: { cache_creation_input_tokens: 4, cache_read_input_tokens: 5 },
    usage: undefined,
    status: 'missing',
    prompt: null,
    total: null,
  },
  {
    name: 'invalid uncached input remains invalid',
    native: { ...nativeCacheUsage, input_tokens: null },
    usage: { prompt_tokens: null, completion_tokens: 2, ...details },
    status: 'invalid',
    prompt: null,
    total: null,
  },
  {
    name: 'safe maximum cache count remains exact',
    native: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: Number.MAX_SAFE_INTEGER,
    },
    usage: {
      prompt_tokens: Number.MAX_SAFE_INTEGER,
      completion_tokens: 0,
      total_tokens: Number.MAX_SAFE_INTEGER,
      prompt_tokens_details: { cached_tokens: Number.MAX_SAFE_INTEGER, cache_write_tokens: 0 },
    },
    status: 'reported',
    prompt: Number.MAX_SAFE_INTEGER,
    total: Number.MAX_SAFE_INTEGER,
  },
  {
    name: 'opaque TTL cost and OpenAI groups are excluded',
    native: {
      ...nativeCacheUsage,
      cache_creation: { ephemeral_5m_input_tokens: 999, private: 'unchecked payload' },
      cost: 'private cost',
      prompt_tokens_details: { cached_tokens: 500 },
    },
    usage: expectedCacheUsage,
    status: 'reported',
    prompt: 12,
    total: 14,
  },
];
for (const mode of ['nonstream', 'text-stream', 'function-stream'] as const)
  for (const base of ['/v1', '/api/v1']) {
    for (const s of scenarios)
      test(`Anthropic ${mode} ${base} ${s.name}`, async () => {
        const f = cacheUsageFixture(mode, s.native);
        const response = await f.handler(f.request(base));
        assert.equal(response.status, 200);
        const output = await cacheUsageOutput(response, mode);
        assert.deepEqual(
          output.usage,
          s.status === 'reported' || (mode === 'nonstream' && base === '/v1') ? s.usage : undefined,
        );
        assert.equal(f.records.length, 1);
        assert.deepEqual(f.records[0]?.usage, {
          status: s.status,
          promptTokens: s.prompt,
          completionTokens:
            s.status === 'invalid' || s.status === 'missing' ? null : s.native.output_tokens,
          totalTokens: s.total,
        });
        assert.equal(f.records[0]?.actualInferenceProviderId, 'anthropic');
        assert.equal(f.records[0]?.upstreamBilledCost, null);
        assert.equal(f.records[0]?.estimatedCost, null);
        assert.deepEqual(f.counts(), { secrets: 1, calls: 1, limits: 1 });
        assert.doesNotMatch(
          JSON.stringify({ records: f.records, audits: f.audits }),
          /private|cache_write_tokens|cached_tokens|fixture-provider-key|fixture-proxy-token/u,
        );
        assert.doesNotMatch(
          JSON.stringify(output.usage) ?? '',
          /private|unchecked|cost|ephemeral/u,
        );
      });
    for (const gate of ['auth', 'model', 'provider', 'limit'] as const)
      test(`Anthropic ${mode} ${base} corrected usage cannot bypass ${gate}`, async () => {
        const f = cacheUsageFixture(mode, nativeCacheUsage, { gate });
        const response = await f.handler(f.request(base));
        assert.equal(response.status, gate === 'auth' ? 401 : gate === 'limit' ? 429 : 403);
        assert.doesNotMatch(await response.text(), /cached_tokens|cache_write_tokens|private/u);
        assert.equal(f.counts().secrets, 0);
        assert.equal(f.counts().calls, 0);
        assert.equal(f.records.length, 0);
      });
    for (const gate of ['usage', 'audit'] as const)
      test(`Anthropic ${mode} ${base} required ${gate} failure withholds final usage`, async () => {
        const f = cacheUsageFixture(mode, nativeCacheUsage, { gate });
        const response = await f.handler(f.request(base));
        assert.equal(response.status, mode === 'nonstream' ? 503 : 200);
        const body = await response.text();
        assert.ok(body.includes(`${gate}_unavailable`));
        assert.doesNotMatch(
          body,
          /cached_tokens|cache_write_tokens|\[DONE\]|private ledger|private audit/u,
        );
      });
  }
for (const mode of ['text-stream', 'function-stream'] as const)
  for (const base of ['/v1', '/api/v1'])
    for (const s of [
      {
        name: 'omitted final cache counters retain initial values',
        final: { output_tokens: 2 },
        expected: expectedCacheUsage,
        status: 'reported',
      },
      {
        name: 'null delta input and caches retain initial values',
        final: {
          input_tokens: null,
          output_tokens: 2,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
        },
        expected: expectedCacheUsage,
        status: 'reported',
      },
      {
        name: 'nonnull final counters replace cumulative snapshots',
        final: {
          input_tokens: 1,
          output_tokens: 2,
          cache_creation_input_tokens: 2,
          cache_read_input_tokens: 3,
        },
        expected: {
          prompt_tokens: 6,
          completion_tokens: 2,
          total_tokens: 8,
          prompt_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 },
        },
        status: 'reported',
      },
      {
        name: 'missing final output never uses initial estimate',
        final: { cache_creation_input_tokens: 4, cache_read_input_tokens: 5 },
        expected: undefined,
        status: 'partial',
      },
      {
        name: 'initial unknown cache resolves only with reported zeros',
        initial: {
          input_tokens: 3,
          output_tokens: 999,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
        },
        final: { output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        expected: {
          prompt_tokens: 3,
          completion_tokens: 2,
          total_tokens: 5,
          prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        },
        status: 'reported',
      },
      {
        name: 'invalid final cache overwrites earlier valid input',
        final: { output_tokens: 2, cache_read_input_tokens: -1 },
        expected: undefined,
        status: 'invalid',
      },
    ])
      test(`Anthropic ${mode} ${base} ${s.name}`, async () => {
        const f = cacheUsageFixture(
          mode,
          'initial' in s ? s.initial : { ...nativeCacheUsage, output_tokens: 999 },
          {
            updates: [
              { output_tokens: 1, cache_creation_input_tokens: 1, cache_read_input_tokens: 1 },
            ],
            final: { usage: s.final },
          },
        );
        // Omitted/null updates preserve the most recently reported cumulative values, not always start.
        const expectLatest =
          s.name.startsWith('omitted') || s.name.startsWith('null delta')
            ? {
                prompt_tokens: 5,
                completion_tokens: 2,
                total_tokens: 7,
                prompt_tokens_details: { cached_tokens: 1, cache_write_tokens: 1 },
              }
            : s.expected;
        const response = await f.handler(f.request(base));
        assert.deepEqual((await cacheUsageOutput(response, mode)).usage, expectLatest);
        assert.equal(f.records.length, 1);
        assert.equal(f.records[0]?.usage.status, s.status);
      });
for (const functions of [false, true])
  test(`Anthropic ${functions ? 'nonstream functions' : 'refusal'} shares corrected cache accounting`, async () => {
    const f = cacheUsageFixture('nonstream', nativeCacheUsage, { functions, refusal: !functions });
    const response = await f.handler(f.request('/api/v1'));
    const output = (await response.json()) as {
      usage: unknown;
      choices: { finish_reason: string }[];
    };
    assert.deepEqual(output.usage, expectedCacheUsage);
    assert.equal(output.choices[0]?.finish_reason, functions ? 'tool_calls' : 'content_filter');
  });
for (const consume of [consumeDirectAnthropicTextResponse, consumeDirectAnthropicFunctionResponse])
  test(`Anthropic ${consume.name} returns immutable corrected usage`, async () => {
    const response = new Response(
      frames([
        start('claude-exact', nativeCacheUsage),
        ...text(),
        terminal('end_turn', { output_tokens: 2 }),
        stop,
      ]),
      { headers: { 'content-type': 'text/event-stream' } },
    );
    const result = await consume(
      response,
      { upstreamModelId: 'claude-exact', clientModelAlias: 'chat' },
      () => {},
    );
    assert.deepEqual(result.usage, expectedCacheUsage);
    assert.ok(Object.isFrozen(result.usage));
    assert.ok(Object.isFrozen(result.usage?.prompt_tokens_details));
    assert.doesNotMatch(JSON.stringify(result), /private/u);
  });
