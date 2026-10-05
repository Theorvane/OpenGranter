import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';
import { sessionFixture, sessionPrivacy, suppliedSession } from './session-identifiers-fixture.ts';

const sources = [
  { name: 'body', id: suppliedSession, header: undefined, expected: suppliedSession },
  {
    name: 'Unicode maxLength body',
    id: '😀'.repeat(256),
    header: undefined,
    expected: '😀'.repeat(256),
  },
  {
    name: 'header',
    id: undefined,
    header: 'private supplied session header',
    expected: 'private supplied session header',
  },
  { name: 'empty header', id: undefined, header: '', expected: '' },
  {
    name: 'body wins invalid header',
    id: 'private supplied session body',
    header: 'x'.repeat(257),
    expected: 'private supplied session body',
  },
];
for (const base of ['/v1', '/api/v1'])
  for (const stream of [false, true])
    for (const mode of ['text', 'refusal', 'function'] as const)
      for (const source of sources)
        test(`${base} ${mode} stream=${stream}: ${source.name} passes both installed SDK sockets`, async () => {
          const f = sessionFixture('openrouter', { stream, mode });
          const server = createNodeChatServer(f.ports);
          await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
          try {
            const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${base}`;
            const headers = source.header === undefined ? {} : { 'x-session-id': source.header };
            const raw = new OpenAI({
              apiKey: 'fixture-proxy-key',
              baseURL: url,
              maxRetries: 0,
              timeout: 3000,
              defaultHeaders: headers,
            });
            const controls = {
              model: 'chat',
              messages: [{ role: 'user' as const, content: 'private prompt' }],
              stream,
              ...(mode === 'function' ? { tools: probabilityTools } : {}),
            };
            const result = await raw.chat.completions.create({
              ...controls,
              ...(source.id === undefined ? {} : { session_id: source.id }),
            });
            if (Symbol.asyncIterator in result) {
              const chunks = [];
              for await (const c of result) chunks.push(c);
              assert.ok(chunks.length >= 2);
              assert.doesNotMatch(JSON.stringify(chunks), /supplied session/u);
            } else assert.equal(result.choices[0]?.message.role, 'assistant');
            const client = new OpenRouter({
              apiKey: 'fixture-proxy-key',
              serverURL: url,
              retryConfig: { strategy: 'none' },
              timeoutMs: 3000,
            });
            const compatible = await client.chat.send(
              {
                chatRequest: {
                  ...controls,
                  ...(source.id === undefined ? {} : { sessionId: source.id }),
                },
              },
              { headers },
            );
            if (Symbol.asyncIterator in compatible) {
              const chunks = [];
              for await (const c of compatible) chunks.push(c);
              assert.ok(chunks.length >= 2);
              assert.doesNotMatch(JSON.stringify(chunks), /supplied session/u);
            } else assert.ok('choices' in compatible);
            assert.equal(f.sent.length, 2);
            for (const body of f.sent) {
              assert.equal(body.session_id, source.expected);
              assert.deepEqual(body.provider, { only: ['provider'] });
              assert.equal(body.model, 'upstream-model');
            }
            assert.equal(f.records.length, 2);
            sessionPrivacy(f);
          } finally {
            server.closeAllConnections();
            await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
          }
        });
test('Node request bridge preserves present empty headers rather than treating them as absent', async () => {
  const server = createNodeRequestServer(async (r) =>
    Response.json({ present: r.headers.has('x-session-id'), value: r.headers.get('x-session-id') }),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/chat/completions`;
    const r = await fetch(url, { method: 'POST', headers: { 'x-session-id': '' }, body: '{}' });
    assert.deepEqual(await r.json(), { present: true, value: '' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
});
for (const base of ['/v1', '/api/v1'])
  for (const source of ['body', 'header'] as const)
    for (const stream of [false, true])
      test(`${base} stream=${stream}: overlong selected ${source} identifiers are rejected by the gateway through both SDK sockets`, async () => {
        const f = sessionFixture('openrouter', { stream });
        const server = createNodeChatServer(f.ports);
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        try {
          const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${base}`;
          const id = 'private'.repeat(40);
          const headers = source === 'header' ? { 'x-session-id': id } : {};
          const raw = new OpenAI({
            apiKey: 'fixture-proxy-key',
            baseURL: url,
            maxRetries: 0,
            timeout: 3000,
            defaultHeaders: headers,
          });
          await assert.rejects(
            () =>
              raw.chat.completions.create({
                model: 'chat',
                messages: [{ role: 'user', content: 'private prompt' }],
                stream,
                ...(source === 'body' ? { session_id: id } : {}),
              }),
            (e: unknown) => {
              assert.ok(e instanceof OpenAI.APIError);
              assert.equal(e.status, 400);
              assert.doesNotMatch(e.message, /private|supplied session/u);
              return true;
            },
          );
          const client = new OpenRouter({
            apiKey: 'fixture-proxy-key',
            serverURL: url,
            retryConfig: { strategy: 'none' },
            timeoutMs: 3000,
          });
          await assert.rejects(() =>
            client.chat.send(
              {
                chatRequest: {
                  model: 'chat',
                  messages: [{ role: 'user', content: 'private prompt' }],
                  stream,
                  ...(source === 'body' ? { sessionId: id } : {}),
                },
              },
              { headers },
            ),
          );
          assert.deepEqual(f.counts(), { secrets: 0, routes: 0 });
          assert.equal(f.sent.length, 0);
          sessionPrivacy(f);
        } finally {
          server.closeAllConnections();
          await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
        }
      });
