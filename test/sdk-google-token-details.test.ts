import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import type { ChatUsage } from '@openrouter/sdk/models';
import OpenAI from 'openai';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import {
  googleDetailCounts,
  googleDetailInput,
  googleDetailsFixture,
  googleDetailUsage,
} from './google-token-details-fixture.ts';

for (const mode of ['nonstream', 'text-stream', 'function-stream'] as const)
  for (const base of ['/v1', '/api/v1'])
    test(`Gemini ${mode} usage categories survive both actual SDKs ${base}`, async () => {
      const f = googleDetailsFixture(mode, {
        ...googleDetailCounts,
        cachedContentTokenCount: 1,
        thoughtsTokenCount: 4,
      });
      const server = createNodeChatServer(f.ports);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${base}`;
        const raw = new OpenAI({
          apiKey: 'fixture-proxy-token',
          baseURL: url,
          maxRetries: 0,
          timeout: 3000,
        });
        if (mode === 'nonstream') {
          const result = await raw.chat.completions.create({
            ...googleDetailInput(mode),
            stream: false,
          });
          assert.deepEqual(result.usage, googleDetailUsage);
        } else {
          const result = await raw.chat.completions.create({
            ...googleDetailInput(mode),
            stream: true,
          });
          const chunks = [];
          for await (const chunk of result) chunks.push(chunk);
          assert.deepEqual(chunks.at(-1)?.usage, googleDetailUsage);
          if (mode === 'function-stream')
            assert.ok(chunks.some((c) => c.choices[0]?.delta.tool_calls?.[0]?.id === 'call'));
        }
        const client = new OpenRouter({
          apiKey: 'fixture-proxy-token',
          serverURL: url,
          retryConfig: { strategy: 'none' },
          timeoutMs: 3000,
        });
        const chat = googleDetailInput(mode);
        const request = {
          model: chat.model,
          messages: chat.messages,
          ...(chat.tools ? { tools: chat.tools } : {}),
        };
        let usage: ChatUsage | null | undefined;
        if (mode === 'nonstream') {
          const result = await client.chat.send({ chatRequest: { ...request, stream: false } });
          assert.ok('choices' in result);
          usage = result.usage;
        } else {
          const result = await client.chat.send({
            chatRequest: { ...request, stream: true, streamOptions: { includeUsage: true } },
          });
          assert.ok(Symbol.asyncIterator in result);
          const chunks = [];
          for await (const chunk of result) chunks.push(chunk);
          usage = chunks.at(-1)?.usage;
          if (mode === 'function-stream')
            assert.ok(chunks.some((c) => c.choices[0]?.delta.toolCalls?.[0]?.id === 'call'));
        }
        assert.equal(usage?.promptTokens, 3);
        assert.equal(usage?.completionTokens, 2);
        assert.equal(usage?.totalTokens, 9);
        assert.deepEqual(usage?.promptTokensDetails, { cachedTokens: 1 });
        assert.deepEqual(usage?.completionTokensDetails, { reasoningTokens: 4 });
        assert.equal(f.records.length, 2);
        assert.ok(f.records.every((r) => r.usage.totalTokens === 9 && r.outcome === 'succeeded'));
        assert.doesNotMatch(
          JSON.stringify({ records: f.records, audits: f.audits }),
          /private|cached_tokens|reasoning_tokens|fixture-provider-key|fixture-proxy-token/u,
        );
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((e) => (e ? reject(e) : resolve())),
        );
      }
    });
