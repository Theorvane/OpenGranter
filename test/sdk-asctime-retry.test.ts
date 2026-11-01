import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { OpenRouter } from '@openrouter/sdk';
import { APICallError, generateText } from 'ai';
import OpenAI from 'openai';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { probabilityFixture, probabilityPrivacy } from './nonstream-logprobs-fixture.ts';

for (const base of ['/v1', '/api/v1'] as const)
  for (const kind of ['openrouter', 'openai', 'anthropic', 'google'] as const)
    for (const status of [429, 503])
      for (const client of ['openai', 'openrouter', 'ai-sdk'] as const)
        test(`asctime retry header ${client} ${base} ${kind} upstream${status} reaches the actual client`, {
          timeout: 15000,
        }, async (t) => {
          t.mock.method(Date, 'now', () => Date.UTC(2026, 10, 1, 6, 30, 0, 999));
          const f = probabilityFixture(kind, undefined, {
            reply: () =>
              new Response('private fixture-provider-key', {
                status,
                headers: {
                  'retry-after': 'Sun Nov  1 06:30:10 2026',
                  'x-private-provider': 'private fixture-provider-key',
                },
              }),
          });
          let received = 0;
          const server = createNodeRequestServer((request) => {
            assert.equal(++received, 1, 'Automatic client retry must remain disabled');
            assert.equal(new URL(request.url).pathname, `${base}/chat/completions`);
            return f.handler(request);
          });
          await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
          });
          try {
            const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}${base}`;
            if (client === 'openai') {
              const sdk = new OpenAI({
                apiKey: 'fixture-proxy-key',
                baseURL,
                maxRetries: 0,
                timeout: 3000,
              });
              await assert.rejects(
                sdk.chat.completions.create({
                  model: 'chat',
                  messages: [{ role: 'user', content: 'private prompt' }],
                }),
                (error: unknown) => {
                  assert.ok(error instanceof OpenAI.APIError);
                  assert.equal(error.status, base === '/api/v1' ? status : 502);
                  assert.equal(error.headers.get('retry-after'), '10');
                  assert.equal(error.headers.get('x-private-provider'), null);
                  return true;
                },
              );
            } else if (client === 'openrouter') {
              const sdk = new OpenRouter({
                apiKey: 'fixture-proxy-key',
                serverURL: baseURL,
                retryConfig: { strategy: 'none' },
                timeoutMs: 3000,
              });
              await assert.rejects(
                sdk.chat.send({
                  chatRequest: {
                    model: 'chat',
                    messages: [{ role: 'user', content: 'private prompt' }],
                    stream: false,
                  },
                }),
                (error: unknown) => {
                  assert.ok(error instanceof Error && 'rawResponse' in error);
                  assert.ok(error.rawResponse instanceof Response);
                  assert.equal(error.rawResponse.status, base === '/api/v1' ? status : 502);
                  assert.equal(error.rawResponse.headers.get('retry-after'), '10');
                  assert.equal(error.rawResponse.headers.get('x-private-provider'), null);
                  return true;
                },
              );
            } else {
              const sdk = createOpenRouter({ apiKey: 'fixture-proxy-key', baseURL });
              await assert.rejects(
                generateText({
                  model: sdk.chat('chat'),
                  prompt: 'private prompt',
                  maxRetries: 0,
                  abortSignal: AbortSignal.timeout(3000),
                }),
                (error: unknown) => {
                  assert.ok(APICallError.isInstance(error));
                  assert.equal(error.statusCode, base === '/api/v1' ? status : 502);
                  assert.equal(error.responseHeaders?.['retry-after'], '10');
                  assert.equal(error.responseHeaders?.['x-private-provider'], undefined);
                  return true;
                },
              );
            }
            assert.equal(received, 1);
            assert.equal(f.sent.length, 1);
            assert.equal(f.records[0]?.possiblyBilled, true);
            probabilityPrivacy(f);
          } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            );
          }
        });
