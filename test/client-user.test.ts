import assert from 'node:assert/strict';
import test from 'node:test';
import { clientUserFixture, clientUserPrivacy, suppliedUser } from './client-user-fixture.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';

const bases = ['/v1', '/api/v1'];
const values = [undefined, '', '  CaseSensitive User  ', suppliedUser, 'private'.repeat(1024)];
test('client user retains the existing complete HTTP body size limit', async () => {
  for (const base of bases) {
    const f = clientUserFixture('openai');
    const response = await f.handler(f.request(base, { user: 'private'.repeat(150000) }));
    assert.equal(response.status, 400);
    assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
    assert.equal(f.records.length, 0);
    assert.doesNotMatch(await response.text(), /private|fixture-.*key/u);
  }
});
for (const kind of ['openai', 'openrouter'] as const)
  for (const stream of [false, true])
    for (const mode of ['text', 'refusal', 'function'] as const) {
      test(`${kind} ${mode} stream=${stream}: exact client user strings and omission survive both bases`, async () => {
        for (const base of bases)
          for (const user of values) {
            const f = clientUserFixture(kind, { stream, mode });
            const response = await f.handler(
              f.request(base, {
                ...(user === undefined ? {} : { user }),
                ...(stream ? { stream: true } : {}),
                ...(mode === 'function' ? { tools: probabilityTools } : {}),
              }),
            );
            assert.equal(response.status, 200);
            const body = await response.text();
            assert.doesNotMatch(body, /supplied end-user|CaseSensitive User/u);
            if (stream) assert.ok(body.endsWith('data: [DONE]\n\n'));
            assert.equal(f.sent[0]?.user, user);
            assert.equal(Object.hasOwn(f.sent[0] ?? {}, 'user'), user !== undefined);
            if (kind === 'openrouter')
              assert.deepEqual(f.sent[0]?.provider, { only: ['provider'] });
            assert.equal(f.records[0]?.outcome, 'succeeded');
            assert.equal(f.records[0]?.usage.totalTokens, 3);
            clientUserPrivacy(f);
          }
      });
      test(`${kind} ${mode} stream=${stream}: user metadata cannot manufacture missing usage`, async () => {
        const f = clientUserFixture(kind, { stream, mode, missingUsage: true });
        const response = await f.handler(
          f.request('/api/v1', {
            user: suppliedUser,
            ...(stream ? { stream: true } : {}),
            ...(mode === 'function' ? { tools: probabilityTools } : {}),
          }),
        );
        assert.equal(response.status, 200);
        assert.doesNotMatch(await response.text(), /supplied end-user/u);
        assert.equal(f.records[0]?.usage.totalTokens, null);
        assert.equal(f.records[0]?.usage.status, 'missing');
        clientUserPrivacy(f);
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
        test(`${kind} ${mode} stream=${stream}: client user preserves ${gate} gate`, async () => {
          for (const base of bases) {
            const f = clientUserFixture(kind, { stream, mode, gate });
            const response = await f.handler(
              f.request(base, {
                user: suppliedUser,
                ...(stream ? { stream: true } : {}),
                ...(mode === 'function' ? { tools: probabilityTools } : {}),
              }),
            );
            assert.equal(
              response.status,
              stream && (gate === 'audit' || gate === 'usage') ? 200 : status,
            );
            const body = await response.text();
            assert.doesNotMatch(body, /supplied end-user|fixture-.*key|\[DONE\]/u);
            assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0);
            clientUserPrivacy(f);
          }
        });
    }
for (const kind of ['openai', 'openrouter', 'anthropic', 'google'] as const)
  for (const stream of [false, true])
    test(`${kind} stream=${stream}: malformed client user values reject before routes and secrets`, async () => {
      for (const base of bases)
        for (const user of [null, false, 0, [], {}, { toString: 'private' }]) {
          const f = clientUserFixture(kind, { stream });
          const response = await f.handler(
            f.request(base, { user, ...(stream ? { stream: true } : {}) }),
          );
          assert.equal(response.status, 400);
          assert.doesNotMatch(await response.text(), /private|forged|fixture-.*key/u);
          assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
          assert.equal(f.records.length, 0);
          clientUserPrivacy(f);
        }
      for (const user of [null, false, 0, [], {}]) {
        const f = clientUserFixture(kind, { stream });
        await assert.rejects(() => (stream ? f.stream(false, { user }) : f.call({ user })));
        assert.equal(f.counts().secrets, 0);
      }
    });
for (const kind of ['anthropic', 'google'] as const) {
  test(`${kind}: client user never silently translates to unrelated native fields`, async () => {
    for (const base of bases) {
      const omitted = clientUserFixture(kind);
      assert.equal((await omitted.handler(omitted.request(base))).status, 200);
      assert.equal(Object.hasOwn(omitted.sent[0] ?? {}, 'user'), false);
      for (const user of ['', suppliedUser]) {
        const f = clientUserFixture(kind);
        const response = await f.handler(f.request(base, { user }));
        assert.equal(response.status, 502);
        assert.equal(f.counts().secrets, 0);
        assert.doesNotMatch(await response.text(), /private|forged|fixture-.*key/u);
        clientUserPrivacy(f);
        for (const functions of [false, true])
          await assert.rejects(() => f.stream(functions, { user }));
        assert.equal(f.counts().secrets, 0);
      }
    }
  });
}
for (const kind of ['openai', 'openrouter'] as const) {
  for (const stream of [false, true])
    test(`${kind} stream=${stream}: mutable caller user is captured once before secrets`, async () => {
      let reads = 0;
      const fields = {
        get user() {
          reads++;
          return reads === 1 ? suppliedUser : { private: 'changed' };
        },
      };
      const f = clientUserFixture(kind, {
        stream,
        mutate: () => {
          assert.equal(reads, 1);
        },
      });
      if (stream) {
        Object.defineProperty(fields, 'tools', { enumerable: true, value: probabilityTools });
        await f.stream(true, fields);
      } else await f.call(fields);
      assert.equal(f.sent[0]?.user, suppliedUser);
      assert.equal(reads, 1);
    });
  test(`${kind}: user metadata preserves sanitized transport failure accounting`, async () => {
    const f = clientUserFixture(kind, { transportFails: true });
    const response = await f.handler(f.request('/api/v1', { user: suppliedUser }));
    assert.equal(response.status, 502);
    assert.equal(f.counts().secrets, 1);
    assert.equal(f.records[0]?.outcome, 'failed');
    assert.doesNotMatch(await response.text(), /private|forged|fixture-.*key/u);
    clientUserPrivacy(f);
  });
  test(`${kind}: throwing user accessors fail with fixed errors before credentials`, async () => {
    for (const stream of [false, true]) {
      const f = clientUserFixture(kind, { stream });
      const fields = {
        get user() {
          throw new Error('private supplied end-user');
        },
      };
      await assert.rejects(
        () => (stream ? f.stream(false, fields) : f.call(fields)),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.doesNotMatch(error.message, /private|supplied/u);
          return true;
        },
      );
      assert.equal(f.counts().secrets, 0);
    }
  });
}
