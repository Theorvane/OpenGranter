import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeDirectGoogleFunctionResponse } from '../src/streaming/direct-google-function-response.ts';
import { consumeDirectGoogleTextResponse } from '../src/streaming/direct-google-text-response.ts';
import {
  googleDetailCounts as counts,
  googleDetailUsage as expected,
  googleDetailOutput,
  googleDetailsFixture,
} from './google-token-details-fixture.ts';

const full = { ...counts, cachedContentTokenCount: 1, thoughtsTokenCount: 4 };
const scenarios = [
  {
    name: 'reported cache and thoughts without adjusting aggregates',
    extra: { cachedContentTokenCount: 1, thoughtsTokenCount: 4 },
    details: {
      prompt_tokens_details: { cached_tokens: 1 },
      completion_tokens_details: { reasoning_tokens: 4 },
    },
  },
  {
    name: 'explicit zero categories',
    extra: { cachedContentTokenCount: 0, thoughtsTokenCount: 0 },
    details: {
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  },
  { name: 'omitted categories stay absent', extra: {}, details: {} },
  {
    name: 'null native categories are unset',
    extra: { cachedContentTokenCount: null, thoughtsTokenCount: null },
    details: {},
  },
  {
    name: 'invalid cache preserves thoughts',
    extra: { cachedContentTokenCount: -1, thoughtsTokenCount: 4 },
    details: { completion_tokens_details: { reasoning_tokens: 4 } },
  },
  {
    name: 'invalid thoughts preserve cache',
    extra: { cachedContentTokenCount: 1, thoughtsTokenCount: 'private invalid' },
    details: { prompt_tokens_details: { cached_tokens: 1 } },
  },
  {
    name: 'overflow and fractional categories are omitted',
    extra: { cachedContentTokenCount: Number.MAX_SAFE_INTEGER + 1, thoughtsTokenCount: 1.5 },
    details: {},
  },
  {
    name: 'opaque objects never project',
    extra: { cachedContentTokenCount: { private: 'unchecked payload' }, thoughtsTokenCount: true },
    details: {},
  },
  {
    name: 'unrecognized OpenAI groups and costs stay private',
    extra: {
      cachedContentTokenCount: 1,
      thoughtsTokenCount: 4,
      prompt_tokens_details: { audio_tokens: 99, private: 'unchecked payload' },
      cost: 'private cost',
      toolUsePromptTokenCount: 500,
    },
    details: {
      prompt_tokens_details: { cached_tokens: 1 },
      completion_tokens_details: { reasoning_tokens: 4 },
    },
  },
];
for (const mode of ['nonstream', 'text-stream', 'function-stream'] as const)
  for (const base of ['/v1', '/api/v1']) {
    for (const scenario of scenarios)
      test(`Gemini ${mode} ${base} ${scenario.name}`, async () => {
        const f = googleDetailsFixture(mode, { ...counts, ...scenario.extra });
        const response = await f.handler(f.request(base));
        assert.equal(response.status, 200);
        const output = await googleDetailOutput(response, mode);
        assert.deepEqual(output.usage, {
          prompt_tokens: 3,
          completion_tokens: 2,
          total_tokens: 9,
          ...scenario.details,
        });
        assert.equal(f.records.length, 1);
        assert.deepEqual(f.records[0]?.usage, {
          status: 'reported',
          promptTokens: 3,
          completionTokens: 2,
          totalTokens: 9,
        });
        assert.equal(f.records[0]?.actualInferenceProviderId, 'google');
        assert.equal(f.records[0]?.estimatedCost, null);
        assert.equal(f.records[0]?.upstreamBilledCost, null);
        assert.deepEqual(f.counts(), { secrets: 1, calls: 1, limits: 1 });
        assert.doesNotMatch(
          JSON.stringify({ records: f.records, audits: f.audits }),
          /private|fixture-provider-key|fixture-proxy-token|cached_tokens|reasoning_tokens/u,
        );
        assert.doesNotMatch(
          JSON.stringify(output.usage),
          /private|unchecked|cost|toolUsePromptTokenCount/u,
        );
      });
    for (const gate of ['auth', 'model', 'provider', 'limit'] as const)
      test(`Gemini ${mode} ${base} details do not bypass ${gate}`, async () => {
        const f = googleDetailsFixture(mode, full, { gate });
        const response = await f.handler(f.request(base));
        assert.equal(response.status, gate === 'auth' ? 401 : gate === 'limit' ? 429 : 403);
        assert.doesNotMatch(await response.text(), /cached_tokens|reasoning_tokens|private/u);
        assert.equal(f.counts().secrets, 0);
        assert.equal(f.counts().calls, 0);
        assert.equal(f.records.length, 0);
      });
    for (const gate of ['usage', 'audit'] as const)
      test(`Gemini ${mode} ${base} required ${gate} failure withholds usage details`, async () => {
        const f = googleDetailsFixture(mode, full, { gate });
        const response = await f.handler(f.request(base));
        const body = await response.text();
        assert.equal(response.status, mode === 'nonstream' ? 503 : 200);
        assert.ok(body.includes(`${gate}_unavailable`));
        assert.doesNotMatch(
          body,
          /cached_tokens|reasoning_tokens|\[DONE\]|private ledger|private audit/u,
        );
        assert.equal(f.counts().calls, 1);
      });
    for (const aggregate of ['partial', 'invalid', 'detail-only'] as const)
      test(`Gemini ${mode} ${base} details cannot repair ${aggregate} aggregates`, async () => {
        const usage = {
          cachedContentTokenCount: 1,
          thoughtsTokenCount: 4,
          ...(aggregate === 'detail-only' ? {} : { promptTokenCount: 3, candidatesTokenCount: 2 }),
          ...(aggregate === 'invalid' ? { totalTokenCount: -1 } : {}),
        };
        const f = googleDetailsFixture(mode, usage);
        const result = await googleDetailOutput(await f.handler(f.request(base)), mode);
        assert.deepEqual(
          result.usage,
          mode === 'nonstream' && base === '/v1' && aggregate !== 'detail-only'
            ? {
                prompt_tokens: 3,
                completion_tokens: 2,
                ...(aggregate === 'invalid' ? { total_tokens: null } : {}),
                prompt_tokens_details: { cached_tokens: 1 },
                completion_tokens_details: { reasoning_tokens: 4 },
              }
            : undefined,
        );
        assert.equal(
          f.records[0]?.usage.status,
          aggregate === 'detail-only' ? 'missing' : aggregate,
        );
        assert.equal(f.records[0]?.usage.totalTokens, null);
      });
  }
for (const mode of ['text-stream', 'function-stream'] as const)
  for (const base of ['/v1', '/api/v1'])
    for (const tail of [
      {
        name: 'replace both groups',
        usage: { ...counts, cachedContentTokenCount: 0, thoughtsTokenCount: 8 },
        details: {
          prompt_tokens_details: { cached_tokens: 0 },
          completion_tokens_details: { reasoning_tokens: 8 },
        },
      },
      { name: 'clear earlier omitted categories', usage: counts, details: {} },
      {
        name: 'clear earlier invalid categories independently',
        usage: { ...counts, cachedContentTokenCount: -1, thoughtsTokenCount: 0 },
        details: { completion_tokens_details: { reasoning_tokens: 0 } },
      },
    ])
      test(`Gemini ${mode} ${base} usage-only tail ${tail.name}`, async () => {
        const f = googleDetailsFixture(mode, full, {
          early: { ...counts, cachedContentTokenCount: 999, thoughtsTokenCount: 999 },
          tail: { usage: tail.usage },
        });
        const result = await googleDetailOutput(await f.handler(f.request(base)), mode);
        assert.deepEqual(result.usage, {
          prompt_tokens: 3,
          completion_tokens: 2,
          total_tokens: 9,
          ...tail.details,
        });
        assert.equal(f.records.length, 1);
        assert.equal(f.records[0]?.usage.totalTokens, 9);
      });
for (const functions of [false, true])
  test(`Gemini nonstream ${functions ? 'functions' : 'safety'} shares native category projection`, async () => {
    const f = googleDetailsFixture('nonstream', full, { functions, safety: !functions });
    const response = await f.handler(f.request('/api/v1'));
    const output = (await response.json()) as {
      usage: unknown;
      choices: { finish_reason: string }[];
    };
    assert.deepEqual(output.usage, expected);
    assert.equal(output.choices[0]?.finish_reason, functions ? 'tool_calls' : 'content_filter');
  });
for (const consume of [consumeDirectGoogleTextResponse, consumeDirectGoogleFunctionResponse])
  test(`Gemini ${consume.name} captures immutable terminal categories`, async () => {
    const response = new Response(
      'data: ' +
        JSON.stringify({
          responseId: 'gen',
          modelVersion: 'gemini-exact',
          candidates: [
            {
              index: 0,
              content: { role: 'model', parts: [{ text: 'private answer' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: full,
        }) +
        '\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
    const result = await consume(
      response,
      { upstreamModelId: 'gemini-exact', clientModelAlias: 'chat' },
      () => {},
    );
    assert.deepEqual(result.usage, expected);
    assert.ok(Object.isFrozen(result.usage));
    assert.ok(Object.isFrozen(result.usage?.prompt_tokens_details));
    assert.ok(Object.isFrozen(result.usage?.completion_tokens_details));
    assert.doesNotMatch(JSON.stringify(result), /private/u);
  });
for (const mode of ['text-stream', 'function-stream'] as const)
  test(`Gemini ${mode} intermediate categories cannot supply terminal omissions`, async () => {
    const f = googleDetailsFixture(mode, counts, { early: full });
    const result = await googleDetailOutput(await f.handler(f.request('/api/v1')), mode);
    assert.deepEqual(result.usage, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 9 });
  });
