import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatHandlerPorts } from '../src/gateway/chat-handler.ts';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { OpenRouterChatFailure } from '../src/providers/openrouter-chat.ts';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';
import {
  probabilityFixture,
  probabilityPrivacy,
  probabilityTools,
} from './nonstream-logprobs-fixture.ts';
import { probabilityStreamPayloads, probabilityStreamResponse } from './stream-logprobs-fixture.ts';

for (const base of ['/v1', '/api/v1'] as const)
  for (const delegated of [false, true])
    for (const functions of [false, true]) {
      const fields = { stream: true, ...(functions ? { tools: probabilityTools } : {}) };
      const label = `stream error isolation ${base} delegated=${delegated} functions=${functions}`;
      test(`${label}: unclassified metadata has no HTTP authority`, async () => {
        const f = probabilityFixture(delegated ? 'openrouter' : 'openai');
        const invoke = async () => {
          throw Object.assign(Error('private fixture-provider-key'), {
            category: 'rate-limit',
            responseStarted: true,
            possiblyBilled: true,
            upstreamStatus: 429,
            retryAfterSeconds: 7,
          });
        };
        const handler = createChatHandler({
          ...f.ports,
          invokeDirectTextStream: invoke,
          invokeDirectFunctionStream: invoke,
          invokeOpenRouterTextStream: invoke,
          invokeOpenRouterFunctionStream: invoke,
        });
        const response = await handler(f.request(base, fields));
        assert.equal(response.status, 502);
        assert.equal(response.headers.get('retry-after'), null);
        assert.doesNotMatch(await response.text(), /private|upstreamStatus|retryAfter/u);
        assert.equal(f.records.length, 1);
        assert.equal(f.records[0]?.usage.status, 'missing');
        probabilityPrivacy(f);
      });

      test(`${label}: already-started failure retains generic SSE semantics and no advisory metadata`, async () => {
        for (const status of [408, 429, 503, 504])
          for (const interruptionFails of [false, true]) {
            const f = probabilityFixture(delegated ? 'openrouter' : 'openai');
            const fail = async (
              onDelta: Parameters<
                NonNullable<ChatHandlerPorts<unknown>['invokeDirectTextStream']>
              >[2],
            ): Promise<never> => {
              await onDelta({
                kind: 'delta',
                id: 'completion',
                created: 42,
                model: 'chat',
                content: 'private delivered text',
                finishReason: null,
              });
              const category = status === 429 ? 'rate-limit' : 'server-error';
              throw delegated
                ? new OpenRouterChatFailure(
                    status === 408 ? 'upstream' : category,
                    true,
                    true,
                    7,
                    status,
                  )
                : new DirectProviderFailure(
                    status === 408 ? 'other' : category,
                    true,
                    true,
                    7,
                    status,
                  );
            };
            const handler = createChatHandler({
              ...f.ports,
              invokeDirectTextStream: (_candidate, _request, delta) => fail(delta),
              invokeDirectFunctionStream: (_candidate, _request, delta) => fail(delta),
              invokeOpenRouterTextStream: (_ref, _attempt, _request, delta) => fail(delta),
              invokeOpenRouterFunctionStream: (_ref, _attempt, _request, delta) => fail(delta),
              writeAudit: async (event) => {
                if (interruptionFails && event.kind === 'stream-interrupted')
                  throw Error('private audit failure');
                await f.ports.writeAudit(event);
              },
            });
            const response = await handler(f.request(base, fields));
            assert.equal(response.status, 200);
            assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/u);
            assert.equal(response.headers.get('retry-after'), null);
            const wire = await response.text();
            assert.match(wire, /private delivered text/u);
            assert.doesNotMatch(
              wire,
              /\[DONE\]|"usage"\s*:|retryAfter|upstreamStatus|retry-after|private audit failure|fixture-provider-key/u,
            );
            const events: unknown[] = wire
              .split('\n\n')
              .filter(Boolean)
              .map((frame) => JSON.parse(frame.slice(6)) as unknown);
            const error = events.at(-1);
            assert.ok(typeof error === 'object' && error !== null && 'error' in error);
            assert.deepEqual(error.error, {
              code:
                base === '/api/v1'
                  ? interruptionFails
                    ? 503
                    : 502
                  : interruptionFails
                    ? 'audit_unavailable'
                    : 'upstream_failed',
              message: interruptionFails
                ? 'Required audit recording is temporarily unavailable.'
                : 'Upstream model request failed.',
              ...(base === '/api/v1'
                ? {
                    metadata: {
                      opengranter_code: interruptionFails ? 'audit_unavailable' : 'upstream_failed',
                      error_type: interruptionFails ? 'server' : 'unmapped',
                    },
                  }
                : {}),
            });
            if (base === '/api/v1') {
              assert.ok('choices' in error);
              assert.deepEqual(error.choices, [
                { index: 0, delta: { content: '' }, finish_reason: 'error' },
              ]);
            }
            assert.equal(f.records.length, 1);
            assert.equal(f.records[0]?.outcome, 'failed');
            assert.equal(f.records[0]?.possiblyBilled, true);
            probabilityPrivacy(f);
            assert.doesNotMatch(
              JSON.stringify([f.records, f.audits]),
              /upstreamStatus|retryAfter/u,
            );
          }
      });
    }

for (const base of ['/v1', '/api/v1'] as const)
  for (const functions of [false, true])
    for (const end of ['success', 'generic', 'hinted', 'timeout'] as const)
      test(`pre-stream managed fallback ${base} functions=${functions} end=${end}: only the last outcome supplies metadata`, async () => {
        const f = probabilityFixture('openai', undefined, {
          stream: true,
          reply: () =>
            probabilityStreamResponse(
              probabilityStreamPayloads('openai', {
                absent: true,
                mode: functions ? 'function' : 'text',
              }),
            ),
        });
        let attempts = 0;
        const beforeAttempt = () => {
          if (++attempts === 1) throw new DirectProviderFailure('rate-limit', false, true, 7, 429);
          if (end === 'generic') throw new DirectProviderFailure('other', true, true);
          if (end === 'hinted') throw new DirectProviderFailure('server-error', true, true, 9, 503);
          if (end === 'timeout')
            throw new DirectProviderFailure('server-error', true, true, 9, 504);
        };
        const invokeText = f.ports.invokeDirectTextStream;
        const invokeFunctions = f.ports.invokeDirectFunctionStream;
        assert.ok(invokeText && invokeFunctions);
        const handler = createChatHandler({
          ...f.ports,
          resolveRoute: async () => ({
            kind: 'managed',
            version: 'v1',
            candidates: ['first', 'second'].map((id) => ({
              id,
              kind: 'managed',
              providerId: 'provider',
              upstreamModelId: 'upstream-model',
            })),
          }),
          invokeDirectTextStream: (...args) => {
            beforeAttempt();
            return invokeText(...args);
          },
          invokeDirectFunctionStream: (...args) => {
            beforeAttempt();
            return invokeFunctions(...args);
          },
        });
        const response = await handler(
          f.request(base, { stream: true, ...(functions ? { tools: probabilityTools } : {}) }),
        );
        assert.equal(
          response.status,
          end === 'success'
            ? 200
            : end === 'timeout' && base === '/api/v1'
              ? 504
              : end === 'hinted' && base === '/api/v1'
                ? 503
                : 502,
        );
        assert.equal(response.headers.get('retry-after'), end === 'hinted' ? '9' : null);
        const body = await response.text();
        if (end === 'success') assert.match(body, /data: \[DONE\]/u);
        else assert.doesNotMatch(body, /data: \[DONE\]|private/u);
        assert.equal(attempts, 2);
        assert.equal(f.records.length, 2);
        assert.equal(f.records[0]?.outcome, 'failed');
        assert.equal(f.records[1]?.possibleDuplicate, true);
        assert.equal(f.records[1]?.outcome, end === 'success' ? 'succeeded' : 'failed');
        probabilityPrivacy(f);
        assert.doesNotMatch(JSON.stringify([f.records, f.audits]), /upstreamStatus|retryAfter/u);
      });
