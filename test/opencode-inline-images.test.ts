import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { openCodeGatewayFixture } from '../scripts/opencode-gateway-fixture.ts';
import {
  OPENCODE_IMAGE_BASE64,
  OPENCODE_IMAGE_URL,
  openCodeImageCount,
} from '../scripts/opencode-image-fixture.ts';
import { openCodeNativeHasResult } from '../scripts/opencode-native-fixture.ts';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';

const messages = [
  {
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: OPENCODE_IMAGE_URL } },
      { type: 'text', text: 'private fixture image prompt' },
    ],
  },
];
const tools = [
  {
    type: 'function',
    function: {
      name: 'read',
      parameters: {
        type: 'object',
        properties: { filePath: { type: 'string' } },
        required: ['filePath'],
      },
    },
  },
];
function returnedCall(wire: string) {
  let id = '',
    name = '',
    args = '';
  for (const frame of wire.split('\n\n')) {
    if (!frame.startsWith('data: ') || frame.includes('[DONE]')) continue;
    const chunk = JSON.parse(frame.slice(6));
    for (const choice of chunk.choices)
      for (const call of choice.delta.tool_calls ?? []) {
        assert.equal(call.index, 0);
        id = call.id ?? id;
        name = call.function?.name ?? name;
        args += call.function?.arguments ?? '';
      }
  }
  assert.equal(id, 'call_read');
  assert.equal(name, 'read');
  assert.equal(args, '{"filePath":"fixture.txt"}');
  return { id, type: 'function', function: { name, arguments: args } };
}
const registrations = [
  { routeKind: 'delegated', provider: 'openai' },
  { routeKind: 'managed', provider: 'openai' },
  { routeKind: 'managed', provider: 'anthropic' },
  { routeKind: 'managed', provider: 'google' },
] as const;
for (const { routeKind, provider } of registrations)
  for (const base of ['/v1', '/api/v1'])
    for (const mode of [
      'text',
      'tools',
      'model-deny',
      'provider-deny',
      'cancel',
      'followup-deny',
    ] as const)
      test(`OpenCode image fixture ${routeKind}/${provider} ${base}: ${mode}`, async () => {
        const f = openCodeGatewayFixture(mode, routeKind, provider);
        const server = createNodeChatServer(f.ports);
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', resolve);
        });
        try {
          const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${base}/chat/completions`;
          const send = (history: object[]) =>
            fetch(url, {
              method: 'POST',
              headers: {
                authorization: 'Bearer fixture-proxy-token',
                'x-session-id': 'private client session',
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                model: 'chat',
                messages: history,
                stream: true,
                stream_options: { include_usage: true },
                ...(['tools', 'followup-deny'].includes(mode)
                  ? { tools, tool_choice: 'auto' }
                  : {}),
              }),
            });
          const first = await send(messages);
          if (mode === 'model-deny' || mode === 'provider-deny') {
            assert.equal(first.status, 403);
            await first.text();
            assert.equal(f.sent.length, 0);
            assert.equal(f.counts().secrets, 0);
            assert.equal(f.counts().limits, 0);
            assert.equal(f.usage.length, 0);
            assert.ok(
              f.audit.some(
                (event) =>
                  (event as { kind: string }).kind ===
                  (routeKind === 'delegated' ? 'delegated-denied' : 'denied'),
              ),
            );
          } else {
            assert.equal(first.status, 200);
            if (mode === 'cancel') {
              const reader = first.body?.getReader();
              assert.ok(reader);
              await reader.read();
              await reader.cancel();
              for (let i = 0; i < 200 && !f.usage.length; i++)
                await new Promise((resolve) => setTimeout(resolve, 10));
              assert.equal(f.counts().aborted, true);
              assert.equal(f.usage[0]?.outcome, 'failed');
              assert.equal(f.usage[0]?.possiblyBilled, true);
              assert.equal(f.usage[0]?.usage.status, 'missing');
            } else {
              const wire = await first.text();
              if (mode === 'text') assert.ok(wire.includes('fixture-final-answer'));
              else {
                const call = returnedCall(wire);
                const next = await send([
                  ...messages,
                  { role: 'assistant', content: null, tool_calls: [call] },
                  { role: 'tool', tool_call_id: 'call_read', content: 'fixture-tool-result' },
                ]);
                assert.equal(next.status, mode === 'followup-deny' ? 403 : 200);
                const text = await next.text();
                if (mode === 'tools') {
                  assert.ok(text.includes('fixture-final-answer'));
                  assert.ok(
                    openCodeNativeHasResult(f.sent[1] as Record<string, unknown>, provider),
                  );
                } else {
                  assert.equal(f.sent.length, 1);
                  assert.ok(
                    f.audit.some(
                      (event) =>
                        (event as { kind: string }).kind ===
                        (routeKind === 'delegated' ? 'delegated-denied' : 'denied'),
                    ),
                  );
                }
              }
              assert.ok(
                f.usage.every(
                  (record) => record.outcome === 'succeeded' && record.usage.totalTokens === 5,
                ),
              );
            }
            assert.deepEqual(
              f.sent.map((body) => openCodeImageCount(body, provider)),
              mode === 'tools' ? [1, 1] : [1],
            );
            for (const body of f.sent) {
              assert.equal(
                body.session_id,
                routeKind === 'delegated' ? 'private client session' : undefined,
              );
              if (routeKind === 'managed') assert.equal(Object.hasOwn(body, 'session_id'), false);
            }
            assert.equal(f.counts().secrets, f.sent.length);
            assert.equal(f.counts().limits, f.sent.length);
            assert.equal(f.usage.length, f.sent.length);
          }
          assert.equal(
            f.counts().authenticated,
            mode === 'tools' || mode === 'followup-deny' ? 2 : 1,
          );
          assert.ok(f.usage.every((record) => record.routeKind === routeKind));
          if (routeKind === 'managed')
            assert.ok(f.usage.every((record) => record.actualInferenceProviderId === provider));
          const metadata = JSON.stringify({ audit: f.audit, usage: f.usage });
          for (const value of [
            OPENCODE_IMAGE_BASE64,
            'private fixture image prompt',
            'private client session',
            'fixture-tool-result',
            'fixture.png',
            'fixture.txt',
            'fixture-upstream-key',
            'fixture-proxy-token',
            'fixture-final-answer',
          ])
            assert.ok(!metadata.includes(value));
        } finally {
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        }
      });
for (const provider of ['openai', 'anthropic', 'google'] as const) {
  const part =
    provider === 'openai'
      ? { type: 'image_url', image_url: { url: OPENCODE_IMAGE_URL } }
      : provider === 'anthropic'
        ? {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: OPENCODE_IMAGE_BASE64 },
          }
        : { inlineData: { mimeType: 'image/png', data: OPENCODE_IMAGE_BASE64 } };
  const body = (value: object) =>
    provider === 'google'
      ? { contents: [{ role: 'user', parts: [value] }] }
      : { messages: [{ role: 'user', content: [value] }] };
  test(`OpenCode ${provider} image assertion detects changed bytes`, () => {
    assert.equal(openCodeImageCount(body(part), provider), 1);
    const altered = JSON.parse(JSON.stringify(part).replace(OPENCODE_IMAGE_BASE64, 'AQ=='));
    assert.throws(() => openCodeImageCount(body(altered), provider));
  });
  test(`OpenCode ${provider} image assertion detects extra detail instead of claiming preservation`, () => {
    assert.throws(() => openCodeImageCount(body({ ...part, detail: 'auto' }), provider));
  });
  test(`OpenCode ${provider} image assertion observes a dropped image as zero`, () => {
    assert.equal(openCodeImageCount(body({ type: 'text', text: 'auxiliary' }), provider), 0);
  });
}
