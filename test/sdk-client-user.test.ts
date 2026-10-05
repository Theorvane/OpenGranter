import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import { clientUserFixture, clientUserPrivacy, suppliedUser } from './client-user-fixture.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';

for (const kind of ['openai', 'openrouter'] as const)
  for (const base of ['/v1', '/api/v1'])
    for (const mode of ['text', 'refusal', 'function'] as const)
      for (const stream of [false, true])
        test(`${kind} ${mode} stream=${stream}: client user passes both actual SDK sockets on ${base}`, async () => {
          const f = clientUserFixture(kind, { mode, stream });
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
              user: suppliedUser,
              stream,
              ...(mode === 'function' ? { tools: probabilityTools } : {}),
            });
            if (Symbol.asyncIterator in result) {
              const chunks = [];
              for await (const chunk of result) chunks.push(chunk);
              assert.ok(chunks.length >= 2);
              assert.doesNotMatch(JSON.stringify(chunks), /supplied end-user/u);
            } else {
              assert.equal(result.choices[0]?.message.role, 'assistant');
              assert.doesNotMatch(JSON.stringify(result), /supplied end-user/u);
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
                user: suppliedUser,
                stream,
                ...(mode === 'function' ? { tools: probabilityTools } : {}),
              },
            });
            if (Symbol.asyncIterator in compatible) {
              const frames = [];
              for await (const chunk of compatible) frames.push(chunk);
              assert.ok(frames.length >= 2);
              assert.doesNotMatch(JSON.stringify(frames), /supplied end-user/u);
            } else {
              assert.ok('choices' in compatible);
              assert.doesNotMatch(JSON.stringify(compatible), /supplied end-user/u);
            }
            assert.equal(f.sent.length, 2);
            assert.ok(f.sent.every((body) => body.user === suppliedUser));
            assert.equal(f.records.length, 2);
            clientUserPrivacy(f);
          } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            );
          }
        });
