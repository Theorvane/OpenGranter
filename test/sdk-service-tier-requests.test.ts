import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import { clientUserFixture, clientUserPrivacy } from './client-user-fixture.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';

for (const kind of ['openai', 'openrouter'] as const)
  for (const base of ['/v1', '/api/v1'])
    for (const stream of [false, true])
      for (const mode of ['text', 'refusal', 'function'] as const)
        test(`${kind} ${base} ${mode} stream=${stream}: installed SDKs carry supported tiers and null omission`, async () => {
          const f = clientUserFixture(kind, { stream, mode });
          const server = createNodeChatServer(f.ports);
          await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
          try {
            const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${base}`;
            const raw = new OpenAI({
              apiKey: 'fixture-proxy-key',
              baseURL: url,
              maxRetries: 0,
              timeout: 3000,
            });
            const compatible = new OpenRouter({
              apiKey: 'fixture-proxy-key',
              serverURL: url,
              retryConfig: { strategy: 'none' },
              timeoutMs: 3000,
            });
            for (const tier of (kind === 'openai'
              ? ['default', 'fast', null]
              : ['default', null]) as readonly ('default' | 'fast' | null)[]) {
              const fields = {
                model: 'chat',
                messages: [{ role: 'user' as const, content: 'private prompt' }],
                stream,
                ...(mode === 'function' ? { tools: probabilityTools } : {}),
              };
              const response = await raw.chat.completions.create({ ...fields, service_tier: tier });
              if (Symbol.asyncIterator in response) {
                for await (const _chunk of response) {
                }
              } else assert.equal(response.choices[0]?.message.role, 'assistant');
              const other = await compatible.chat.send({
                chatRequest: { ...fields, serviceTier: tier },
              });
              if (Symbol.asyncIterator in other) {
                for await (const _chunk of other) {
                }
              } else assert.ok('choices' in other);
              for (const body of f.sent.slice(-2)) {
                assert.equal(body.service_tier, tier ?? undefined);
                assert.equal(Object.hasOwn(body, 'service_tier'), tier !== null);
                assert.equal(body.model, 'upstream-model');
                if (kind === 'openrouter') assert.deepEqual(body.provider, { only: ['provider'] });
              }
            }
            assert.equal(f.sent.length, kind === 'openai' ? 6 : 4);
            assert.equal(f.records.length, f.sent.length);
            clientUserPrivacy(f);
            assert.doesNotMatch(JSON.stringify([f.records, f.audits]), /service_tier|serviceTier/u);
          } finally {
            server.closeAllConnections();
            await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
          }
        });
for (const kind of ['openai', 'openrouter'] as const)
  for (const base of ['/v1', '/api/v1'])
    for (const stream of [false, true])
      test(`${kind} ${base} stream=${stream}: installed SDK requests cannot enable unsupported tiers`, async () => {
        const f = clientUserFixture(kind, { stream });
        const server = createNodeChatServer(f.ports);
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        try {
          const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${base}`;
          const tier = kind === 'openai' ? 'ultrafast' : 'priority';
          // Exercise the gateway's raw extension boundary beyond OpenAI's static enum.
          const extension: Record<string, unknown> = { service_tier: tier };
          const raw = new OpenAI({
            apiKey: 'fixture-proxy-key',
            baseURL: url,
            maxRetries: 0,
            timeout: 3000,
          });
          const compatible = new OpenRouter({
            apiKey: 'fixture-proxy-key',
            serverURL: url,
            retryConfig: { strategy: 'none' },
            timeoutMs: 3000,
          });
          const fields = {
            model: 'chat',
            messages: [{ role: 'user' as const, content: 'private prompt' }],
            stream,
          };
          await assert.rejects(
            () => raw.chat.completions.create({ ...fields, ...extension }),
            (e: unknown) => {
              assert.ok(e instanceof OpenAI.APIError);
              assert.doesNotMatch(e.message, /private|fixture-.*key/u);
              return true;
            },
          );
          await assert.rejects(() =>
            compatible.chat.send({ chatRequest: { ...fields, serviceTier: tier } }),
          );
          assert.equal(f.counts().secrets, 0);
          assert.equal(f.sent.length, 0);
          clientUserPrivacy(f);
        } finally {
          server.closeAllConnections();
          await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
        }
      });
