import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import {
  imageFixture,
  imageHistory,
  imagePrivacy,
  inlineUrl,
} from './inline-image-inputs-fixture.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';

const sdkHistory = [
  {
    role: 'user' as const,
    content: [
      { type: 'text' as const, text: 'private image question Ω' },
      { type: 'image_url' as const, imageUrl: { url: inlineUrl, detail: 'low' as const } },
      { type: 'text' as const, text: '' },
    ],
  },
];
for (const kind of ['openai', 'openrouter'] as const)
  for (const base of ['/v1', '/api/v1'])
    for (const mode of ['text', 'refusal', 'function'] as const)
      for (const stream of [false, true])
        test(`${kind} ${mode} stream=${stream}: both actual SDKs send inline image parts on ${base}`, async () => {
          const f = imageFixture(kind, { mode, stream });
          const server = createNodeChatServer(f.ports);
          await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
          try {
            const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${base}`;
            const openai = new OpenAI({
              apiKey: 'fixture-proxy-key',
              baseURL: url,
              maxRetries: 0,
              timeout: 3000,
            });
            const result = await openai.chat.completions.create({
              model: 'chat',
              messages: imageHistory,
              stream,
              ...(mode === 'function' ? { tools: probabilityTools } : {}),
            });
            if (Symbol.asyncIterator in result) {
              const chunks = [];
              for await (const chunk of result) chunks.push(chunk);
              assert.ok(chunks.length >= 2);
              assert.doesNotMatch(JSON.stringify(chunks), /base64|iVBOR|private image/u);
            } else {
              assert.equal(result.choices[0]?.message.role, 'assistant');
              assert.doesNotMatch(JSON.stringify(result), /base64|iVBOR|private image/u);
            }
            const compatible = new OpenRouter({
              apiKey: 'fixture-proxy-key',
              serverURL: url,
              retryConfig: { strategy: 'none' },
              timeoutMs: 3000,
            });
            const other = await compatible.chat.send({
              chatRequest: {
                model: 'chat',
                messages: sdkHistory,
                stream,
                ...(mode === 'function' ? { tools: probabilityTools } : {}),
              },
            });
            if (Symbol.asyncIterator in other) {
              const chunks = [];
              for await (const chunk of other) chunks.push(chunk);
              assert.ok(chunks.length >= 2);
              assert.doesNotMatch(JSON.stringify(chunks), /base64|iVBOR|private image/u);
            } else {
              assert.ok('choices' in other);
              assert.doesNotMatch(JSON.stringify(other), /base64|iVBOR|private image/u);
            }
            assert.equal(f.sent.length, 2);
            for (const body of f.sent) assert.deepEqual(body.messages, imageHistory);
            assert.equal(f.records.length, 2);
            imagePrivacy(f);
          } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            );
          }
        });
for (const kind of ['openai', 'openrouter'] as const)
  for (const base of ['/v1', '/api/v1'])
    test(`${kind}: actual SDK image/function follow-ups reevaluate current Deny on ${base}`, async () => {
      const f = imageFixture(kind, { mode: 'function' });
      let deny = false;
      const server = createNodeChatServer({
        ...f.ports,
        authenticate: async (...args) => {
          const p = await f.ports.authenticate(...args);
          return p && { ...p, statements: deny ? [] : p.statements };
        },
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${base}`;
        const openai = new OpenAI({
          apiKey: 'fixture-proxy-key',
          baseURL: url,
          maxRetries: 0,
          timeout: 3000,
        });
        const first = await openai.chat.completions.create({
          model: 'chat',
          messages: imageHistory,
          tools: probabilityTools,
        });
        const call = first.choices[0]?.message.tool_calls?.[0];
        assert.ok(call);
        assert.equal(call.id, 'call');
        const next = [
          ...imageHistory,
          { role: 'assistant' as const, content: null, tool_calls: [call] },
          { role: 'tool' as const, tool_call_id: call.id, content: 'private result' },
        ];
        await openai.chat.completions.create({
          model: 'chat',
          messages: next,
          tools: probabilityTools,
        });
        assert.deepEqual(f.sent[1]?.messages, next);
        deny = true;
        await assert.rejects(
          () =>
            openai.chat.completions.create({
              model: 'chat',
              messages: next,
              tools: probabilityTools,
            }),
          (error) => error instanceof OpenAI.APIError && error.status === 403,
        );
        assert.equal(f.sent.length, 2);
        deny = false;
        const compatible = new OpenRouter({
          apiKey: 'fixture-proxy-key',
          serverURL: url,
          retryConfig: { strategy: 'none' },
          timeoutMs: 3000,
        });
        const response = await compatible.chat.send({
          chatRequest: {
            model: 'chat',
            messages: sdkHistory,
            tools: probabilityTools,
            stream: false,
          },
        });
        assert.ok('choices' in response);
        const sdkCall = response.choices[0]?.message.toolCalls?.[0];
        assert.ok(sdkCall);
        const follow = [
          ...sdkHistory,
          { role: 'assistant' as const, content: null, toolCalls: [sdkCall] },
          { role: 'tool' as const, toolCallId: sdkCall.id, content: 'private result' },
        ];
        await compatible.chat.send({
          chatRequest: { model: 'chat', messages: follow, tools: probabilityTools, stream: false },
        });
        assert.equal(f.sent.length, 4);
        assert.deepEqual(f.sent[3]?.messages, next);
        deny = true;
        await assert.rejects(() =>
          compatible.chat.send({
            chatRequest: {
              model: 'chat',
              messages: follow,
              tools: probabilityTools,
              stream: false,
            },
          }),
        );
        assert.equal(f.sent.length, 4);
        assert.equal(f.records.length, 4);
        imagePrivacy(f);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    });
