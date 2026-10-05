import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';
import {
  predictionFixture,
  predictionPrivacy,
  stringPrediction,
  suppliedPrediction,
} from './predicted-output-fixture.ts';

const bases = ['/v1', '/api/v1'];
const valid = [
  undefined,
  null,
  { type: 'content', content: '' },
  { type: 'content', content: '  CaseSensitive Expected  ' },
  stringPrediction,
  suppliedPrediction,
  { type: 'content', content: [] },
  {
    type: 'content',
    content: Array.from({ length: 128 }, (_, i) => ({ type: 'text', text: `private part ${i}` })),
  },
  { type: 'content', content: 'private'.repeat(1024) },
];
const invalid = [
  false,
  0,
  'private',
  [],
  {},
  { type: 'private', content: '' },
  { type: 'content' },
  { content: 'private' },
  { type: 'content', content: null },
  { type: 'content', content: 1 },
  { type: 'content', content: { text: 'private' } },
  { type: 'content', content: [null] },
  { type: 'content', content: [{ type: 'text' }] },
  { type: 'content', content: [{ type: 'image', text: 'private' }] },
  { type: 'content', content: [{ type: 'text', text: 1 }] },
  { type: 'content', content: [{ type: 'text', text: 'private', prompt_cache_breakpoint: true }] },
  { type: 'content', content: 'private', private: 'forged' },
  {
    type: 'content',
    content: Array.from({ length: 129 }, () => ({ type: 'text', text: 'private' })),
  },
];
const history = [
  { role: 'user', content: 'private prompt' },
  {
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } }],
  },
  { role: 'tool', tool_call_id: 'call', content: 'private result' },
];
const restricted = [
  { tools: [] },
  { tools: probabilityTools },
  { tool_choice: 'none' },
  { parallel_tool_calls: false },
  { logprobs: false },
  { logprobs: true },
  { logprobs: true, top_logprobs: 0 },
  { frequency_penalty: 0.1 },
  { presence_penalty: 0.1 },
  { max_completion_tokens: 1 },
  { max_tokens: 1, max_completion_tokens: 1 },
  { messages: history },
];
for (const kind of ['openai', 'openrouter'] as const)
  for (const stream of [false, true])
    for (const mode of ['text', 'refusal'] as const) {
      const controls = stream ? { stream: true } : {};
      test(`${kind} ${mode} stream=${stream}: exact predicted strings/parts/null survive both bases`, async () => {
        for (const base of bases)
          for (const prediction of valid) {
            const f = predictionFixture(kind, { stream, mode });
            const response = await f.handler(
              f.request(base, { ...controls, ...(prediction === undefined ? {} : { prediction }) }),
            );
            assert.equal(response.status, 200);
            const body = await response.text();
            assert.doesNotMatch(
              body,
              /predicted output|predicted string|second part|CaseSensitive Expected|private part/u,
            );
            if (stream) assert.ok(body.endsWith('data: [DONE]\n\n'));
            assert.deepEqual(f.sent[0]?.prediction, prediction ?? undefined);
            assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'prediction'), prediction != null);
            assert.equal(f.sent[0]?.model, 'upstream-model');
            if (kind === 'openrouter')
              assert.deepEqual(f.sent[0]?.provider, { only: ['provider'] });
            assert.equal(f.records[0]?.outcome, 'succeeded');
            assert.equal(f.records[0]?.usage.totalTokens, 3);
            predictionPrivacy(f);
          }
      });
      test(`${kind} ${mode} stream=${stream}: prediction preserves IAM/limits/persistence gates`, async () => {
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
            const f = predictionFixture(kind, { stream, mode, gate });
            const response = await f.handler(
              f.request(base, { ...controls, prediction: suppliedPrediction }),
            );
            assert.equal(
              response.status,
              stream && (gate === 'audit' || gate === 'usage') ? 200 : status,
              gate,
            );
            assert.doesNotMatch(
              await response.text(),
              /predicted output|second part|fixture-.*key|\[DONE\]/u,
            );
            assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0);
            predictionPrivacy(f);
          }
      });
      test(`${kind} ${mode} stream=${stream}: expected output cannot supply missing usage`, async () => {
        const f = predictionFixture(kind, { stream, mode, missingUsage: true });
        const response = await f.handler(
          f.request('/api/v1', { ...controls, prediction: suppliedPrediction }),
        );
        assert.equal(response.status, 200);
        assert.doesNotMatch(await response.text(), /predicted output|second part/u);
        assert.equal(f.records[0]?.usage.status, 'missing');
        assert.equal(f.records[0]?.usage.totalTokens, null);
        predictionPrivacy(f);
      });
    }
for (const kind of ['openai', 'openrouter', 'anthropic', 'google'] as const)
  for (const stream of [false, true])
    test(`${kind} stream=${stream}: malformed prediction fails before routes or secrets`, async () => {
      for (const base of bases)
        for (const prediction of invalid) {
          const f = predictionFixture(kind, { stream });
          const response = await f.handler(
            f.request(base, { prediction, ...(stream ? { stream: true } : {}) }),
          );
          assert.equal(response.status, 400);
          assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
          assert.doesNotMatch(await response.text(), /private|forged|fixture-.*key/u);
          predictionPrivacy(f);
        }
      for (const prediction of [
        ...invalid,
        new Date(),
        Object.create({ type: 'content', content: 'private' }),
      ]) {
        const f = predictionFixture(kind, { stream });
        await assert.rejects(
          () => (stream ? f.stream(false, { prediction }) : f.call({ prediction })),
          (e: unknown) => {
            assert.ok(e instanceof Error);
            assert.doesNotMatch(e.message, /private|forged/u);
            return true;
          },
        );
        assert.equal(f.counts().secrets, 0);
      }
    });
for (const kind of ['openai', 'openrouter'] as const)
  for (const stream of [false, true]) {
    test(`${kind} stream=${stream}: conservative prediction combinations reject before routes/credentials`, async () => {
      for (const fields of restricted) {
        for (const base of bases) {
          const f = predictionFixture(kind, { stream });
          const response = await f.handler(
            f.request(base, {
              ...fields,
              prediction: suppliedPrediction,
              ...(stream ? { stream: true } : {}),
            }),
          );
          assert.equal(response.status, 400);
          assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
          predictionPrivacy(f);
        }
        const f = predictionFixture(kind, { stream });
        await assert.rejects(() =>
          stream
            ? f.stream(true, { ...fields, prediction: suppliedPrediction })
            : f.call({ ...fields, prediction: suppliedPrediction }),
        );
        assert.equal(f.counts().secrets, 0);
      }
    });
    test(`${kind} stream=${stream}: nonpositive penalties and existing max_tokens retain exact passthrough`, async () => {
      const f = predictionFixture(kind, { stream });
      const response = await f.handler(
        f.request('/api/v1', {
          prediction: stringPrediction,
          max_tokens: 5,
          frequency_penalty: -1,
          presence_penalty: 0,
          max_completion_tokens: null,
          logprobs: null,
          top_logprobs: null,
          parallel_tool_calls: null,
          ...(stream ? { stream: true } : {}),
        }),
      );
      assert.equal(response.status, 200);
      await response.text();
      assert.deepEqual(f.sent[0]?.prediction, stringPrediction);
      assert.equal(f.sent[0]?.max_tokens, 5);
      assert.equal(f.sent[0]?.frequency_penalty, -1);
      assert.equal(f.sent[0]?.presence_penalty, 0);
      predictionPrivacy(f);
    });
    test(`${kind} stream=${stream}: immutable root/content/type/text snapshots precede secrets`, async () => {
      let root = 0,
        content = 0,
        type = 0,
        text = 0;
      const part: Record<string, unknown> = Object.create(null);
      Object.defineProperties(part, {
        type: {
          enumerable: true,
          configurable: true,
          get() {
            type++;
            return type === 1 ? 'text' : 'private';
          },
        },
        text: {
          enumerable: true,
          configurable: true,
          get() {
            text++;
            return text === 1 ? 'private original prediction' : 42;
          },
        },
      });
      const parts = [part],
        prediction = {
          type: 'content',
          get content() {
            content++;
            return content === 1 ? parts : null;
          },
        };
      const fields = {
        get prediction() {
          root++;
          return root === 1 ? prediction : null;
        },
      };
      const f = predictionFixture(kind, {
        stream,
        mutate: () => {
          assert.deepEqual([root, content, type, text], [1, 1, 1, 1]);
          Object.defineProperties(part, {
            type: { value: 'private', enumerable: true },
            text: { value: 'private changed', enumerable: true },
          });
          parts.push({ type: 'text', text: 'private late' });
        },
      });
      if (stream) await f.stream(false, fields);
      else await f.call(fields);
      assert.deepEqual(f.sent[0]?.prediction, {
        type: 'content',
        content: [{ type: 'text', text: 'private original prediction' }],
      });
      assert.deepEqual([root, content, type, text], [1, 1, 1, 1]);
      predictionPrivacy(f);
    });
    test(`${kind} stream=${stream}: throwing prediction accessors are sanitized before secrets`, async () => {
      for (const fields of [
        {
          get prediction() {
            throw Error('private root');
          },
        },
        {
          prediction: {
            get type() {
              throw Error('private type');
            },
            content: '',
          },
        },
        {
          prediction: {
            type: 'content',
            get content() {
              throw Error('private content');
            },
          },
        },
        {
          prediction: {
            type: 'content',
            content: [
              {
                type: 'text',
                get text() {
                  throw Error('private text');
                },
              },
            ],
          },
        },
      ]) {
        const f = predictionFixture(kind, { stream });
        await assert.rejects(
          () => (stream ? f.stream(false, fields) : f.call(fields)),
          (e: unknown) => {
            assert.ok(e instanceof Error);
            assert.doesNotMatch(e.message, /private|root|content|text|type/u);
            return true;
          },
        );
        assert.equal(f.counts().secrets, 0);
      }
    });
  }
for (const kind of ['anthropic', 'google'] as const)
  test(`${kind}: predictions reject without native prefill while null preserves defaults`, async () => {
    for (const stream of [false, true])
      for (const prediction of [
        stringPrediction,
        suppliedPrediction,
        { type: 'content', content: [] },
      ]) {
        const f = predictionFixture(kind, { stream });
        await assert.rejects(() =>
          stream ? f.stream(false, { prediction }) : f.call({ prediction }),
        );
        assert.equal(f.counts().secrets, 0);
        assert.equal(f.sent.length, 0);
      }
    for (const base of bases)
      for (const prediction of [undefined, null]) {
        const f = predictionFixture(kind);
        const response = await f.handler(f.request(base, { prediction }));
        assert.equal(response.status, 200);
        await response.text();
        assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'prediction'), false);
        predictionPrivacy(f);
      }
  });
for (const kind of ['openai', 'openrouter'] as const) {
  test(`${kind}: predicted content keeps safe opened-failure accounting`, async () => {
    const f = predictionFixture(kind, { transportFails: true });
    const response = await f.handler(f.request('/api/v1', { prediction: suppliedPrediction }));
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /private|predicted|fixture-.*key/u);
    assert.equal(f.records[0]?.outcome, 'failed');
    assert.equal(f.records[0]?.possiblyBilled, true);
    predictionPrivacy(f);
  });
  test(`${kind}: expected output stays independent from user/cache placement/arbitrary tags`, async () => {
    for (const stream of [false, true]) {
      const f = predictionFixture(kind, { stream });
      const response = await f.handler(
        f.request('/api/v1', {
          prediction: stringPrediction,
          user: 'private end-user',
          prompt_cache_key: 'private placement',
          metadata: { prediction: 'private arbitrary tag' },
          ...(stream ? { stream: true } : {}),
        }),
      );
      assert.equal(response.status, 200);
      assert.doesNotMatch(
        await response.text(),
        /predicted string|end-user|placement|arbitrary tag/u,
      );
      assert.deepEqual(f.sent[0]?.prediction, stringPrediction);
      assert.equal(f.sent[0]?.user, 'private end-user');
      assert.equal(f.sent[0]?.prompt_cache_key, 'private placement');
      assert.deepEqual(f.sent[0]?.metadata, { prediction: 'private arbitrary tag' });
      predictionPrivacy(f);
    }
  });
  test(`${kind}: predicted text preserves body cancellation with failed billed attribution`, {
    timeout: 3000,
  }, async () => {
    for (const base of bases) {
      const f = predictionFixture(kind, { stream: true });
      let finish: () => void = () => {};
      const interrupted = new Promise<void>((r) => {
        finish = r;
      });
      const handler = createChatHandler({
        ...f.ports,
        writeAudit: async (e) => {
          await f.ports.writeAudit(e);
          if (e.kind === 'stream-interrupted') finish();
        },
      });
      const response = await handler(
        f.request(base, { stream: true, prediction: suppliedPrediction }),
      );
      assert.equal(response.status, 200);
      const reader = response.body?.getReader();
      assert.ok(reader);
      assert.equal((await reader.read()).done, false);
      await reader.cancel('private caller cancellation');
      await interrupted;
      assert.equal(f.records.length, 1);
      assert.equal(f.records[0]?.outcome, 'failed');
      assert.equal(f.records[0]?.possiblyBilled, true);
      predictionPrivacy(f);
    }
  });
}
test('prediction preserves the existing complete HTTP body bound', async () => {
  for (const base of bases) {
    const f = predictionFixture('openai');
    const response = await f.handler(
      f.request(base, { prediction: { type: 'content', content: 'private'.repeat(150000) } }),
    );
    assert.equal(response.status, 400);
    assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
    assert.doesNotMatch(await response.text(), /private|fixture-.*key/u);
  }
});

for (const kind of ['openai', 'openrouter'] as const)
  for (const stream of [false, true])
    test(`${kind} stream=${stream}: nullable completion alias is captured once for prediction and output caps`, async () => {
      let reads = 0;
      const fields = {
        prediction: stringPrediction,
        max_tokens: 5,
        get max_completion_tokens() {
          reads++;
          return reads === 1 ? null : 1;
        },
      };
      const f = predictionFixture(kind, { stream, mutate: () => assert.equal(reads, 1) });
      if (stream) await f.stream(false, fields);
      else await f.call(fields);
      assert.equal(reads, 1);
      assert.equal(f.sent[0]?.max_tokens, 5);
      assert.deepEqual(f.sent[0]?.prediction, stringPrediction);
      predictionPrivacy(f);
    });
for (const kind of ['openai', 'openrouter'] as const)
  test(`${kind}: provider prediction token categories stay informational and do not infer billed savings`, async () => {
    const details = { accepted_prediction_tokens: 1, rejected_prediction_tokens: 2 };
    const f = predictionFixture(kind, {
      reply: () =>
        Response.json({
          id: 'completion',
          created: 42,
          model: 'upstream-model',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'reply' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 3, completion_tokens_details: details },
        }),
    });
    const response = await f.handler(f.request('/api/v1', { prediction: suppliedPrediction }));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { usage: { completion_tokens_details: unknown } };
    assert.deepEqual(body.usage.completion_tokens_details, details);
    assert.equal(f.records[0]?.usage.totalTokens, 5);
    assert.doesNotMatch(
      JSON.stringify({ records: f.records, audits: f.audits }),
      /accepted_prediction|rejected_prediction|private|savings/u,
    );
    predictionPrivacy(f);
  });

for (const kind of ['openai', 'openrouter'] as const)
  test(`${kind}: actual upstream text may match the prediction without synthetic request-field echo`, async () => {
    const f = predictionFixture(kind, {
      reply: () =>
        Response.json({
          id: 'completion',
          created: 42,
          model: 'upstream-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: stringPrediction.content },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        }),
    });
    const response = await f.handler(f.request('/api/v1', { prediction: stringPrediction }));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { choices: { message: { content: string } }[] };
    assert.equal(body.choices[0]?.message.content, stringPrediction.content);
    assert.equal(Object.hasOwn(body, 'prediction'), false);
    assert.equal(f.records[0]?.usage.totalTokens, 3);
    predictionPrivacy(f);
  });
