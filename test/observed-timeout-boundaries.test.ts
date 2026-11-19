import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { OpenRouterChatFailure } from '../src/providers/openrouter-chat.ts';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';
import {
  probabilityFixture,
  probabilityPrivacy,
  probabilityTools,
} from './nonstream-logprobs-fixture.ts';

for (const base of ['/v1', '/api/v1'] as const)
  for (const delegated of [false, true])
    for (const mode of ['nonstream', 'text-stream', 'function-stream'] as const) {
      const fields =
        mode === 'nonstream'
          ? {}
          : { stream: true, ...(mode === 'function-stream' ? { tools: probabilityTools } : {}) };
      const label = `timeout metadata ${base} delegated=${delegated} ${mode}`;
      test(`${label}: typed custom status requires matching classification and observed response`, async () => {
        for (const category of ['rate-limit', 'server-error', 'timeout', 'other'] as const)
          for (const responseStarted of [false, true])
            for (const status of [
              408,
              504,
              '408',
              '504',
              undefined,
              null,
              400,
              508,
              -1,
              408.1,
              NaN,
              Infinity,
              {},
            ]) {
              const f = probabilityFixture(delegated ? 'openrouter' : 'openai');
              const error = Object.assign(
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
                throw error;
              };
              const handler = createChatHandler({
                ...f.ports,
                invokeDirect: invoke,
                invokeOpenRouter: invoke,
                invokeDirectTextStream: invoke,
                invokeDirectFunctionStream: invoke,
                invokeOpenRouterTextStream: invoke,
                invokeOpenRouterFunctionStream: invoke,
              });
              const response = await handler(f.request(base, fields));
              const valid =
                responseStarted &&
                ((category === 'other' && status === 408) ||
                  (category === 'server-error' && status === 504));
              assert.equal(response.status, base === '/api/v1' && valid ? status : 502);
              assert.equal(response.headers.get('retry-after'), null);
              assert.doesNotMatch(await response.text(), /private|upstreamStatus|retryAfter/u);
              probabilityPrivacy(f);
            }
      });

      test(`${label}: constructors and route revalidation exclude contradictory timeout retry hints`, async () => {
        for (const status of [408, 504])
          for (const mutate of [false, true]) {
            const f = probabilityFixture(delegated ? 'openrouter' : 'openai');
            const directCategory = status === 408 ? 'other' : 'server-error';
            const error = delegated
              ? new OpenRouterChatFailure(
                  status === 408 ? 'upstream' : 'server-error',
                  true,
                  true,
                  7,
                  status,
                )
              : new DirectProviderFailure(directCategory, true, true, 7, status);
            assert.equal(error.retryAfterSeconds, undefined);
            if (mutate) Object.assign(error, { retryAfterSeconds: 7 });
            const invoke = async () => {
              throw error;
            };
            const handler = createChatHandler({
              ...f.ports,
              invokeDirect: invoke,
              invokeOpenRouter: invoke,
              invokeDirectTextStream: invoke,
              invokeDirectFunctionStream: invoke,
              invokeOpenRouterTextStream: invoke,
              invokeOpenRouterFunctionStream: invoke,
            });
            const response = await handler(f.request(base, fields));
            assert.equal(response.status, base === '/api/v1' ? status : 502);
            assert.equal(response.headers.get('retry-after'), null);
            assert.doesNotMatch(await response.text(), /upstreamStatus|retryAfter/u);
            probabilityPrivacy(f);
          }
      });

      test(`${label}: unclassified exceptions cannot claim observed timeout status`, async () => {
        const f = probabilityFixture(delegated ? 'openrouter' : 'openai');
        const invoke = async () => {
          throw Object.assign(Error('private'), {
            category: 'server-error',
            responseStarted: true,
            upstreamStatus: 504,
            retryAfterSeconds: 7,
          });
        };
        const handler = createChatHandler({
          ...f.ports,
          invokeDirect: invoke,
          invokeOpenRouter: invoke,
          invokeDirectTextStream: invoke,
          invokeDirectFunctionStream: invoke,
          invokeOpenRouterTextStream: invoke,
          invokeOpenRouterFunctionStream: invoke,
        });
        const response = await handler(f.request(base, fields));
        assert.equal(response.status, 502);
        assert.equal(response.headers.get('retry-after'), null);
        assert.doesNotMatch(await response.text(), /private|upstreamStatus|retryAfter/u);
        probabilityPrivacy(f);
      });
    }

for (const base of ['/v1', '/api/v1'] as const)
  for (const kind of ['openrouter', 'openai', 'anthropic', 'google'] as const)
    for (const mode of ['nonstream', 'text-stream', 'function-stream'] as const)
      test(`transport timeout ${base} ${kind} ${mode}: no observed response means no status inference`, async () => {
        const f = probabilityFixture(kind, undefined, {
          stream: mode !== 'nonstream',
          reply: () => {
            throw Object.assign(new DOMException('private fixture-provider-key', 'TimeoutError'), {
              upstreamStatus: 504,
              status: 408,
              retryAfterSeconds: 7,
            });
          },
        });
        const response = await f.handler(
          f.request(
            base,
            mode === 'nonstream'
              ? {}
              : {
                  stream: true,
                  ...(mode === 'function-stream' ? { tools: probabilityTools } : {}),
                },
          ),
        );
        assert.equal(response.status, 502);
        assert.equal(response.headers.get('retry-after'), null);
        assert.doesNotMatch(await response.text(), /private|upstreamStatus|retryAfter/u);
        assert.equal(f.sent.length, 1);
        assert.equal(f.records.length, 1);
        assert.equal(f.records[0]?.outcome, 'failed');
        assert.equal(f.records[0]?.usage.status, 'missing');
        assert.equal(f.records[0]?.possiblyBilled, true);
        probabilityPrivacy(f);
      });
