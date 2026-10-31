import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { OpenRouterChatFailure } from '../src/providers/openrouter-chat.ts';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';
import { probabilityFixture, probabilityPrivacy } from './nonstream-logprobs-fixture.ts';

for (const base of ['/v1', '/api/v1'] as const) {
  for (const delegated of [false, true])
    for (const responseStarted of [true, false])
      test(`upstream status ${base} delegated=${delegated} responseStarted=${responseStarted}: custom metadata remains bounded`, async () => {
        for (const category of ['rate-limit', 'server-error', 'timeout', 'other'] as const)
          for (const status of [
            undefined,
            null,
            '429',
            '503',
            '408',
            '504',
            'private fixture-provider-key',
            429,
            503,
            408,
            500,
            504,
            NaN,
            Infinity,
            {},
          ]) {
            const f = probabilityFixture(delegated ? 'openrouter' : 'openai');
            const failure = Object.assign(
              delegated
                ? new OpenRouterChatFailure(
                    category === 'other' ? 'upstream' : category,
                    responseStarted,
                    true,
                  )
                : new DirectProviderFailure(category, responseStarted, true),
              { upstreamStatus: status },
            );
            const invoke = async () => {
              throw failure;
            };
            const handler = createChatHandler({
              ...f.ports,
              ...(delegated ? { invokeOpenRouter: invoke } : { invokeDirect: invoke }),
            });
            const response = await handler(f.request(base));
            const matching =
              responseStarted &&
              ((category === 'rate-limit' && status === 429) ||
                (category === 'server-error' && (status === 503 || status === 504)) ||
                (category === 'other' && status === 408));
            assert.equal(response.status, base === '/api/v1' && matching ? status : 502);
            assert.equal(response.headers.get('retry-after'), null);
            assert.doesNotMatch(await response.text(), /private|upstreamStatus/u);
            probabilityPrivacy(f);
            assert.doesNotMatch(JSON.stringify([f.records, f.audits]), /upstreamStatus/u);
          }
      });

  for (const delegated of [false, true])
    test(`upstream status ${base} delegated=${delegated}: unclassified exceptions cannot supply status`, async () => {
      const f = probabilityFixture(delegated ? 'openrouter' : 'openai');
      const invoke = async () => {
        throw Object.assign(new Error('private fixture-provider-key'), {
          category: 'rate-limit',
          responseStarted: true,
          upstreamStatus: 429,
          retryAfterSeconds: 7,
        });
      };
      const handler = createChatHandler({
        ...f.ports,
        ...(delegated ? { invokeOpenRouter: invoke } : { invokeDirect: invoke }),
      });
      const response = await handler(f.request(base));
      assert.equal(response.status, 502);
      assert.equal(response.headers.get('retry-after'), null);
      assert.doesNotMatch(await response.text(), /private|upstreamStatus/u);
      probabilityPrivacy(f);
    });

  for (const end of ['success', 'generic', '503', '429', '408', '504'] as const)
    test(`upstream status ${base}: fallback ${end} projects only the final outcome`, async () => {
      const f = probabilityFixture('openai', undefined, { absent: true });
      let attempts = 0;
      const handler = createChatHandler({
        ...f.ports,
        resolveRoute: async () => ({
          kind: 'managed',
          version: 'v1',
          candidates: [
            {
              id: 'first',
              kind: 'managed',
              providerId: 'provider',
              upstreamModelId: 'upstream-model',
            },
            {
              id: 'second',
              kind: 'managed',
              providerId: 'provider',
              upstreamModelId: 'upstream-model',
            },
          ],
        }),
        invokeDirect: async (candidate, request) => {
          if (++attempts === 1) throw new DirectProviderFailure('rate-limit', false, true, 7, 429);
          if (end === 'generic') throw new DirectProviderFailure('other', true, true);
          if (end === '503')
            throw new DirectProviderFailure('server-error', true, true, undefined, 503);
          if (end === '429') throw new DirectProviderFailure('rate-limit', true, true, 9, 429);
          if (end === '408') throw new DirectProviderFailure('other', true, true, 9, 408);
          if (end === '504') throw new DirectProviderFailure('server-error', true, true, 9, 504);
          return f.ports.invokeDirect(candidate, request);
        },
      });
      const response = await handler(f.request(base));
      const expected =
        end === 'success' ? 200 : base === '/api/v1' && end !== 'generic' ? Number(end) : 502;
      assert.equal(response.status, expected);
      assert.equal(response.headers.get('retry-after'), end === '429' ? '9' : null);
      assert.equal(attempts, 2);
      assert.equal(f.records.length, 2);
      assert.equal(f.records[1]?.possibleDuplicate, true);
      assert.equal(f.records[1]?.outcome, end === 'success' ? 'succeeded' : 'failed');
      probabilityPrivacy(f);
      assert.doesNotMatch(JSON.stringify([f.records, f.audits]), /upstreamStatus/u);
    });
}
