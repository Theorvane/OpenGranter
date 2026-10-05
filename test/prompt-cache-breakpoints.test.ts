import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { snapshotChatMessages } from '../src/gateway/chat-messages.ts';
import { prepareAnthropicMessages } from '../src/providers/anthropic-client-functions.ts';
import { prepareGoogleMessages } from '../src/providers/google-client-functions.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';
import {
  breakpointFixture,
  breakpointHistory,
  breakpointParts,
  breakpointPrivacy,
} from './prompt-cache-breakpoints-fixture.ts';

const bases = ['/v1', '/api/v1'];
const messages = (content: unknown) => [{ role: 'user', content }];
for (const [kind, prepare] of [
  ['anthropic', prepareAnthropicMessages],
  ['google', prepareGoogleMessages],
] as const)
  test(`${kind}: native message conversion rejects cache boundaries without flattening`, () => {
    const captured = snapshotChatMessages(breakpointHistory);
    assert.throws(
      () => prepare(captured),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(
          error.message,
          /private reusable|changing suffix|prompt_cache_breakpoint/u,
        );
        return true;
      },
    );
  });
test('internal marked arrays reject noncanonical index properties', async () => {
  const parts = [...breakpointParts];
  Object.defineProperty(parts, '00', { value: breakpointParts[0], enumerable: true });
  const f = breakpointFixture('openai');
  await assert.rejects(f.call({ messages: messages(parts) }));
  assert.equal(f.counts().secrets, 0);
});
for (const kind of ['openai', 'openrouter'] as const)
  for (const stream of [false, true])
    for (const mode of ['text', 'refusal', 'function'] as const) {
      const controls = { stream, ...(mode === 'function' ? { tools: probabilityTools } : {}) };
      test(`${kind} ${mode} stream=${stream}: marked content preserves all five roles and boundaries on both bases`, async () => {
        for (const base of bases)
          for (const options of [
            undefined,
            { mode: 'explicit' },
            { mode: 'explicit', ttl: '30m' },
          ]) {
            const f = breakpointFixture(kind, { stream, mode });
            const r = await f.handler(
              f.request(base, {
                ...controls,
                messages: breakpointHistory,
                ...(options ? { prompt_cache_options: options } : {}),
              }),
            );
            assert.equal(r.status, 200);
            const body = await r.text();
            assert.doesNotMatch(body, /prompt_cache_breakpoint|private reusable|changing suffix/u);
            if (stream) assert.ok(body.endsWith('data: [DONE]\n\n'));
            assert.deepEqual(f.sent[0]?.messages, breakpointHistory);
            assert.deepEqual(f.sent[0]?.prompt_cache_options, options);
            assert.equal(f.records[0]?.usage.totalTokens, 3);
            breakpointPrivacy(f);
          }
      });
      test(`${kind} ${mode} stream=${stream}: input boundaries preserve auth/Deny/limits/persistence`, async () => {
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
            const f = breakpointFixture(kind, { stream, mode, gate });
            const r = await f.handler(
              f.request(base, { ...controls, messages: breakpointHistory }),
            );
            assert.equal(r.status, stream && (gate === 'audit' || gate === 'usage') ? 200 : status);
            assert.doesNotMatch(
              await r.text(),
              /prompt_cache_breakpoint|private reusable|fixture-.*key|\[DONE\]/u,
            );
            assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0);
            breakpointPrivacy(f);
          }
      });
      test(`${kind} ${mode} stream=${stream}: cache boundary never supplies absent usage`, async () => {
        const f = breakpointFixture(kind, { stream, mode, missingUsage: true });
        const r = await f.handler(
          f.request('/api/v1', { ...controls, messages: breakpointHistory }),
        );
        assert.equal(r.status, 200);
        await r.text();
        assert.equal(f.records[0]?.usage.status, 'missing');
        assert.equal(f.records[0]?.usage.totalTokens, null);
        breakpointPrivacy(f);
      });
    }
const invalidMarkers = [
  false,
  1,
  'private',
  [],
  {},
  { mode: 'private' },
  { mode: 'implicit' },
  { mode: null },
  { mode: 'explicit', ttl: '30m' },
  { mode: 'explicit', private: 'forged' },
];
for (const kind of ['openai', 'openrouter', 'anthropic', 'google'] as const)
  for (const stream of [false, true])
    test(`${kind} stream=${stream}: malformed markers reject before routes/secrets`, async () => {
      for (const base of bases)
        for (const marker of invalidMarkers) {
          const f = breakpointFixture(kind, { stream });
          const r = await f.handler(
            f.request(base, {
              stream,
              messages: messages([
                { type: 'text', text: 'private text', prompt_cache_breakpoint: marker },
              ]),
            }),
          );
          assert.equal(r.status, 400);
          assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
          assert.doesNotMatch(await r.text(), /private|forged|prompt_cache/u);
          breakpointPrivacy(f);
        }
      for (const marker of [...invalidMarkers, new Date(), Object.create({ mode: 'explicit' })]) {
        const f = breakpointFixture(kind, { stream });
        const fields = {
          messages: messages([
            { type: 'text', text: 'private text', prompt_cache_breakpoint: marker },
          ]),
        };
        await assert.rejects(() => (stream ? f.stream(false, fields) : f.call(fields)));
        assert.equal(f.counts().secrets, 0);
      }
    });
for (const kind of ['openai', 'openrouter'] as const)
  for (const stream of [false, true]) {
    test(`${kind} stream=${stream}: null markers retain legacy concatenation and exact empty marked text`, async () => {
      for (const base of bases)
        for (const content of [
          [
            { type: 'text', text: 'private A', prompt_cache_breakpoint: null },
            { type: 'text', text: ' B' },
          ],
          [
            { type: 'text', text: 'private A' },
            { type: 'text', text: ' B' },
          ],
          [{ type: 'text', text: '', prompt_cache_breakpoint: { mode: 'explicit' } }],
        ]) {
          const f = breakpointFixture(kind, { stream });
          const r = await f.handler(f.request(base, { stream, messages: messages(content) }));
          assert.equal(r.status, 200);
          await r.text();
          const marked = content.some((p) => p.prompt_cache_breakpoint != null);
          assert.deepEqual(f.sent[0]?.messages, [
            { role: 'user', content: marked ? content : 'private A B' },
          ]);
          breakpointPrivacy(f);
        }
    });
    test(`${kind} stream=${stream}: 128 parts retain order, 129/sparse/rich/extra parts reject`, async () => {
      for (const length of [128, 129]) {
        const content = Array.from({ length }, (_, i) => ({
          type: 'text',
          text: `private ${i}`,
          ...(i === 0 ? { prompt_cache_breakpoint: { mode: 'explicit' } } : {}),
        }));
        const f = breakpointFixture(kind, { stream });
        const r = await f.handler(f.request('/api/v1', { stream, messages: messages(content) }));
        assert.equal(r.status, length === 128 ? 200 : 400);
        await r.text();
        if (length === 128) assert.deepEqual(f.sent[0]?.messages, messages(content));
        else assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
      }
      const sparse = Array(2);
      sparse[0] = breakpointParts[0];
      for (const content of [
        sparse,
        [{ ...breakpointParts[0], private: 'forged' }],
        [{ ...breakpointParts[0], type: 'image' }],
        [{ type: 'refusal', refusal: 'private', prompt_cache_breakpoint: { mode: 'explicit' } }],
      ]) {
        const f = breakpointFixture(kind, { stream });
        const r = await f.handler(f.request('/api/v1', { stream, messages: messages(content) }));
        assert.equal(r.status, 400);
        assert.equal(f.counts().secrets, 0);
      }
    });
    test(`${kind} stream=${stream}: caller root/part/type/text/marker/mode are captured once before credentials`, async () => {
      let roots = 0,
        parts = 0,
        types = 0,
        texts = 0,
        markers = 0,
        modes = 0;
      const marker = Object.defineProperty({}, 'mode', {
        enumerable: true,
        configurable: true,
        get() {
          modes++;
          return modes === 1 ? 'explicit' : 'private';
        },
      });
      const part = Object.defineProperties(
        {},
        {
          type: {
            enumerable: true,
            configurable: true,
            get() {
              types++;
              return 'text';
            },
          },
          text: {
            enumerable: true,
            configurable: true,
            get() {
              texts++;
              return texts === 1 ? 'private captured' : 'private late';
            },
          },
          prompt_cache_breakpoint: {
            enumerable: true,
            configurable: true,
            get() {
              markers++;
              return marker;
            },
          },
        },
      );
      const content = Object.defineProperty([part], '0', {
        enumerable: true,
        configurable: true,
        get() {
          parts++;
          return part;
        },
      });
      const fields = {
        get messages() {
          roots++;
          return [{ role: 'user', content }];
        },
      };
      const f = breakpointFixture(kind, {
        stream,
        mutate: () => {
          assert.deepEqual([roots, parts, types, texts, markers, modes], [1, 1, 1, 1, 1, 1]);
          Object.defineProperty(marker, 'mode', { value: 'private', enumerable: true });
          Object.defineProperty(part, 'text', { value: 'private mutation', enumerable: true });
          content.push('private extra');
        },
      });
      if (stream) await f.stream(false, fields);
      else await f.call(fields);
      assert.deepEqual([roots, parts, types, texts, markers, modes], [1, 1, 1, 1, 1, 1]);
      assert.deepEqual(
        f.sent[0]?.messages,
        messages([
          { type: 'text', text: 'private captured', prompt_cache_breakpoint: { mode: 'explicit' } },
        ]),
      );
      breakpointPrivacy(f);
    });
    test(`${kind} stream=${stream}: throwing private content/marker getters fail before secrets`, async () => {
      for (const fields of [
        {
          get messages() {
            throw Error('private root');
          },
        },
        {
          messages: messages([
            {
              type: 'text',
              get text() {
                throw Error('private text');
              },
              prompt_cache_breakpoint: { mode: 'explicit' },
            },
          ]),
        },
        {
          messages: messages([
            {
              type: 'text',
              text: 'private',
              get prompt_cache_breakpoint() {
                throw Error('private marker');
              },
            },
          ]),
        },
        {
          messages: messages([
            {
              type: 'text',
              text: 'private',
              prompt_cache_breakpoint: {
                get mode() {
                  throw Error('private mode');
                },
              },
            },
          ]),
        },
      ]) {
        const f = breakpointFixture(kind, { stream });
        await assert.rejects(
          () => (stream ? f.stream(false, fields) : f.call(fields)),
          (e: unknown) => {
            assert.ok(e instanceof Error);
            assert.doesNotMatch(e.message, /private|root|text|marker|mode/u);
            return true;
          },
        );
        assert.equal(f.counts().secrets, 0);
      }
    });
    test(`${kind} stream=${stream}: unverified automatic-cache coexistence rejects before routes/secrets`, async () => {
      const fields = { messages: breakpointHistory, cache_control: { type: 'ephemeral' } };
      for (const base of bases) {
        const f = breakpointFixture(kind, { stream });
        const r = await f.handler(f.request(base, { ...fields, stream }));
        assert.equal(r.status, 400);
        assert.deepEqual(f.counts(), { routes: 0, secrets: 0 });
      }
      const f = breakpointFixture(kind, { stream });
      await assert.rejects(() => (stream ? f.stream(false, fields) : f.call(fields)));
      assert.equal(f.counts().secrets, 0);
    });
    test(`${kind} stream=${stream}: marked input preserves independent text prediction/cache/client controls`, async () => {
      const f = breakpointFixture(kind, { stream });
      const r = await f.handler(
        f.request('/api/v1', {
          stream,
          messages: messages(breakpointParts),
          prediction: { type: 'content', content: 'private expected' },
          prompt_cache_options: { mode: 'explicit' },
          prompt_cache_key: 'private key',
          user: 'private user',
          metadata: { tag: 'private' },
          modalities: ['text'],
        }),
      );
      assert.equal(r.status, 200);
      await r.text();
      assert.deepEqual(f.sent[0]?.messages, messages(breakpointParts));
      assert.deepEqual(f.sent[0]?.prediction, { type: 'content', content: 'private expected' });
      breakpointPrivacy(f);
    });
    test(`${kind} stream=${stream}: marked content retains safe opened failure accounting`, async () => {
      const f = breakpointFixture(kind, { stream, transportFails: true });
      const r = await f.handler(f.request('/api/v1', { stream, messages: breakpointHistory }));
      assert.equal(r.status, 502);
      assert.doesNotMatch(await r.text(), /private|prompt_cache|fixture-.*key/u);
      assert.equal(f.records[0]?.outcome, 'failed');
      assert.equal(f.records[0]?.possiblyBilled, true);
      breakpointPrivacy(f);
    });
  }
for (const kind of ['anthropic', 'google'] as const)
  test(`${kind}: marked histories reject before credentials and nullable markers keep native defaults`, async () => {
    for (const stream of [false, true]) {
      const f = breakpointFixture(kind, { stream });
      const fields = { messages: breakpointHistory };
      await assert.rejects(() => (stream ? f.stream(false, fields) : f.call(fields)));
      assert.equal(f.counts().secrets, 0);
      assert.equal(f.sent.length, 0);
    }
    for (const base of bases) {
      const f = breakpointFixture(kind);
      const r = await f.handler(
        f.request(base, {
          messages: messages([{ type: 'text', text: 'private', prompt_cache_breakpoint: null }]),
        }),
      );
      assert.equal(r.status, 200);
      await r.text();
      assert.doesNotMatch(JSON.stringify(f.sent), /prompt_cache_breakpoint/u);
      breakpointPrivacy(f);
    }
  });
for (const kind of ['openai', 'openrouter'] as const)
  for (const mode of ['text', 'function'] as const)
    test(`${kind} ${mode}: marked input preserves public body cancellation`, {
      timeout: 3000,
    }, async () => {
      for (const base of bases) {
        const f = breakpointFixture(kind, { stream: true, mode });
        let finish: () => void = () => {};
        const interrupted = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const writeAudit = f.ports.writeAudit;
        const handler = createChatHandler({
          ...f.ports,
          writeAudit: async (event) => {
            await writeAudit(event);
            if (event.kind === 'stream-interrupted') finish();
          },
        });
        const r = await handler(
          f.request(base, {
            stream: true,
            messages: breakpointHistory,
            ...(mode === 'function' ? { tools: probabilityTools } : {}),
          }),
        );
        assert.equal(r.status, 200);
        const reader = r.body?.getReader();
        assert.ok(reader);
        assert.equal((await reader.read()).done, false);
        await reader.cancel('private cancellation');
        await interrupted;
        assert.equal(f.records[0]?.outcome, 'failed');
        assert.equal(f.records[0]?.possiblyBilled, true);
        breakpointPrivacy(f);
      }
    });

for (const sendPrompt of [false, true])
  test(`marked input preserves Jev opt-in plain-text disclosure sendPrompt=${sendPrompt}`, async () => {
    for (const base of bases) {
      const f = breakpointFixture('openai');
      const bodies: unknown[] = [];
      const route = await f.ports.resolveRoute('chat');
      assert.ok(route);
      const handler = createChatHandler({
        ...f.ports,
        resolveRoute: async () => ({
          ...route,
          jev: { credentialRef: 'secret/jev', minimumConfidence: 0.6, sendPrompt },
        }),
        resolveSecret: async () => 'fixture-jev-key',
        fetchJev: async (_url, init) => {
          const body: unknown = JSON.parse(String(init.body));
          bodies.push(body);
          return {
            ok: true,
            json: async () => ({
              model: 'jev-1',
              answers: { route: { type: 'choice', choice: 'candidate', confidence: 0.9 } },
            }),
          };
        },
      });
      const r = await handler(f.request(base, { messages: breakpointHistory }));
      assert.equal(r.status, 200);
      await r.text();
      assert.equal(bodies.length, 1);
      const serialized = JSON.stringify(bodies[0]);
      assert.doesNotMatch(serialized, /prompt_cache_breakpoint|\[object Object\]/u);
      if (sendPrompt) assert.ok(serialized.includes('private reusable'));
      else assert.doesNotMatch(serialized, /private reusable|changing suffix/u);
      assert.deepEqual(f.sent[0]?.messages, breakpointHistory);
      breakpointPrivacy(f);
    }
  });
