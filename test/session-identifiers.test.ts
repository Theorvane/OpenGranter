import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';
import {
  sessionFixture,
  sessionPrivacy,
  sessionRequest,
  suppliedSession,
} from './session-identifiers-fixture.ts';
import { resultInput } from './tool-result-cache-control-fixture.ts';

const bases = ['/v1', '/api/v1'];
const ids = [
  undefined,
  '',
  '  CaseSensitive session  ',
  suppliedSession,
  'x'.repeat(256),
  '😀'.repeat(256),
  'a\u0301'.repeat(128),
];
for (const stream of [false, true])
  for (const mode of ['text', 'refusal', 'function'] as const) {
    const controls = { stream, ...(mode === 'function' ? { tools: probabilityTools } : {}) };
    test(`${mode} stream=${stream}: exact session strings and omission survive both bases and public adapters`, async () => {
      for (const base of bases)
        for (const session_id of ids) {
          const f = sessionFixture('openrouter', { stream, mode });
          const fields = { ...controls, ...(session_id === undefined ? {} : { session_id }) };
          const r = await f.handler(f.request(base, fields));
          assert.equal(r.status, 200);
          const body = await r.text();
          assert.doesNotMatch(body, /supplied session|CaseSensitive session/u);
          if (stream) assert.ok(body.endsWith('data: [DONE]\n\n'));
          assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'session_id'), session_id !== undefined);
          assert.equal(f.sent[0]?.session_id, session_id);
          assert.deepEqual(f.sent[0]?.provider, { only: ['provider'] });
          assert.equal(f.sent[0]?.model, 'upstream-model');
          assert.equal(f.records[0]?.usage.totalTokens, 3);
          sessionPrivacy(f);
        }
      const f = sessionFixture('openrouter', { stream, mode });
      const fields = { ...controls, session_id: suppliedSession };
      if (stream) await f.stream(mode === 'function', fields);
      else await f.call(fields);
      assert.equal(f.sent[0]?.session_id, suppliedSession);
    });
    test(`${mode} stream=${stream}: selected body/header values obey precedence and invalidity`, async () => {
      for (const base of bases)
        for (const [field, header, expected, status] of [
          [{}, 'private header session', 'private header session', 200],
          [{}, '', '', 200],
          [{}, 'private'.repeat(50), undefined, 400],
          [
            { session_id: 'private body session' },
            'private header session',
            'private body session',
            200,
          ],
          [{ session_id: '' }, 'private'.repeat(50), '', 200],
          [{ session_id: null }, 'private valid header', undefined, 400],
          [{ session_id: 'x'.repeat(257) }, 'private valid header', undefined, 400],
        ] as const) {
          const f = sessionFixture('openrouter', { stream, mode });
          const r = await f.handler(sessionRequest(f, base, { ...controls, ...field }, header));
          assert.equal(r.status, status);
          await r.text();
          if (status === 400) assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
          else {
            assert.equal(f.sent[0]?.session_id, expected);
            assert.deepEqual(f.sent[0]?.provider, { only: ['provider'] });
          }
          sessionPrivacy(f);
        }
    });
    test(`${mode} stream=${stream}: body and header sessions retain all auth/IAM/limits/persistence gates`, async () => {
      for (const source of ['body', 'header'])
        for (const base of bases)
          for (const [gate, status] of [
            ['auth', 401],
            ['implicit', 403],
            ['model', 403],
            ['provider', 403],
            ['limit', 429],
            ['selection', 503],
            ['audit', 503],
            ['usage', 503],
          ] as const) {
            const f = sessionFixture('openrouter', { stream, mode, gate });
            const fields = {
              ...controls,
              ...(source === 'body' ? { session_id: suppliedSession } : {}),
            };
            const r = await f.handler(
              sessionRequest(
                f,
                base,
                fields,
                source === 'header' ? 'private supplied session' : undefined,
              ),
            );
            assert.equal(r.status, stream && (gate === 'audit' || gate === 'usage') ? 200 : status);
            assert.doesNotMatch(await r.text(), /supplied session|fixture-.*key|\[DONE\]/u);
            assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0);
            sessionPrivacy(f);
          }
    });
    test(`${mode} stream=${stream}: sessions never supply missing token usage`, async () => {
      const f = sessionFixture('openrouter', { stream, mode, missingUsage: true });
      const r = await f.handler(f.request('/api/v1', { ...controls, session_id: suppliedSession }));
      assert.equal(r.status, 200);
      await r.text();
      assert.equal(f.records[0]?.usage.status, 'missing');
      assert.equal(f.records[0]?.usage.totalTokens, null);
      sessionPrivacy(f);
    });
  }
for (const kind of ['openai', 'anthropic', 'google', 'openrouter'] as const)
  for (const stream of [false, true])
    test(`${kind} stream=${stream}: malformed or overlong selected body identifiers reject before routes/credentials`, async () => {
      for (const session_id of [
        null,
        false,
        0,
        [],
        {},
        'x'.repeat(257),
        '😀'.repeat(257),
        'a\u0301'.repeat(129),
      ]) {
        for (const base of bases) {
          const f = sessionFixture(kind, { stream });
          const r = await f.handler(f.request(base, { session_id, stream }));
          assert.equal(r.status, 400);
          assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
          assert.doesNotMatch(await r.text(), /supplied session|fixture-.*key/u);
        }
        const f = sessionFixture(kind, { stream });
        await assert.rejects(() =>
          stream ? f.stream(false, { session_id }) : f.call({ session_id }),
        );
        assert.equal(f.counts().secrets, 0);
      }
      for (const session_id of [new String('private session'), Symbol('private'), NaN]) {
        const f = sessionFixture(kind, { stream });
        await assert.rejects(() =>
          stream ? f.stream(false, { session_id }) : f.call({ session_id }),
        );
        assert.equal(f.counts().secrets, 0);
      }
    });
for (const kind of ['openai', 'anthropic', 'google'] as const)
  for (const stream of [false, true])
    test(`${kind} stream=${stream}: valid supplied session preferences reject pre-secret without inequivalent mappings`, async () => {
      for (const session_id of ['', suppliedSession]) {
        const f = sessionFixture(kind, { stream });
        await assert.rejects(() =>
          stream ? f.stream(false, { session_id }) : f.call({ session_id }),
        );
        assert.equal(f.counts().secrets, 0);
        assert.equal(f.sent.length, 0);
      }
    });
for (const stream of [false, true]) {
  test(`stream=${stream}: direct session getter is captured once before credential mutation`, async () => {
    let reads = 0,
      value = suppliedSession;
    const fields = {
      get session_id() {
        reads++;
        return value;
      },
    };
    const f = sessionFixture('openrouter', {
      stream,
      mutate: () => {
        assert.equal(reads, 1);
        value = 'private changed session';
      },
    });
    if (stream) await f.stream(false, fields);
    else await f.call(fields);
    assert.equal(reads, 1);
    assert.equal(f.sent[0]?.session_id, suppliedSession);
    sessionPrivacy(f);
  });
  test(`stream=${stream}: throwing session getter has safe fixed error before secrets`, async () => {
    for (const kind of ['openai', 'anthropic', 'google', 'openrouter'] as const) {
      const f = sessionFixture(kind, { stream });
      const fields = {
        get session_id() {
          throw Error('private supplied session failure');
        },
      };
      await assert.rejects(
        () => (stream ? f.stream(false, fields) : f.call(fields)),
        (e: unknown) => {
          assert.ok(e instanceof Error);
          assert.doesNotMatch(e.message, /private|session failure/u);
          return true;
        },
      );
      assert.equal(f.counts().secrets, 0);
    }
  });
  test(`stream=${stream}: independent attribution/key/metadata/cache/tool history remain exact across repeated sessions`, async () => {
    const f = sessionFixture('openrouter', { stream });
    const fields = {
      ...resultInput,
      stream,
      session_id: suppliedSession,
      user: 'private separate user',
      prompt_cache_key: 'private separate key',
      metadata: { session_id: 'private metadata session' },
    };
    for (const base of bases) {
      const r = await f.handler(f.request(base, fields));
      assert.equal(r.status, 200);
      await r.text();
    }
    assert.equal(f.records.length, 2);
    for (const body of f.sent) {
      assert.equal(body.session_id, suppliedSession);
      assert.equal(body.user, fields.user);
      assert.equal(body.prompt_cache_key, fields.prompt_cache_key);
      assert.deepEqual(body.metadata, fields.metadata);
      assert.deepEqual(body.messages, fields.messages);
      assert.deepEqual(body.cache_control, fields.cache_control);
      assert.deepEqual(body.provider, { only: ['provider'] });
    }
    sessionPrivacy(f);
  });
  test(`stream=${stream}: opened session request failures retain possible billing`, async () => {
    const f = sessionFixture('openrouter', { stream, transportFails: true });
    const r = await f.handler(f.request('/api/v1', { session_id: suppliedSession, stream }));
    assert.equal(r.status, 502);
    assert.doesNotMatch(await r.text(), /supplied session|fixture-.*key/u);
    assert.equal(f.records[0]?.possiblyBilled, true);
    assert.equal(f.records[0]?.outcome, 'failed');
    sessionPrivacy(f);
  });
}
test('session preference preserves the complete HTTP body size limit', async () => {
  for (const base of bases) {
    const f = sessionFixture('openrouter');
    const r = await f.handler(
      f.request(base, {
        session_id: 'private supplied session',
        messages: [{ role: 'user', content: 'private'.repeat(150000) }],
      }),
    );
    assert.equal(r.status, 400);
    assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
  }
});
test('session function stream cancellation persists interruption without preference disclosure', {
  timeout: 3000,
}, async () => {
  const f = sessionFixture('openrouter', { stream: true, mode: 'function' });
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
    f.request('/api/v1', { session_id: suppliedSession, stream: true, tools: probabilityTools }),
  );
  assert.equal(r.status, 200);
  const reader = r.body?.getReader();
  assert.ok(reader);
  assert.equal((await reader.read()).done, false);
  await reader.cancel('private supplied session cancellation');
  await interrupted;
  assert.equal(f.records[0]?.possiblyBilled, true);
  assert.equal(f.records[0]?.outcome, 'failed');
  sessionPrivacy(f);
});
