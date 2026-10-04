import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatCompletion } from '../src/providers/direct-chat.ts';
import {
  geminiProbabilityControls,
  geminiProbabilityFixture,
  geminiProbabilityGroups,
  nativeProbabilityAlternative,
  nativeProbabilityResult,
  nativeProbabilityToken,
} from './gemini-logprobs-fixture.ts';
import {
  probabilityFixture,
  probabilityPrivacy,
  probabilityTools,
} from './nonstream-logprobs-fixture.ts';

const bases = ['/v1', '/api/v1'];
test('Gemini: probability controls compose with sampling, effort and output limits', async () => {
  const f = geminiProbabilityFixture();
  await f.call({
    logprobs: true,
    top_logprobs: 0,
    max_completion_tokens: 8,
    temperature: 0,
    top_p: 1,
    reasoning_effort: 'low',
  });
  assert.deepEqual(f.sent[0]?.generationConfig, {
    responseLogprobs: true,
    logprobs: 0,
    maxOutputTokens: 8,
    temperature: 0,
    topP: 1,
    thinkingConfig: { thinkingLevel: 'low' },
  });
  const functions = geminiProbabilityFixture(nativeProbabilityResult, { mode: 'function' });
  await assert.rejects(() =>
    functions.call({ logprobs: true, tools: probabilityTools, reasoning_effort: 'low' }),
  );
  assert.equal(functions.counts().secrets, 0);
});
test('Gemini: omitted probability controls preserve native config absence and transport failures remain sanitized', async () => {
  const f = geminiProbabilityFixture();
  await f.call();
  assert.equal(f.sent[0]?.generationConfig, undefined);
  const failed = probabilityFixture('google', undefined, { transportFails: true });
  const response = await failed.handler(
    failed.request('/v1', { logprobs: true, top_logprobs: 20 }),
  );
  assert.equal(response.status, 502);
  assert.equal(failed.counts().secrets, 1);
  assert.equal(failed.records[0]?.outcome, 'failed');
  assert.doesNotMatch(await response.text(), /private|fixture-.*key/u);
  probabilityPrivacy(failed);
});
for (const mode of ['candidate-safety', 'prompt-safety'] as const)
  test(`Gemini ${mode}: blocked probability accessors are never read`, async () => {
    const f = geminiProbabilityFixture(undefined, { mode, raw: true });
    const target = mode === 'prompt-safety' ? f.native : f.native.candidates?.[0];
    assert.ok(target);
    Object.defineProperty(target, 'logprobsResult', {
      enumerable: true,
      get: () => {
        throw new Error('private blocked probability accessor');
      },
    });
    const response = await f.handler(f.request('/api/v1', { logprobs: true }));
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as ChatCompletion).choices[0].logprobs, undefined);
    probabilityPrivacy(f);
  });
test('Gemini: multiple native steps retain reported order and nullable optional IDs and sum', async () => {
  const f = geminiProbabilityFixture({
    chosenCandidates: [
      { token: 'second', tokenId: null, logProbability: 0 },
      { token: 'first', tokenId: 2147483647, logProbability: -1 },
    ],
    topCandidates: [
      {
        candidates: [
          { token: 'outside', logProbability: -2 },
          { token: 'ranked', logProbability: -3 },
        ],
      },
      {},
    ],
    logProbabilitySum: null,
  });
  const result = await f.call();
  assert.deepEqual(result.choices[0].logprobs, {
    content: [
      {
        token: 'second',
        logprob: 0,
        bytes: null,
        top_logprobs: [
          { token: 'outside', logprob: -2, bytes: null },
          { token: 'ranked', logprob: -3, bytes: null },
        ],
      },
      { token: 'first', logprob: -1, bytes: null, top_logprobs: [] },
    ],
  });
});
test('Gemini: the exact chosen-token count bound preserves every reported step', async () => {
  const f = geminiProbabilityFixture(
    { chosenCandidates: new Array(65536).fill({ token: '', logProbability: 0 }) },
    { raw: true },
  );
  const result = await f.call();
  assert.equal(result.choices[0].logprobs?.content?.length, 65536);
});
for (const mode of ['text', 'function', 'signed'] as const) {
  for (const [index, fields] of geminiProbabilityControls.entries())
    test(`Gemini ${mode}: nonstream probability controls ${index} through both bases`, async () => {
      for (const base of bases) {
        const f = geminiProbabilityFixture(nativeProbabilityResult, { mode });
        const response = await f.handler(
          f.request(base, { ...fields, ...(mode !== 'text' ? { tools: probabilityTools } : {}) }),
        );
        assert.equal(response.status, 200);
        const result = (await response.json()) as ChatCompletion;
        assert.deepEqual(result.choices[0].logprobs, geminiProbabilityGroups);
        const config = f.sent[0]?.generationConfig as Record<string, unknown> | undefined;
        assert.equal(config?.responseLogprobs, fields.logprobs ?? undefined);
        assert.equal(config?.logprobs, fields.top_logprobs ?? undefined);
        assert.equal(f.sent[0]?.logprobs, undefined);
        assert.equal(f.sent[0]?.top_logprobs, undefined);
        if (mode !== 'text') {
          assert.deepEqual(config?.thinkingConfig, { thinkingBudget: 0 });
          assert.equal(result.choices[0].finish_reason, 'tool_calls');
          assert.equal(
            result.choices[0].message.tool_calls?.[0]?.function.arguments,
            '{"q":"private argument"}',
          );
          if (mode === 'signed')
            assert.equal(
              result.choices[0].message.tool_calls?.[0]?.extra_content?.google.thought_signature,
              'private-signature',
            );
        }
        assert.equal(f.records.length, 1);
        assert.equal(f.records[0]?.usage.totalTokens, 3);
        assert.equal(f.records[0]?.actualInferenceProviderId, 'provider');
        probabilityPrivacy(f);
      }
    });
  test(`Gemini ${mode}: missing usage stays missing independently of probabilities`, async () => {
    for (const base of bases) {
      const f = geminiProbabilityFixture(nativeProbabilityResult, { mode, missingUsage: true });
      const response = await f.handler(
        f.request(base, {
          logprobs: true,
          ...(mode !== 'text' ? { tools: probabilityTools } : {}),
        }),
      );
      assert.equal(response.status, 200);
      const result = (await response.json()) as ChatCompletion;
      assert.deepEqual(result.choices[0].logprobs, geminiProbabilityGroups);
      assert.equal(result.usage, undefined);
      assert.equal(f.records[0]?.usage.status, 'missing');
      assert.equal(f.records[0]?.usage.totalTokens, null);
      probabilityPrivacy(f);
    }
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
    test(`Gemini ${mode}: probability mapping preserves ${gate} gate`, async () => {
      for (const base of bases) {
        const f = geminiProbabilityFixture(nativeProbabilityResult, { mode, gate });
        const response = await f.handler(
          f.request(base, {
            logprobs: true,
            top_logprobs: 20,
            ...(mode !== 'text' ? { tools: probabilityTools } : {}),
          }),
        );
        assert.equal(response.status, status);
        assert.doesNotMatch(await response.text(), /private|forged|fixture-.*key/u);
        assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0);
        probabilityPrivacy(f);
      }
    });
}
for (const mode of ['candidate-safety', 'prompt-safety'] as const)
  test(`Gemini ${mode}: controls work but blocked token metadata is never exposed`, async () => {
    for (const native of [
      nativeProbabilityResult,
      { chosenCandidates: [{ token: 'private blocked', logProbability: null }] },
    ])
      for (const base of bases) {
        const f = geminiProbabilityFixture(native, { mode });
        if (mode === 'prompt-safety') Object.assign(f.native, { logprobsResult: native });
        const response = await f.handler(f.request(base, { logprobs: true, top_logprobs: 0 }));
        assert.equal(response.status, 200);
        const result = (await response.json()) as ChatCompletion;
        assert.equal(result.choices[0].finish_reason, 'content_filter');
        assert.equal(result.choices[0].message.content, null);
        assert.equal(result.choices[0].logprobs, undefined);
        assert.doesNotMatch(JSON.stringify(result), /private|forged|logprobs/u);
        assert.equal(f.records[0]?.outcome, 'succeeded');
        probabilityPrivacy(f);
      }
  });
const chosenOnly = {
  content: [
    {
      token: nativeProbabilityToken.token,
      logprob: nativeProbabilityToken.logProbability,
      bytes: null,
      top_logprobs: [],
    },
  ],
};
for (const [index, [native, expected]] of [
  [undefined, undefined],
  [null, undefined],
  [{}, { content: [] }],
  [{ chosenCandidates: null, topCandidates: null }, { content: [] }],
  [{ chosenCandidates: [], topCandidates: [] }, { content: [] }],
  ...[undefined, null, []].map((topCandidates) => [
    {
      chosenCandidates: [nativeProbabilityToken],
      ...(topCandidates === undefined ? {} : { topCandidates }),
    },
    chosenOnly,
  ]),
  ...[undefined, null, []].map((candidates) => [
    {
      chosenCandidates: [nativeProbabilityToken],
      topCandidates: [candidates === undefined ? {} : { candidates }],
    },
    chosenOnly,
  ]),
  [
    {
      chosenCandidates: [{ token: '', logProbability: 0 }],
      topCandidates: [{ candidates: [{ token: '🙂', logProbability: 1.25 }] }],
    },
    {
      content: [
        {
          token: '',
          logprob: 0,
          bytes: null,
          top_logprobs: [{ token: '🙂', logprob: 1.25, bytes: null }],
        },
      ],
    },
  ],
  [
    {
      chosenCandidates: [nativeProbabilityToken],
      topCandidates: [{ candidates: new Array(20).fill(nativeProbabilityAlternative) }],
    },
    {
      content: [
        {
          ...chosenOnly.content[0],
          top_logprobs: new Array(20).fill({
            token: nativeProbabilityAlternative.token,
            logprob: nativeProbabilityAlternative.logProbability,
            bytes: null,
          }),
        },
      ],
    },
  ],
].entries())
  test(`Gemini: native unset/empty/alignment/token shape ${index} preserves reported data`, async () => {
    for (const base of bases) {
      const f = geminiProbabilityFixture(native, { absent: native === undefined });
      const response = await f.handler(f.request(base));
      assert.equal(response.status, 200);
      const result = (await response.json()) as ChatCompletion;
      assert.deepEqual(result.choices[0].logprobs, expected);
      probabilityPrivacy(f);
    }
  });
const invalid = [
  1,
  'private',
  [],
  { private: 'unknown' },
  { chosenCandidates: 'private' },
  { topCandidates: {} },
  { chosenCandidates: [null] },
  { chosenCandidates: new Array(1) },
  { chosenCandidates: [], topCandidates: [{}] },
  { chosenCandidates: [nativeProbabilityToken], topCandidates: [{}, {}] },
  { chosenCandidates: [nativeProbabilityToken], topCandidates: [null] },
  { chosenCandidates: [nativeProbabilityToken], topCandidates: [{ candidates: [null] }] },
  { chosenCandidates: [nativeProbabilityToken], topCandidates: [{ candidates: 'private' }] },
  { chosenCandidates: [nativeProbabilityToken], topCandidates: [{ unknown: 1 }] },
  ...[
    { token: undefined },
    { token: null },
    { token: 1 },
    { token: 'x'.repeat(16385) },
    { logProbability: undefined },
    { logProbability: null },
    { logProbability: 'private' },
    { logProbability: NaN },
    { logProbability: Infinity },
    { tokenId: -2147483649 },
    { tokenId: 2147483648 },
    { tokenId: 0.5 },
    { tokenId: 'private' },
    { unknown: 'private' },
  ].map((change) => ({ chosenCandidates: [{ ...nativeProbabilityToken, ...change }] })),
  {
    chosenCandidates: [nativeProbabilityToken],
    topCandidates: [{ candidates: new Array(21).fill(nativeProbabilityAlternative) }],
  },
  ...[NaN, Infinity, 'private', {}].map((logProbabilitySum) => ({
    ...nativeProbabilityResult,
    logProbabilitySum,
  })),
  { chosenCandidates: new Array(65537).fill({ token: '', logProbability: 0 }) },
  { chosenCandidates: new Array(65).fill({ token: 'x'.repeat(16384), logProbability: 0 }) },
];
for (const [index, native] of invalid.entries())
  test(`Gemini: malformed native probability response ${index} fails safely after opening`, async () => {
    const f = geminiProbabilityFixture(native, { raw: true });
    const response = await f.handler(f.request('/api/v1'));
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /private|forged|xxxx|Invalid|fixture-.*key/u);
    assert.equal(f.records.length, 1);
    assert.equal(f.records[0]?.outcome, 'failed');
    assert.equal(f.records[0]?.possiblyBilled, true);
    assert.equal(f.records[0]?.usage.status, 'missing');
    probabilityPrivacy(f);
  });
test('Gemini: request controls are captured before credentials, output is deep immutable', async () => {
  const fields = { logprobs: true, top_logprobs: 0 },
    native = structuredClone(nativeProbabilityResult);
  const f = geminiProbabilityFixture(native, {
    raw: true,
    mutate: () => {
      fields.logprobs = false;
      fields.top_logprobs = 21;
    },
  });
  const result = await f.call(fields);
  const config = f.sent[0]?.generationConfig as Record<string, unknown>;
  assert.equal(config.responseLogprobs, true);
  assert.equal(config.logprobs, 0);
  assert.deepEqual(result.choices[0].logprobs, geminiProbabilityGroups);
  native.chosenCandidates[0]!.token = 'changed';
  native.topCandidates[0]!.candidates[0]!.token = 'changed';
  assert.deepEqual(result.choices[0].logprobs, geminiProbabilityGroups);
  assert.ok(Object.isFrozen(result.choices[0].logprobs?.content?.[0]?.top_logprobs[0]));
});
test('Gemini: response accessors are captured once and array length cannot grow during capture', async () => {
  let tokenReads = 0,
    probabilityReads = 0;
  const chosen: object[] = [];
  chosen.push({
    get token() {
      tokenReads++;
      chosen.push({ token: 'private growth', logProbability: 1 });
      return 'private first';
    },
    get logProbability() {
      probabilityReads++;
      return probabilityReads === 1 ? 0 : NaN;
    },
  });
  const f = geminiProbabilityFixture({ chosenCandidates: chosen }, { raw: true });
  const result = await f.call();
  assert.deepEqual(result.choices[0].logprobs, {
    content: [{ token: 'private first', logprob: 0, bytes: null, top_logprobs: [] }],
  });
  assert.equal(tokenReads, 1);
  assert.equal(probabilityReads, 1);
});
test('Gemini: exact maximum combined token units and signed-int32 IDs are preserved without byte synthesis', async () => {
  const native = {
    chosenCandidates: new Array(64).fill({
      token: 'x'.repeat(16384),
      tokenId: -2147483648,
      logProbability: 0,
    }),
    topCandidates: [],
  };
  const f = geminiProbabilityFixture(native, { raw: true });
  const result = await f.call({ logprobs: true });
  assert.equal(result.choices[0].logprobs?.content?.length, 64);
  assert.equal(result.choices[0].logprobs?.content?.[0]?.bytes, null);
  assert.equal(Object.hasOwn(result.choices[0].logprobs?.content?.[0] ?? {}, 'tokenId'), false);
});
for (const kind of ['google', 'anthropic'] as const)
  test(`${kind}: native stream probability controls still fail before secrets`, async () => {
    for (const functions of [false, true]) {
      const f = probabilityFixture(kind);
      await assert.rejects(() => f.stream(functions, { logprobs: true, top_logprobs: 0 }));
      assert.equal(f.counts().secrets, 0);
    }
  });
