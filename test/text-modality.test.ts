import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';
import { modalityFixture, modalityPrivacy, textModalities } from './text-modality-fixture.ts';

const bases = ['/v1', '/api/v1'];
const invalid = [
  '',
  false,
  0,
  {},
  [],
  ['image'],
  ['audio'],
  ['private'],
  ['text', 'text'],
  ['text', 'audio'],
  [null],
  [1],
];
for (const kind of ['openai', 'openrouter'] as const)
  for (const stream of [false, true])
    for (const mode of ['text', 'refusal', 'function'] as const) {
      const controls = { stream, ...(mode === 'function' ? { tools: probabilityTools } : {}) };
      test(`${kind} ${mode} stream=${stream}: exact text selector/null/omission survive both bases`, async () => {
        for (const base of bases)
          for (const modalities of [undefined, null, textModalities]) {
            const f = modalityFixture(kind, { stream, mode });
            const response = await f.handler(
              f.request(base, { ...controls, ...(modalities === undefined ? {} : { modalities }) }),
            );
            assert.equal(response.status, 200);
            const body = await response.text();
            assert.doesNotMatch(body, /modalities/u);
            if (stream) assert.ok(body.endsWith('data: [DONE]\n\n'));
            assert.deepEqual(f.sent[0]?.modalities, modalities ?? undefined);
            assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'modalities'), modalities != null);
            assert.equal(f.sent[0]?.model, 'upstream-model');
            if (kind === 'openrouter')
              assert.deepEqual(f.sent[0]?.provider, { only: ['provider'] });
            assert.equal(f.records[0]?.outcome, 'succeeded');
            assert.equal(f.records[0]?.usage.totalTokens, 3);
            modalityPrivacy(f);
          }
      });
      test(`${kind} ${mode} stream=${stream}: text selector preserves authorization/limits/persistence`, async () => {
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
            const f = modalityFixture(kind, { stream, mode, gate });
            const response = await f.handler(
              f.request(base, { ...controls, modalities: textModalities }),
            );
            assert.equal(
              response.status,
              stream && (gate === 'audit' || gate === 'usage') ? 200 : status,
            );
            assert.doesNotMatch(await response.text(), /modalities|fixture-.*key|\[DONE\]/u);
            assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0);
            modalityPrivacy(f);
          }
      });
      test(`${kind} ${mode} stream=${stream}: output type cannot manufacture missing usage`, async () => {
        const f = modalityFixture(kind, { stream, mode, missingUsage: true });
        const response = await f.handler(
          f.request('/api/v1', { ...controls, modalities: textModalities }),
        );
        assert.equal(response.status, 200);
        await response.text();
        assert.equal(f.records[0]?.usage.status, 'missing');
        assert.equal(f.records[0]?.usage.totalTokens, null);
        modalityPrivacy(f);
      });
    }
for (const kind of ['openai', 'openrouter', 'anthropic', 'google'] as const)
  for (const stream of [false, true])
    test(`${kind} stream=${stream}: unavailable/malformed selectors reject before routes/secrets`, async () => {
      for (const base of bases)
        for (const modalities of invalid) {
          const f = modalityFixture(kind, { stream });
          const response = await f.handler(f.request(base, { stream, modalities }));
          assert.equal(response.status, 400);
          assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
          assert.doesNotMatch(await response.text(), /private|modalities|fixture-.*key/u);
          modalityPrivacy(f);
        }
      const sparse = new Array(1);
      const extra = Object.assign(['text'], { private: 'forged' });
      for (const modalities of [
        ...invalid,
        sparse,
        extra,
        Object.create({ 0: 'text', length: 1 }),
      ]) {
        const f = modalityFixture(kind, { stream });
        await assert.rejects(() =>
          stream ? f.stream(false, { modalities }) : f.call({ modalities }),
        );
        assert.equal(f.counts().secrets, 0);
        assert.equal(f.sent.length, 0);
      }
    });
for (const kind of ['anthropic', 'google'] as const)
  test(`${kind}: supplied text selector rejects without native translation while null keeps defaults`, async () => {
    for (const stream of [false, true]) {
      const f = modalityFixture(kind, { stream });
      await assert.rejects(() =>
        stream
          ? f.stream(false, { modalities: textModalities })
          : f.call({ modalities: textModalities }),
      );
      assert.equal(f.counts().secrets, 0);
    }
    for (const base of bases)
      for (const modalities of [null, undefined]) {
        const f = modalityFixture(kind);
        const response = await f.handler(f.request(base, { modalities }));
        assert.equal(response.status, 200);
        await response.text();
        assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'modalities'), false);
        const config = f.sent[0]?.generationConfig;
        if (typeof config === 'object' && config !== null)
          assert.equal(Object.hasOwn(config, 'responseModalities'), false);
        modalityPrivacy(f);
      }
  });
for (const kind of ['openai', 'openrouter'] as const)
  for (const stream of [false, true]) {
    test(`${kind} stream=${stream}: root/length/index capture survives credential mutation`, async () => {
      let roots = 0,
        lengths = 0,
        indices = 0;
      const source = ['text'];
      Object.defineProperty(source, '0', {
        enumerable: true,
        configurable: true,
        get() {
          indices++;
          return indices === 1 ? 'text' : 'audio';
        },
      });
      const modalities = new Proxy(source, {
        get(target, key, receiver) {
          if (key === 'length') lengths++;
          return Reflect.get(target, key, receiver);
        },
      });
      const fields = {
        get modalities() {
          roots++;
          return roots === 1 ? modalities : ['image'];
        },
        tools: probabilityTools,
      };
      const f = modalityFixture(kind, {
        stream,
        mode: 'function',
        mutate: () => {
          assert.deepEqual([roots, lengths, indices], [1, 1, 1]);
          Object.defineProperty(source, '0', { value: 'audio', enumerable: true });
          source.push('image');
        },
      });
      if (stream) await f.stream(true, fields);
      else await f.call(fields);
      assert.deepEqual([roots, lengths, indices], [1, 1, 1]);
      assert.deepEqual(f.sent[0]?.modalities, textModalities);
      modalityPrivacy(f);
    });
    test(`${kind} stream=${stream}: throwing root/length/index getters fail privately before secrets`, async () => {
      for (const fields of [
        {
          get modalities() {
            throw Error('private root');
          },
        },
        {
          modalities: new Proxy(['text'], {
            get(target, key, receiver) {
              if (key === 'length') throw Error('private length');
              return Reflect.get(target, key, receiver);
            },
          }),
        },
        {
          modalities: Object.defineProperty(['text'], '0', {
            get() {
              throw Error('private index');
            },
          }),
        },
      ]) {
        const f = modalityFixture(kind, { stream });
        await assert.rejects(
          () => (stream ? f.stream(false, fields) : f.call(fields)),
          (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.doesNotMatch(error.message, /private|root|length|index/u);
            return true;
          },
        );
        assert.equal(f.counts().secrets, 0);
      }
    });
    test(`${kind} stream=${stream}: text selector retains independent cache/client controls and prediction`, async () => {
      const f = modalityFixture(kind, { stream });
      const prediction = { type: 'content', content: 'private expected' };
      const response = await f.handler(
        f.request('/api/v1', {
          stream,
          modalities: textModalities,
          prompt_cache_options: { mode: 'explicit', ttl: '30m' },
          prompt_cache_key: 'private key',
          metadata: { tag: 'private' },
          user: 'private user',
          prediction,
          max_tokens: 10,
        }),
      );
      assert.equal(response.status, 200);
      assert.doesNotMatch(
        await response.text(),
        /private expected|private key|private user|modalities|prompt_cache_options/u,
      );
      assert.deepEqual(f.sent[0]?.modalities, textModalities);
      assert.deepEqual(f.sent[0]?.prediction, prediction);
      assert.equal(f.sent[0]?.max_tokens, 10);
      assert.equal(f.sent[0]?.user, 'private user');
      assert.equal(f.sent[0]?.prompt_cache_key, 'private key');
      assert.deepEqual(f.sent[0]?.prompt_cache_options, { mode: 'explicit', ttl: '30m' });
      modalityPrivacy(f);
    });
    test(`${kind} stream=${stream}: text modality retains sanitized opened failures`, async () => {
      const f = modalityFixture(kind, { stream, transportFails: true });
      const response = await f.handler(
        f.request('/api/v1', { stream, modalities: textModalities }),
      );
      assert.equal(response.status, 502);
      assert.doesNotMatch(await response.text(), /private|modalities|fixture-.*key/u);
      assert.equal(f.records[0]?.outcome, 'failed');
      assert.equal(f.records[0]?.possiblyBilled, true);
      modalityPrivacy(f);
    });
  }
for (const kind of ['openai', 'openrouter'] as const)
  for (const mode of ['text', 'function'] as const)
    test(`${kind} ${mode}: text selector preserves public body cancellation`, {
      timeout: 3000,
    }, async () => {
      for (const base of bases) {
        const f = modalityFixture(kind, { stream: true, mode });
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
        const response = await handler(
          f.request(base, {
            stream: true,
            modalities: textModalities,
            ...(mode === 'function' ? { tools: probabilityTools } : {}),
          }),
        );
        assert.equal(response.status, 200);
        const reader = response.body?.getReader();
        assert.ok(reader);
        assert.equal((await reader.read()).done, false);
        await reader.cancel('private cancellation');
        await interrupted;
        assert.equal(f.records.length, 1);
        assert.equal(f.records[0]?.outcome, 'failed');
        assert.equal(f.records[0]?.possiblyBilled, true);
        assert.deepEqual(f.sent[0]?.modalities, textModalities);
        modalityPrivacy(f);
      }
    });

for (const kind of ['openai', 'openrouter'] as const)
  for (const stream of [false, true]) {
    test(`${kind} stream=${stream}: modality cannot bypass prediction restrictions`, async () => {
      const fields = {
        modalities: textModalities,
        prediction: { type: 'content', content: 'private expected' },
        tools: probabilityTools,
      };
      for (const base of bases) {
        const f = modalityFixture(kind, { stream });
        const response = await f.handler(f.request(base, { ...fields, stream }));
        assert.equal(response.status, 400);
        assert.deepEqual(f.counts(), { routes: 0, secrets: 0 });
        assert.doesNotMatch(await response.text(), /private|modalities/u);
      }
      const f = modalityFixture(kind, { stream });
      await assert.rejects(() => (stream ? f.stream(true, fields) : f.call(fields)));
      assert.equal(f.counts().secrets, 0);
    });
    test(`${kind} stream=${stream}: text modality preserves correlated function-result history`, async () => {
      const f = modalityFixture(kind, { stream, mode: 'function' });
      const response = await f.handler(
        f.request('/api/v1', {
          stream,
          modalities: textModalities,
          tools: probabilityTools,
          messages: [
            { role: 'user', content: 'private prompt' },
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } },
              ],
            },
            { role: 'tool', tool_call_id: 'call', content: 'private result' },
          ],
        }),
      );
      assert.equal(response.status, 200);
      await response.text();
      assert.deepEqual(f.sent[0]?.modalities, textModalities);
      assert.equal(f.records[0]?.outcome, 'succeeded');
      modalityPrivacy(f);
    });
  }
for (const kind of ['anthropic', 'google'] as const)
  test(`${kind}: unsupported selector also fails before secrets at public HTTP boundary`, async () => {
    for (const base of bases) {
      const f = modalityFixture(kind);
      const response = await f.handler(f.request(base, { modalities: textModalities }));
      assert.equal(response.status, 502);
      assert.equal(f.counts().secrets, 0);
      assert.equal(f.sent.length, 0);
      assert.doesNotMatch(await response.text(), /modalities|private|fixture-.*key/u);
      modalityPrivacy(f);
    }
  });
