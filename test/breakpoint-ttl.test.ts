import assert from 'node:assert/strict';
import test from 'node:test';
import { ttlHistory } from './breakpoint-ttl-fixture.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';
import { breakpointFixture, breakpointPrivacy } from './prompt-cache-breakpoints-fixture.ts';

const bases = ['/v1', '/api/v1'];
const user = (marker: unknown) => [
  {
    role: 'user',
    content: [{ type: 'text', text: 'private TTL text', prompt_cache_breakpoint: marker }],
  },
];
for (const kind of ['openai', 'openrouter'] as const)
  for (const stream of [false, true])
    for (const mode of ['text', 'refusal', 'function'] as const) {
      test(`${kind} ${mode} stream=${stream}: text breakpoint TTL preserves all roles, root controls and both bases`, async () => {
        for (const ttl of ['30m', '12h'] as const)
          for (const base of bases) {
            const history = ttlHistory(ttl);
            const f = breakpointFixture(kind, { stream, mode });
            const r = await f.handler(
              f.request(base, {
                stream,
                messages: history,
                prompt_cache_options: { mode: 'explicit', ttl: '30m' },
                ...(mode === 'function' ? { tools: probabilityTools } : {}),
              }),
            );
            assert.equal(r.status, 200);
            const body = await r.text();
            if (stream) assert.ok(body.endsWith('data: [DONE]\n\n'));
            assert.doesNotMatch(body, /prompt_cache_breakpoint|private TTL|12h|30m/u);
            assert.deepEqual(f.sent[0]?.messages, history);
            assert.deepEqual(f.sent[0]?.prompt_cache_options, { mode: 'explicit', ttl: '30m' });
            assert.equal(f.records[0]?.usage.totalTokens, 3);
            breakpointPrivacy(f);
          }
      });
      test(`${kind} ${mode} stream=${stream}: breakpoint TTL preserves auth, Deny, limits and required persistence`, async () => {
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
              f.request(base, {
                stream,
                messages: ttlHistory(),
                ...(mode === 'function' ? { tools: probabilityTools } : {}),
              }),
            );
            assert.equal(r.status, stream && (gate === 'audit' || gate === 'usage') ? 200 : status);
            assert.doesNotMatch(
              await r.text(),
              /prompt_cache_breakpoint|private reusable|private TTL|12h|\[DONE\]/u,
            );
            assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0);
            breakpointPrivacy(f);
          }
      });
    }
for (const kind of ['openai', 'openrouter'] as const)
  for (const stream of [false, true]) {
    test(`${kind} stream=${stream}: TTL absence/null/undefined omits only the member without defaults`, async () => {
      for (const marker of [
        { mode: 'explicit' },
        { mode: 'explicit', ttl: null },
        { mode: 'explicit', ttl: undefined },
      ]) {
        const f = breakpointFixture(kind, { stream });
        if (stream) await f.stream(false, { messages: user(marker) });
        else await f.call({ messages: user(marker) });
        assert.deepEqual(f.sent[0]?.messages, user({ mode: 'explicit' }));
        assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'prompt_cache_options'), false);
        breakpointPrivacy(f);
      }
    });
    test(`${kind} stream=${stream}: capture own TTL once before credentials and ignore later mutation`, async () => {
      let reads = 0;
      const marker = {
        mode: 'explicit',
        get ttl() {
          reads++;
          return reads === 1 ? '12h' : 'private invalid late';
        },
      };
      const f = breakpointFixture(kind, {
        stream,
        mutate: () => {
          assert.equal(reads, 1);
          Object.defineProperty(marker, 'ttl', { value: '30m', enumerable: true });
        },
      });
      if (stream) await f.stream(false, { messages: user(marker) });
      else await f.call({ messages: user(marker) });
      assert.equal(reads, 1);
      assert.deepEqual(f.sent[0]?.messages, user({ mode: 'explicit', ttl: '12h' }));
      breakpointPrivacy(f);
    });
    test(`${kind} stream=${stream}: invalid TTL values reject before route/secret access`, async () => {
      for (const ttl of [
        '',
        '5m',
        '1h',
        '24h',
        'private invalid',
        30,
        false,
        [],
        {},
        ' 30m',
        '12H',
      ]) {
        for (const base of bases) {
          const f = breakpointFixture(kind, { stream });
          const r = await f.handler(
            f.request(base, { stream, messages: user({ mode: 'explicit', ttl }) }),
          );
          assert.equal(r.status, 400);
          assert.deepEqual(f.counts(), { routes: 0, secrets: 0 });
          assert.doesNotMatch(await r.text(), /private|prompt_cache|ttl|30m|12h/u);
          breakpointPrivacy(f);
        }
      }
      const f = breakpointFixture(kind, { stream });
      await assert.rejects(
        () =>
          stream
            ? f.stream(false, {
                messages: user({
                  mode: 'explicit',
                  get ttl() {
                    throw Error('private TTL getter');
                  },
                }),
              })
            : f.call({
                messages: user({
                  mode: 'explicit',
                  get ttl() {
                    throw Error('private TTL getter');
                  },
                }),
              }),
        (e: unknown) => {
          assert.ok(e instanceof Error);
          assert.doesNotMatch(e.message, /private|TTL getter/u);
          return true;
        },
      );
      assert.equal(f.counts().secrets, 0);
    });
    test(`${kind} stream=${stream}: unknown usage and possibly billed upstream failures are not invented cache savings`, async () => {
      for (const options of [{ missingUsage: true }, { transportFails: true }]) {
        const f = breakpointFixture(kind, { stream, ...options });
        const r = await f.handler(f.request('/api/v1', { stream, messages: ttlHistory() }));
        await r.text();
        assert.equal(f.sent.length, 1);
        assert.equal(f.records.length, 1);
        assert.equal(f.records[0]?.usage.status, 'missing');
        assert.equal(f.records[0]?.usage.totalTokens, null);
        if ('transportFails' in options) assert.notEqual(r.status, 200);
        breakpointPrivacy(f);
      }
    });
  }
for (const kind of ['anthropic', 'google'] as const)
  for (const stream of [false, true])
    test(`${kind} stream=${stream}: text breakpoint TTL stays unsupported before credentials`, async () => {
      for (const base of bases) {
        const f = breakpointFixture(kind, { stream });
        const r = await f.handler(f.request(base, { stream, messages: ttlHistory() }));
        // Match the existing unsupported native marked-history response after valid parsing.
        assert.equal(r.status, 502);
        assert.equal(f.counts().secrets, 0);
        assert.equal(f.sent.length, 0);
        assert.doesNotMatch(await r.text(), /private|12h|prompt_cache/u);
        breakpointPrivacy(f);
      }
    });

for (const kind of ['openai', 'openrouter'] as const)
  for (const stream of [false, true])
    test(`${kind} stream=${stream}: mixed breakpoint lifetimes retain exact ordering without root defaults`, async () => {
      const content = [
        {
          type: 'text',
          text: 'private shared prefix',
          prompt_cache_breakpoint: { mode: 'explicit', ttl: '12h' },
        },
        { type: 'text', text: '', prompt_cache_breakpoint: { mode: 'explicit', ttl: '30m' } },
        { type: 'text', text: 'private unmarked suffix' },
      ];
      for (const base of bases) {
        const f = breakpointFixture(kind, { stream });
        const history = [{ role: 'user', content }];
        const r = await f.handler(f.request(base, { stream, messages: history }));
        assert.equal(r.status, 200);
        await r.text();
        assert.deepEqual(f.sent[0]?.messages, history);
        assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'prompt_cache_options'), false);
        breakpointPrivacy(f);
      }
    });
