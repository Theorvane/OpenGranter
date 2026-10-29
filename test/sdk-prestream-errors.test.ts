import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { OpenRouter } from '@openrouter/sdk';
import { APICallError, streamText, tool } from 'ai';
import OpenAI from 'openai';
import { z } from 'zod';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import {
  probabilityFixture,
  probabilityPrivacy,
  probabilityTools,
} from './nonstream-logprobs-fixture.ts';

for (const base of ['/v1', '/api/v1'] as const)
  for (const kind of ['openrouter', 'openai', 'anthropic', 'google'] as const)
    for (const functions of [false, true])
      for (const status of [429, 503])
        for (const client of ['openai', 'openrouter', 'ai-sdk'] as const)
          test(`pre-stream ${client} ${base} ${kind} functions=${functions} upstream${status}: actual JSON error and hint`, {
            timeout: 15000,
          }, async () => {
            const f = probabilityFixture(kind, undefined, {
              stream: true,
              reply: () =>
                new Response('private fixture-provider-key', {
                  status,
                  headers: {
                    'retry-after': '0007',
                    'x-private-provider': 'private fixture-provider-key',
                  },
                }),
            });
            let received = 0;
            const server = createNodeRequestServer((request) => {
              assert.equal(++received, 1, 'Automatic retries must stay disabled');
              assert.equal(new URL(request.url).pathname, `${base}/chat/completions`);
              return f.handler(request);
            });
            await new Promise<void>((resolve, reject) => {
              server.once('error', reject);
              server.listen(0, '127.0.0.1', resolve);
            });
            try {
              const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}${base}`;
              const expected = base === '/api/v1' ? status : 502;
              const request = {
                model: 'chat',
                messages: [{ role: 'user' as const, content: 'private prompt' }],
                stream: true as const,
                ...(functions ? { tools: probabilityTools } : {}),
              };
              if (client === 'openai') {
                const sdk = new OpenAI({
                  apiKey: 'fixture-proxy-key',
                  baseURL,
                  maxRetries: 0,
                  timeout: 3000,
                });
                await assert.rejects(sdk.chat.completions.create(request), (error: unknown) => {
                  assert.ok(error instanceof OpenAI.APIError);
                  assert.equal(error.status, expected);
                  assert.equal(error.headers.get('retry-after'), '7');
                  assert.equal(error.headers.get('x-private-provider'), null);
                  assert.doesNotMatch(
                    JSON.stringify(error.error),
                    /private|retryAfter|upstreamStatus/u,
                  );
                  return true;
                });
              } else if (client === 'openrouter') {
                const sdk = new OpenRouter({
                  apiKey: 'fixture-proxy-key',
                  serverURL: baseURL,
                  retryConfig: { strategy: 'none' },
                  timeoutMs: 3000,
                });
                await assert.rejects(sdk.chat.send({ chatRequest: request }), (error: unknown) => {
                  assert.ok(
                    error instanceof Error &&
                      'rawResponse' in error &&
                      error.rawResponse instanceof Response,
                  );
                  assert.equal(error.rawResponse.status, expected);
                  assert.equal(error.rawResponse.headers.get('retry-after'), '7');
                  assert.equal(error.rawResponse.headers.get('x-private-provider'), null);
                  return true;
                });
              } else {
                const sdk = createOpenRouter({ apiKey: 'fixture-proxy-key', baseURL });
                const result = streamText({
                  model: sdk.chat('chat'),
                  prompt: 'private prompt',
                  maxRetries: 0,
                  abortSignal: AbortSignal.timeout(3000),
                  onError: () => {},
                  ...(functions
                    ? { tools: { lookup: tool({ inputSchema: z.object({ query: z.string() }) }) } }
                    : {}),
                });
                const errors: unknown[] = [];
                for await (const part of result.fullStream)
                  if (part.type === 'error') errors.push(part.error);
                assert.equal(errors.length, 1);
                const error = errors[0];
                assert.ok(APICallError.isInstance(error));
                assert.equal(error.statusCode, expected);
                assert.equal(error.responseHeaders?.['retry-after'], '7');
                assert.equal(error.responseHeaders?.['x-private-provider'], undefined);
                assert.doesNotMatch(error.responseBody ?? '', /private|upstreamStatus|retryAfter/u);
              }
              assert.equal(received, 1);
              assert.equal(f.sent.length, 1);
              assert.equal(f.records.length, 1);
              assert.equal(f.records[0]?.outcome, 'failed');
              assert.equal(f.records[0]?.usage.status, 'missing');
              assert.equal(f.records[0]?.possiblyBilled, true);
              probabilityPrivacy(f);
            } finally {
              server.closeAllConnections();
              await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve())),
              );
            }
          });
