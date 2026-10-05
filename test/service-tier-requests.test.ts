import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { clientUserFixture, clientUserPrivacy } from './client-user-fixture.ts';
import { probabilityFixture, probabilityTools } from './nonstream-logprobs-fixture.ts';
import { probabilityStreamPayloads, probabilityStreamResponse } from './stream-logprobs-fixture.ts';

const bases = ['/v1', '/api/v1'];
const nativeTiers = ['auto', 'default', 'flex', 'scale', 'priority', 'fast'];
function privacy(f: ReturnType<typeof clientUserFixture>) {
  clientUserPrivacy(f);
  assert.doesNotMatch(JSON.stringify([f.records, f.audits]), /service_tier|serviceTier/u);
}
for (const kind of ['openai', 'openrouter'] as const)
  for (const stream of [false, true])
    for (const mode of ['text', 'refusal', 'function'] as const) {
      const controls = { stream, ...(mode === 'function' ? { tools: probabilityTools } : {}) };
      test(`${kind} ${mode} stream=${stream}: supported tier literals and nullable omission pass both bases and adapters`, async () => {
        for (const service_tier of [
          undefined,
          null,
          ...(kind === 'openai' ? nativeTiers : ['default']),
        ]) {
          for (const base of bases) {
            const f = clientUserFixture(kind, { stream, mode });
            const r = await f.handler(f.request(base, { ...controls, service_tier }));
            assert.equal(r.status, 200);
            const output = await r.text();
            if (stream) assert.ok(output.endsWith('data: [DONE]\n\n'));
            assert.doesNotMatch(output, /service_tier/u);
            assert.equal(f.sent[0]?.service_tier, service_tier ?? undefined);
            assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'service_tier'), service_tier != null);
            assert.equal(f.sent[0]?.model, 'upstream-model');
            if (kind === 'openrouter')
              assert.deepEqual(f.sent[0]?.provider, { only: ['provider'] });
            assert.equal(f.records[0]?.usage.totalTokens, 3);
            privacy(f);
          }
          const f = clientUserFixture(kind, { stream, mode });
          if (stream) await f.stream(mode === 'function', { ...controls, service_tier });
          else await f.call({ ...controls, service_tier });
          assert.equal(f.sent[0]?.service_tier, service_tier ?? undefined);
          privacy(f);
        }
      });
      test(`${kind} ${mode} stream=${stream}: tiers retain authentication IAM limits and required persistence`, async () => {
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
            const f = clientUserFixture(kind, { stream, mode, gate });
            const r = await f.handler(f.request(base, { ...controls, service_tier: 'default' }));
            assert.equal(r.status, stream && (gate === 'audit' || gate === 'usage') ? 200 : status);
            assert.doesNotMatch(await r.text(), /service_tier|fixture-.*key|\[DONE\]/u);
            assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0);
            privacy(f);
          }
      });
      test(`${kind} ${mode} stream=${stream}: tier choice never supplies missing usage`, async () => {
        const f = clientUserFixture(kind, { stream, mode, missingUsage: true });
        const r = await f.handler(f.request('/api/v1', { ...controls, service_tier: 'default' }));
        assert.equal(r.status, 200);
        await r.text();
        assert.equal(f.records[0]?.usage.status, 'missing');
        assert.equal(f.records[0]?.usage.totalTokens, null);
        privacy(f);
      });
    }
for (const kind of ['openai', 'openrouter', 'anthropic', 'google'] as const)
  for (const stream of [false, true]) {
    test(`${kind} stream=${stream}: malformed tiers fail before routes or credentials`, async () => {
      for (const service_tier of ['', 'PRIVATE tier', ' priority', 'PRIORITY', false, 0, {}, []]) {
        for (const base of bases) {
          const f = clientUserFixture(kind, { stream });
          const r = await f.handler(f.request(base, { service_tier, stream }));
          assert.equal(r.status, 400);
          assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
          assert.doesNotMatch(await r.text(), /PRIVATE|service_tier|fixture-.*key/u);
          privacy(f);
        }
        const f = clientUserFixture(kind, { stream });
        await assert.rejects(() =>
          stream ? f.stream(false, { service_tier }) : f.call({ service_tier }),
        );
        assert.equal(f.counts().secrets, 0);
      }
      for (const service_tier of [new String('priority'), Symbol('private'), NaN]) {
        const f = clientUserFixture(kind, { stream });
        await assert.rejects(() =>
          stream ? f.stream(false, { service_tier }) : f.call({ service_tier }),
        );
        assert.equal(f.counts().secrets, 0);
      }
    });
    test(`${kind} stream=${stream}: recognized unsupported tiers reject before secrets`, async () => {
      const unsupported =
        kind === 'openai'
          ? ['ultrafast']
          : kind === 'openrouter'
            ? nativeTiers.filter((t) => t !== 'default').concat('ultrafast')
            : nativeTiers.concat('ultrafast');
      for (const service_tier of unsupported) {
        const f = clientUserFixture(kind, { stream });
        await assert.rejects(() =>
          stream ? f.stream(false, { service_tier }) : f.call({ service_tier }),
        );
        assert.equal(f.counts().secrets, 0);
        assert.equal(f.sent.length, 0);
        privacy(f);
      }
    });
  }
for (const kind of ['anthropic', 'google'] as const)
  test(`${kind}: null tier is omission without native translation`, async () => {
    for (const base of bases) {
      const f = clientUserFixture(kind);
      const r = await f.handler(f.request(base, { service_tier: null }));
      assert.equal(r.status, 200);
      await r.text();
      assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'service_tier'), false);
      assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'serviceTier'), false);
      privacy(f);
    }
  });
for (const kind of ['openai', 'openrouter'] as const)
  for (const stream of [false, true]) {
    test(`${kind} stream=${stream}: captured tier survives credential-time mutation and is read once`, async () => {
      let reads = 0,
        value = 'default';
      const fields = {
        get service_tier() {
          reads++;
          return value;
        },
      };
      const f = clientUserFixture(kind, {
        stream,
        mutate: () => {
          assert.equal(reads, 1);
          value = 'PRIVATE invalid';
        },
      });
      if (stream) await f.stream(false, fields);
      else await f.call(fields);
      assert.equal(reads, 1);
      assert.equal(f.sent[0]?.service_tier, 'default');
      privacy(f);
    });
    test(`${kind} stream=${stream}: opened tier failures retain possible billing`, async () => {
      const f = clientUserFixture(kind, { stream, transportFails: true });
      const r = await f.handler(f.request('/api/v1', { service_tier: 'default', stream }));
      assert.equal(r.status, 502);
      assert.doesNotMatch(await r.text(), /private|service_tier|fixture-.*key/u);
      assert.equal(f.records[0]?.possiblyBilled, true);
      assert.equal(f.records[0]?.outcome, 'failed');
      privacy(f);
    });
    test(`${kind} stream=${stream}: upstream served tier remains independent of requested default`, async () => {
      const reply = () =>
        stream
          ? probabilityStreamResponse(
              probabilityStreamPayloads(kind).map((p) =>
                p === '[DONE]' ? p : JSON.stringify({ ...JSON.parse(p), service_tier: 'flex' }),
              ),
            )
          : Response.json({
              id: 'completion',
              created: 42,
              model: 'upstream-model',
              service_tier: 'flex',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'reply' },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: 2, completion_tokens: 1 },
            });
      const f = probabilityFixture(kind, undefined, { reply });
      const r = await f.handler(f.request('/api/v1', { service_tier: 'default', stream }));
      assert.equal(r.status, 200);
      const text = await r.text();
      assert.match(text, /"service_tier":"flex"/u);
      assert.doesNotMatch(text, /"service_tier":"default"/u);
      assert.equal(f.sent[0]?.service_tier, 'default');
      privacy(f);
    });
  }
test('throwing tier getters fail safely before credentials on every adapter', async () => {
  for (const kind of ['openai', 'openrouter', 'anthropic', 'google'] as const)
    for (const stream of [false, true]) {
      const f = clientUserFixture(kind, { stream });
      const fields = {
        get service_tier() {
          throw Error('PRIVATE tier error');
        },
      };
      await assert.rejects(
        () => (stream ? f.stream(false, fields) : f.call(fields)),
        (e: unknown) => {
          assert.ok(e instanceof Error);
          assert.doesNotMatch(e.message, /PRIVATE|tier error/u);
          return true;
        },
      );
      assert.equal(f.counts().secrets, 0);
    }
});
test('request tier preserves the complete HTTP body bound', async () => {
  const f = clientUserFixture('openai');
  const r = await f.handler(
    f.request('/api/v1', {
      service_tier: 'priority',
      messages: [{ role: 'user', content: 'private'.repeat(150000) }],
    }),
  );
  assert.equal(r.status, 400);
  assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
});
for (const kind of ['openai', 'openrouter'] as const)
  test(`${kind}: function-stream cancellation persists interruption without tier records`, {
    timeout: 3000,
  }, async () => {
    const f = clientUserFixture(kind, { stream: true, mode: 'function' });
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
      f.request('/api/v1', { service_tier: 'default', stream: true, tools: probabilityTools }),
    );
    assert.equal(r.status, 200);
    const reader = r.body?.getReader();
    assert.ok(reader);
    assert.equal((await reader.read()).done, false);
    await reader.cancel('PRIVATE tier cancellation');
    await interrupted;
    assert.equal(f.records[0]?.possiblyBilled, true);
    assert.equal(f.records[0]?.outcome, 'failed');
    privacy(f);
  });
