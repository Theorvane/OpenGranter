import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import { sdkTtlHistory, ttlHistory } from './breakpoint-ttl-fixture.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';
import {
  breakpointFixture,
  breakpointHistory,
  breakpointPrivacy,
} from './prompt-cache-breakpoints-fixture.ts';

for (const kind of ['openai', 'openrouter'] as const)
  for (const base of ['/v1', '/api/v1'])
    for (const stream of [false, true])
      for (const mode of ['text', 'refusal', 'function'] as const)
        test(`${kind} ${mode} stream=${stream} ${base}: OpenAI SDK preserves TTL; pinned OpenRouter SDK strips it`, async () => {
          const f = breakpointFixture(kind, { mode, stream });
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
              messages: ttlHistory(),
              stream,
              ...(mode === 'function' ? { tools: probabilityTools } : {}),
            });
            if (Symbol.asyncIterator in result) {
              const chunks = [];
              for await (const chunk of result) chunks.push(chunk);
              assert.ok(chunks.length >= 2);
              assert.doesNotMatch(
                JSON.stringify(chunks),
                /prompt_cache_breakpoint|private reusable|changing suffix|12h/u,
              );
            } else assert.equal(result.choices[0]?.message.role, 'assistant');
            assert.deepEqual(f.sent[0]?.messages, ttlHistory());
            const client = new OpenRouter({
              apiKey: 'fixture-proxy-key',
              serverURL: url,
              retryConfig: { strategy: 'none' },
              timeoutMs: 3000,
            });
            const compatible = await client.chat.send({
              chatRequest: {
                model: 'chat',
                messages: sdkTtlHistory(),
                stream,
                ...(mode === 'function' ? { tools: probabilityTools } : {}),
              },
            });
            if (Symbol.asyncIterator in compatible) {
              const frames = [];
              for await (const frame of compatible) frames.push(frame);
              assert.ok(frames.length >= 2);
              assert.doesNotMatch(
                JSON.stringify(frames),
                /prompt_cache_breakpoint|private reusable|changing suffix|12h/u,
              );
            } else assert.ok('choices' in compatible);
            // This is a measured client serializer limitation, not TTL support certification.
            assert.deepEqual(f.sent[1]?.messages, breakpointHistory);
            assert.equal(f.sent.length, 2);
            assert.equal(f.records.length, 2);
            breakpointPrivacy(f);
          } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
              server.close((e) => (e ? reject(e) : resolve())),
            );
          }
        });
