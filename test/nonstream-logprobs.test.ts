import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatCompletion } from '../src/providers/direct-chat.ts';
import {
  probabilityFixture,
  probabilityGroups,
  probabilityPrivacy,
  probabilityToken,
  probabilityTools,
} from './nonstream-logprobs-fixture.ts';

const bases = ['/v1', '/api/v1'];
const supported = ['openai', 'openrouter'] as const;
const token = (fields: Record<string, unknown>) => ({ ...probabilityToken, ...fields });
const controls = [
  {},
  { logprobs: null, top_logprobs: null },
  { logprobs: false },
  { logprobs: true },
  { logprobs: true, top_logprobs: 0 },
  { logprobs: true, top_logprobs: 20 },
];
for (const kind of supported) {
  for (const [index, fields] of controls.entries())
    test(`${kind}: exact nonstream probability controls ${index} across both bases`, async () => {
      for (const base of bases) {
        const f = probabilityFixture(kind);
        const response = await f.handler(f.request(base, fields));
        assert.equal(response.status, 200);
        assert.equal(f.sent[0]?.logprobs, fields.logprobs ?? undefined);
        assert.equal(f.sent[0]?.top_logprobs, fields.top_logprobs ?? undefined);
        assert.deepEqual(
          ((await response.json()) as ChatCompletion).choices[0].logprobs,
          probabilityGroups,
        );
        assert.equal(f.records.length, 1);
        assert.equal(f.records[0]?.usage.totalTokens, 3);
        assert.equal(
          f.records[0]?.actualInferenceProviderId,
          kind === 'openrouter' ? null : 'provider',
        );
        if (kind === 'openrouter') assert.deepEqual(f.sent[0]?.provider, { only: ['provider'] });
        probabilityPrivacy(f);
      }
    });
  for (const [index, groups] of [
    undefined,
    null,
    { content: null },
    { content: [], refusal: [] },
    { content: null, refusal: [probabilityToken] },
    { content: [{ token: '', logprob: 0, bytes: [], top_logprobs: [] }] },
    {
      content: [
        {
          token: '🙂',
          logprob: 1.25,
          bytes: null,
          top_logprobs: Array.from({ length: 20 }, () => ({
            token: 'a',
            logprob: -1,
            bytes: [97],
          })),
        },
      ],
    },
  ].entries())
    test(`${kind}: probability group shape ${index} preserves supplied fields`, async () => {
      for (const base of bases) {
        const f = probabilityFixture(kind, groups, { absent: groups === undefined });
        const response = await f.handler(f.request(base));
        assert.equal(response.status, 200);
        assert.deepEqual(((await response.json()) as ChatCompletion).choices[0].logprobs, groups);
        probabilityPrivacy(f);
      }
    });
  for (const mode of ['text', 'refusal', 'function'] as const)
    test(`${kind}: ${mode} probability projections do not fabricate missing usage`, async () => {
      for (const base of bases) {
        const f = probabilityFixture(kind, probabilityGroups, { mode, missingUsage: true });
        const response = await f.handler(
          f.request(base, {
            logprobs: true,
            ...(mode === 'function' ? { tools: probabilityTools } : {}),
          }),
        );
        assert.equal(response.status, 200);
        const result = (await response.json()) as ChatCompletion;
        assert.deepEqual(result.choices[0].logprobs, probabilityGroups);
        assert.equal(result.usage, undefined);
        assert.equal(f.records[0]?.usage.status, 'missing');
        assert.equal(f.records[0]?.usage.totalTokens, null);
        if (mode === 'function')
          assert.equal(result.choices[0].message.tool_calls?.[0]?.id, 'call');
        if (mode === 'refusal') assert.equal(result.choices[0].message.refusal, 'private refusal');
        probabilityPrivacy(f);
      }
    });
  test(`${kind}: request scalars are captured before credentials and responses are deeply immutable`, async () => {
    const fields = { logprobs: true, top_logprobs: 3 };
    const f = probabilityFixture(kind, probabilityGroups, {
      mutate: () => {
        fields.logprobs = false;
        fields.top_logprobs = 21;
      },
    });
    const result = await f.call(fields);
    assert.equal(f.sent[0]?.logprobs, true);
    assert.equal(f.sent[0]?.top_logprobs, 3);
    const captured = result.choices[0].logprobs;
    assert.deepEqual(captured, probabilityGroups);
    assert.ok(captured && Object.isFrozen(captured));
    assert.ok(Object.isFrozen(captured.content));
    assert.ok(Object.isFrozen(captured.content?.[0]));
    assert.ok(Object.isFrozen(captured.content?.[0]?.bytes));
    assert.ok(Object.isFrozen(captured.content?.[0]?.top_logprobs));
    assert.ok(Object.isFrozen(captured.content?.[0]?.top_logprobs[0]));
    assert.equal(Reflect.set(captured.content?.[0] as object, 'token', 'changed'), false);
    assert.deepEqual(captured, probabilityGroups);
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
    test(`${kind}: probability controls preserve ${gate} gate`, async () => {
      for (const base of bases) {
        const f = probabilityFixture(kind, probabilityGroups, { gate });
        const response = await f.handler(f.request(base, { logprobs: true, top_logprobs: 20 }));
        assert.equal(response.status, status);
        assert.doesNotMatch(await response.text(), /private|forged|fixture-provider-key/u);
        assert.equal(f.sent.length, gate === 'audit' || gate === 'usage' ? 1 : 0);
        assert.equal(f.counts().secrets, f.sent.length);
        probabilityPrivacy(f);
      }
    });
  test(`${kind}: fixed transport failures retain one failed possibly billed record`, async () => {
    const f = probabilityFixture(kind, probabilityGroups, { transportFails: true });
    const response = await f.handler(f.request('/api/v1', { logprobs: true }));
    assert.equal(response.status, 502);
    assert.equal(f.records.length, 1);
    assert.equal(f.records[0]?.outcome, 'failed');
    assert.equal(f.records[0]?.possiblyBilled, true);
    probabilityPrivacy(f);
  });
}

for (const kind of supported) {
  test(`${kind}: maximum token string, byte and combined payload bounds remain accepted`, async () => {
    for (const groups of [
      {
        content: [
          {
            token: 'x'.repeat(16384),
            logprob: -1,
            bytes: new Array(1024).fill(255),
            top_logprobs: [],
          },
        ],
      },
      {
        content: Array.from({ length: 64 }, () => ({
          token: 'x'.repeat(16384),
          logprob: -1,
          bytes: null,
          top_logprobs: [],
        })),
      },
      {
        content: Array.from({ length: 65536 }, () => ({
          token: '',
          logprob: -1,
          bytes: null,
          top_logprobs: [],
        })),
      },
    ]) {
      const f = probabilityFixture(kind, groups);
      const result = await f.call();
      assert.deepEqual(result.choices[0].logprobs, groups);
    }
  });
  test(`${kind}: probability counters include refusal groups and alternatives`, async () => {
    const minimal = { token: '', logprob: -1, bytes: null, top_logprobs: [] };
    for (const groups of [
      {
        content: Array.from({ length: 32769 }, () => minimal),
        refusal: Array.from({ length: 32768 }, () => minimal),
      },
      {
        content: Array.from({ length: 63 }, () => ({ ...minimal, token: 'x'.repeat(16384) })),
        refusal: [{ ...minimal, token: 'x'.repeat(16384), bytes: [0] }],
      },
      {
        content: Array.from({ length: 64 }, () => ({ ...minimal, token: 'x'.repeat(16384) })),
        refusal: [{ ...minimal, top_logprobs: [{ token: 'x', logprob: -1, bytes: null }] }],
      },
    ]) {
      const f = probabilityFixture(kind, groups);
      await assert.rejects(() => f.call());
      assert.equal(f.sent.length, 1);
    }
  });
  test(`${kind}: raw adapter values reject sparse lists and nonfinite probabilities without leaking`, async () => {
    for (const groups of [
      { content: new Array(1) },
      { content: [token({ bytes: new Array(1) })] },
      { content: [token({ top_logprobs: new Array(1) })] },
      { content: [token({ logprob: NaN })] },
      { content: [token({ logprob: Infinity })] },
      {
        content: [token({ top_logprobs: [{ token: 'private', bytes: null, logprob: -Infinity }] })],
      },
      { content: null, refusal: undefined },
    ]) {
      const f = probabilityFixture(kind, groups, { raw: true });
      await assert.rejects(
        () => f.call(),
        (e: unknown) => e instanceof Error && !/private|forged/u.test(e.message),
      );
      assert.equal(f.sent.length, 1);
    }
  });
  test(`${kind}: returned nested arrays cannot alias the upstream response`, async () => {
    const groups = structuredClone(probabilityGroups);
    const f = probabilityFixture(kind, groups, { raw: true });
    const result = await f.call();
    groups.content[0]!.token = 'changed';
    groups.content[0]!.bytes[0] = 3;
    groups.content[0]!.top_logprobs[0]!.token = 'changed';
    assert.deepEqual(result.choices[0].logprobs, probabilityGroups);
  });
  test(`${kind}: adapter array snapshots keep their initial lengths across accessors`, async () => {
    for (const target of ['content', 'alternatives', 'bytes']) {
      const groups = structuredClone(probabilityGroups);
      const initial = structuredClone(groups);
      const first = groups.content[0];
      assert.ok(first);
      if (target === 'content') {
        Object.defineProperty(groups.content, '0', {
          get: () => {
            groups.content.push(first);
            return first;
          },
        });
      } else if (target === 'alternatives') {
        const alternative = first.top_logprobs[0];
        assert.ok(alternative);
        Object.defineProperty(first.top_logprobs, '0', {
          get: () => {
            first.top_logprobs.push(alternative);
            return alternative;
          },
        });
      } else {
        const byte = first.bytes[0];
        Object.defineProperty(first.bytes, '0', {
          get: () => {
            first.bytes.push(255);
            return byte;
          },
        });
      }
      const f = probabilityFixture(kind, groups, { raw: true });
      const result = await f.call();
      assert.deepEqual(result.choices[0].logprobs, initial);
    }
  });
}

const malformedControls = [
  { logprobs: 1 },
  { logprobs: 'private' },
  { logprobs: [] },
  { logprobs: {} },
  { top_logprobs: 0 },
  { logprobs: false, top_logprobs: 1 },
  { logprobs: null, top_logprobs: 1 },
  ...[-1, 21, 1.5, 'private', true, [], {}].map((top_logprobs) => ({
    logprobs: true,
    top_logprobs,
  })),
];
for (const kind of ['openai', 'openrouter', 'anthropic', 'google'] as const) {
  test(`${kind}: invalid controls reject before routing and adapter secrets`, async () => {
    for (const fields of malformedControls) {
      for (const base of bases) {
        const f = probabilityFixture(kind);
        const response = await f.handler(f.request(base, fields));
        assert.equal(response.status, 400);
        assert.equal(f.counts().routes, 0);
        assert.equal(f.counts().secrets, 0);
        assert.equal(f.records.length, 0);
        assert.doesNotMatch(await response.text(), /private/u);
      }
      const f = probabilityFixture(kind);
      await assert.rejects(() => f.call(fields));
      assert.equal(f.counts().secrets, 0);
    }
    for (const top_logprobs of [NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const f = probabilityFixture(kind);
      await assert.rejects(() => f.call({ logprobs: true, top_logprobs }));
      assert.equal(f.counts().secrets, 0);
    }
  });
  for (const functions of [false, true])
    test(`${kind}: ${functions ? 'function' : 'text'} stream controls retain native pre-secret rejection and supported media-type failure`, async () => {
      for (const fields of [
        { logprobs: false },
        { logprobs: true },
        { logprobs: true, top_logprobs: 0 },
      ]) {
        for (const base of bases) {
          const f = probabilityFixture(kind);
          const response = await f.handler(
            f.request(base, {
              ...fields,
              stream: true,
              ...(functions ? { tools: [{ type: 'function', function: { name: 'lookup' } }] } : {}),
            }),
          );
          assert.equal(response.status, 502);
          assert.equal(f.counts().secrets, kind === 'openai' || kind === 'openrouter' ? 1 : 0);
        }
        const f = probabilityFixture(kind);
        await assert.rejects(() => f.stream(functions, fields));
        const opened = kind === 'openai' || kind === 'openrouter' ? 1 : 0;
        assert.equal(f.counts().secrets, opened);
        assert.equal(f.sent.length, opened);
      }
    });
}
for (const kind of ['anthropic', 'google'] as const)
  test(`${kind}: omission/null and supplied controls follow native availability`, async () => {
    for (const fields of controls)
      for (const base of bases) {
        const f = probabilityFixture(kind);
        const supplied =
          kind === 'anthropic' && fields.logprobs !== undefined && fields.logprobs !== null;
        const response = await f.handler(f.request(base, fields));
        assert.equal(response.status, supplied ? 502 : 200);
        assert.equal(f.counts().secrets, supplied ? 0 : 1);
        assert.equal(f.sent.length, supplied ? 0 : 1);
        probabilityPrivacy(f);
      }
  });

const invalidGroups = [
  1,
  'private',
  [],
  {},
  { content: undefined },
  { content: {} },
  { content: [null] },
  { content: null, refusal: {} },
  { content: [], extra: 'private' },
  ...[
    { token: null },
    { token: 'x'.repeat(16385) },
    { logprob: null },
    { logprob: 'private' },
    { logprob: NaN },
    { logprob: Infinity },
    { bytes: undefined },
    { bytes: [-1] },
    { bytes: [256] },
    { bytes: [1.5] },
    { bytes: [null] },
    { bytes: true },
    { bytes: new Array(1025).fill(0) },
    { top_logprobs: undefined },
    { top_logprobs: null },
    { top_logprobs: [null] },
    { top_logprobs: Array.from({ length: 21 }, () => ({ token: 'a', logprob: -1, bytes: null })) },
    { top_logprobs: [{ token: 'a', logprob: -1 }] },
    { top_logprobs: [{ token: 'a', logprob: -1, bytes: [256] }] },
    { top_logprobs: [{ token: 'a', logprob: -1, bytes: null, top_logprobs: [] }] },
    { extra: 'private' },
  ].map((fields) => ({ content: [token(fields)] })),
  {
    content: Array.from({ length: 65537 }, () =>
      token({ token: '', bytes: null, top_logprobs: [] }),
    ),
  },
  {
    content: Array.from({ length: 65 }, () =>
      token({ token: 'x'.repeat(16384), bytes: null, top_logprobs: [] }),
    ),
  },
  { content: [], refusal: [token({ bytes: [256] })] },
];
for (const kind of supported)
  for (const [index, groups] of invalidGroups.entries())
    test(`${kind}: malformed probability response ${index} fails safely after opening`, async () => {
      for (const base of bases) {
        const f = probabilityFixture(kind, groups);
        const response = await f.handler(f.request(base));
        assert.equal(response.status, 502);
        assert.doesNotMatch(await response.text(), /private|forged|fixture-provider-key/u);
        assert.equal(f.records.length, 1);
        assert.equal(f.records[0]?.outcome, 'failed');
        assert.equal(f.records[0]?.possiblyBilled, true);
        assert.equal(f.records[0]?.usage.status, 'missing');
        probabilityPrivacy(f);
      }
    });
