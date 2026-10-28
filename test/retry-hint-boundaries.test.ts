import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createClientErrorResponse } from '../src/gateway/client-errors.ts';
import { OpenRouterChatFailure } from '../src/providers/openrouter-chat.ts';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';
import { probabilityFixture, probabilityPrivacy } from './nonstream-logprobs-fixture.ts';

for (const base of ['/v1', '/api/v1'] as const) {
  for (const delegated of [false, true])
    test(`retry hints ${base} ${delegated ? 'delegated' : 'direct'}: malformed or unrelated custom failure metadata cannot escape`, async () => {
      for (const category of ['rate-limit', 'server-error', 'timeout', 'other'] as const)
        for (const hint of [
          'private fixture-provider-key',
          '7',
          -1,
          1.5,
          Infinity,
          NaN,
          9007199254740992,
          0,
          7,
        ]) {
          const f = probabilityFixture(delegated ? 'openrouter' : 'openai');
          const failure = Object.assign(
            delegated
              ? new OpenRouterChatFailure(category === 'other' ? 'upstream' : category, true, true)
              : new DirectProviderFailure(category, true, true),
            { retryAfterSeconds: hint },
          );
          const invoke = async () => {
            throw failure;
          };
          const handler = createChatHandler({
            ...f.ports,
            ...(delegated ? { invokeOpenRouter: invoke } : { invokeDirect: invoke }),
          });
          const response = await handler(f.request(base));
          assert.equal(response.status, 502);
          const valid =
            (category === 'rate-limit' || category === 'server-error') &&
            typeof hint === 'number' &&
            (hint === 0 || hint === 7);
          assert.equal(response.headers.get('retry-after'), valid ? String(hint) : null);
          assert.doesNotMatch(await response.text(), /private|retry.?after/iu);
          probabilityPrivacy(f);
          assert.doesNotMatch(JSON.stringify([f.records, f.audits]), /retry.?after/iu);
        }
    });

  for (const end of ['success', 'unhinted-failure', 'hinted-failure'] as const)
    test(`retry hints ${base}: managed fallback ${end} uses only the final outcome`, async () => {
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
          if (++attempts === 1) throw new DirectProviderFailure('rate-limit', false, true, 7);
          if (end !== 'success')
            throw new DirectProviderFailure(
              'server-error',
              true,
              true,
              end === 'hinted-failure' ? 9 : undefined,
            );
          return f.ports.invokeDirect(candidate, request);
        },
      });
      const response = await handler(f.request(base));
      assert.equal(response.status, end === 'success' ? 200 : 502);
      assert.equal(response.headers.get('retry-after'), end === 'hinted-failure' ? '9' : null);
      assert.equal(attempts, 2);
      assert.equal(f.records.length, 2);
      assert.equal(f.records[0]?.outcome, 'failed');
      assert.equal(f.records[1]?.possibleDuplicate, true);
      assert.equal(f.records[1]?.outcome, end === 'success' ? 'succeeded' : 'failed');
      probabilityPrivacy(f);
      assert.doesNotMatch(JSON.stringify([f.records, f.audits]), /retry.?after/iu);
    });
}
for (const format of ['opengranter', 'openrouter'] as const)
  test(`retry hint serializer ${format}: unrelated local reasons cannot receive hints`, () => {
    for (const [status, code] of [
      [429, 'limit_exceeded'],
      [503, 'audit_unavailable'],
      [503, 'usage_unavailable'],
      [401, 'unauthorized'],
      [200, 'upstream_failed'],
    ] as const)
      assert.equal(
        createClientErrorResponse(status, code, 'request', format, 7).headers.get('retry-after'),
        null,
      );
    for (const seconds of [-1, 1.5, NaN, Infinity, 9007199254740992])
      assert.equal(
        createClientErrorResponse(502, 'upstream_failed', 'request', format, seconds).headers.get(
          'retry-after',
        ),
        null,
      );
  });

for (const base of ['/v1', '/api/v1'] as const)
  for (const kind of ['openrouter', 'openai', 'anthropic', 'google'] as const)
    test(`retry hints ${base} ${kind}: response waits for both required handoffs`, {
      timeout: 15000,
    }, async () => {
      const f = probabilityFixture(kind, undefined, {
        reply: () => new Response('private', { status: 429, headers: { 'retry-after': '7' } }),
      });
      let enterUsage: () => void = () => {},
        releaseUsage: () => void = () => {},
        enterAudit: () => void = () => {},
        releaseAudit: () => void = () => {};
      const usageEntered = new Promise<void>((resolve) => {
        enterUsage = resolve;
      });
      const usageReleased = new Promise<void>((resolve) => {
        releaseUsage = resolve;
      });
      const auditEntered = new Promise<void>((resolve) => {
        enterAudit = resolve;
      });
      const auditReleased = new Promise<void>((resolve) => {
        releaseAudit = resolve;
      });
      const handler = createChatHandler({
        ...f.ports,
        writeUsage: async (record) => {
          enterUsage();
          await usageReleased;
          await f.ports.writeUsage(record);
        },
        writeAudit: async (event) => {
          if (event.kind === 'attempt' || event.kind === 'delegated-attempt') {
            enterAudit();
            await auditReleased;
          }
          await f.ports.writeAudit(event);
        },
      });
      let settled = false;
      const pending = handler(f.request(base)).then((response) => {
        settled = true;
        return response;
      });
      try {
        await usageEntered;
        assert.equal(settled, false);
        releaseUsage();
        await auditEntered;
        assert.equal(settled, false);
        releaseAudit();
        const response = await pending;
        assert.equal(response.status, base === '/api/v1' ? 429 : 502);
        assert.equal(response.headers.get('retry-after'), '7');
        assert.equal(f.records.length, 1);
        probabilityPrivacy(f);
      } finally {
        releaseUsage();
        releaseAudit();
      }
    });
