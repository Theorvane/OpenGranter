import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import {
  predictionFixture,
  predictionPrivacy,
  stringPrediction,
  suppliedPrediction,
} from './predicted-output-fixture.ts';

for (const kind of ['openai', 'openrouter'] as const)
  for (const base of ['/v1', '/api/v1'])
    for (const mode of ['text', 'refusal'] as const)
      for (const stream of [false, true])
        for (const inputPrediction of [stringPrediction, suppliedPrediction])
          test(`${kind} ${mode} stream=${stream}: predicted ${typeof inputPrediction.content} output passes both actual SDK sockets on ${base}`, async () => {
            const f = predictionFixture(kind, { mode, stream });
            const server = createNodeChatServer(f.ports);
            await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
            try {
              const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${base}`;
              const raw = new OpenAI({
                apiKey: 'fixture-proxy-key',
                baseURL: url,
                maxRetries: 0,
                timeout: 3000,
              });
              const result = await raw.chat.completions.create({
                model: 'chat',
                messages: [{ role: 'user', content: 'private prompt' }],
                prediction: inputPrediction,
                stream,
              });
              if (Symbol.asyncIterator in result) {
                const chunks = [];
                for await (const chunk of result) chunks.push(chunk);
                assert.ok(chunks.length >= 2);
                assert.doesNotMatch(JSON.stringify(chunks), /predicted output|second part/u);
              } else {
                assert.equal(result.choices[0]?.message.role, 'assistant');
                assert.doesNotMatch(JSON.stringify(result), /predicted output|second part/u);
              }
              const client = new OpenRouter({
                apiKey: 'fixture-proxy-key',
                serverURL: url,
                retryConfig: { strategy: 'none' },
                timeoutMs: 3000,
              });
              const compatible = await client.chat.send({
                chatRequest: {
                  model: 'chat',
                  messages: [{ role: 'user', content: 'private prompt' }],
                  prediction: inputPrediction,
                  stream,
                },
              });
              if (Symbol.asyncIterator in compatible) {
                const frames = [];
                for await (const chunk of compatible) frames.push(chunk);
                assert.ok(frames.length >= 2);
                assert.doesNotMatch(JSON.stringify(frames), /predicted output|second part/u);
              } else {
                assert.ok('choices' in compatible);
                assert.doesNotMatch(JSON.stringify(compatible), /predicted output|second part/u);
              }
              assert.equal(f.sent.length, 2);
              for (const body of f.sent) assert.deepEqual(body.prediction, inputPrediction);
              assert.equal(f.records.length, 2);
              predictionPrivacy(f);
            } finally {
              server.closeAllConnections();
              await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve())),
              );
            }
          });
