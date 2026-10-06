import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import { createRegisteredDirectTextStreamInvoker } from '../src/providers/direct-text-stream.ts';
import {
  frames as anthropicFrames,
  start as anthropicStart,
} from './anthropic-function-stream-fixture.ts';
import { chunk as googleChunk, frames as googleFrames } from './google-function-stream-fixture.ts';
import { imagePrivacy } from './inline-image-inputs-fixture.ts';
import {
  nativeImageFixture as imageFixture,
  nativeImageHistory as imageHistory,
  nativeExpected,
  nativeSdkHistory as sdkHistory,
} from './native-inline-images-fixture.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';

for (const kind of ['anthropic', 'google'] as const)
  for (const base of ['/v1', '/api/v1'])
    for (const mode of ['text', 'function'] as const)
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
            for (const body of f.sent)
              assert.deepEqual(
                body[kind === 'anthropic' ? 'messages' : 'contents'],
                nativeExpected(kind),
              );
            assert.equal(f.records.length, 2);
            imagePrivacy(f);
          } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            );
          }
        });
for (const kind of ['anthropic', 'google'] as const)
  for (const base of ['/v1', '/api/v1'])
    test(`${kind}: actual SDK image/function follow-ups reevaluate current Deny on ${base}`, async () => {
      const f = imageFixture(kind, { mode: 'function' });
      let deny = false;
      const server = createNodeChatServer({
        ...f.ports,
        authenticate: async (...args) => {
          const p = await f.ports.authenticate(...args);
          return (
            p && {
              ...p,
              statements: deny
                ? [
                    ...p.statements,
                    { effect: 'Deny', actions: ['llm:*'], resources: ['provider:provider'] },
                  ]
                : p.statements,
            }
          );
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
        assert.deepEqual(
          f.sent[1]?.[kind === 'anthropic' ? 'messages' : 'contents'],
          nativeFollowup(kind),
        );
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
        assert.deepEqual(
          f.sent[3]?.[kind === 'anthropic' ? 'messages' : 'contents'],
          nativeFollowup(kind),
        );
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

function nativeFollowup(kind: 'anthropic' | 'google') {
  return [
    ...nativeExpected(kind),
    ...(kind === 'anthropic'
      ? [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'call', name: 'lookup', input: {} }],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'call', content: 'private result' }],
          },
        ]
      : [
          { role: 'model', parts: [{ functionCall: { id: 'call', name: 'lookup', args: {} } }] },
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  id: 'call',
                  name: 'lookup',
                  response: { output: 'private result' },
                },
              },
            ],
          },
        ]),
  ];
}

for (const kind of ['anthropic', 'google'] as const)
  test(`${kind}: actual SDK image stream abort cancels native body and preserves possibly-billed accounting`, {
    timeout: 5000,
  }, async () => {
    const f = imageFixture(kind, { stream: true });
    let interrupted: (() => void) | undefined;
    const done = new Promise<void>((resolve) => {
      interrupted = resolve;
    });
    let cancelled = false;
    const invoker = createRegisteredDirectTextStreamInvoker({
      registrations: [
        { providerId: 'provider', kind, credentialRef: 'secret/reference', maxOutputTokens: 128 },
      ],
      resolveSecret: async () => 'fixture-provider-key',
      fetcher: async (url, init) => {
        assert.equal(
          String(url),
          kind === 'anthropic'
            ? 'https://api.anthropic.com/v1/messages'
            : 'https://generativelanguage.googleapis.com/v1beta/models/upstream-model:streamGenerateContent?alt=sse',
        );
        const body = JSON.parse(String(init?.body));
        assert.deepEqual(
          body[kind === 'anthropic' ? 'messages' : 'contents'],
          nativeExpected(kind),
        );
        f.sent.push(body);
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  kind === 'anthropic'
                    ? anthropicFrames([anthropicStart('upstream-model')])
                    : googleFrames([
                        googleChunk([{ text: 'reply' }], undefined, undefined, 'upstream-model'),
                      ]),
                ),
              );
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
    });
    const server = createNodeChatServer({
      ...f.ports,
      invokeDirectTextStream: invoker,
      writeAudit: async (event) => {
        f.audits.push(event);
        if (event.kind === 'stream-interrupted') interrupted?.();
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const client = new OpenAI({
        apiKey: 'fixture-proxy-key',
        baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`,
        maxRetries: 0,
      });
      const stream = await client.chat.completions.create({
        model: 'chat',
        messages: imageHistory,
        stream: true,
      });
      const iterator = stream[Symbol.asyncIterator]();
      assert.equal((await iterator.next()).value?.choices[0]?.delta.role, 'assistant');
      stream.controller.abort();
      await done;
      assert.equal(cancelled, true);
      assert.equal(f.records.length, 1);
      assert.equal(f.records[0]?.outcome, 'failed');
      assert.equal(f.records[0]?.possiblyBilled, true);
      imagePrivacy(f);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
