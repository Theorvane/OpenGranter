import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { openCodeGatewayFixture } from '../scripts/opencode-gateway-fixture.ts';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';

const tools = [
  {
    type: 'function',
    function: {
      name: 'read',
      description: 'Read fixture',
      parameters: {
        type: 'object',
        properties: { filePath: { type: 'string' } },
        required: ['filePath'],
      },
    },
  },
];
const input = {
  model: 'chat',
  messages: [{ role: 'user', content: 'fixture prompt' }],
  tools,
  tool_choice: 'auto',
  stream: true,
  stream_options: { include_usage: true },
};
async function socket(
  mode: Parameters<typeof openCodeGatewayFixture>[0],
  base: string,
  routeKind: 'delegated' | 'managed',
  run: (
    fixture: ReturnType<typeof openCodeGatewayFixture>,
    send: (body: object) => Promise<Response>,
  ) => Promise<void>,
) {
  const fixture = openCodeGatewayFixture(mode, routeKind);
  const server = createNodeChatServer(fixture.ports);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    await run(fixture, (body) =>
      fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${base}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer fixture-proxy-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
    );
    if (routeKind === 'managed') {
      assert.ok(fixture.usage.every((record) => record.routeKind === 'managed'));
      assert.ok(
        fixture.sent.every(
          (body) =>
            body.provider === undefined &&
            JSON.stringify(body.stream_options) === '{"include_usage":true}',
        ),
      );
      if (mode === 'model-deny' || mode === 'provider-deny')
        assert.ok(fixture.audit.some((event) => (event as { kind: string }).kind === 'denied'));
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
for (const routeKind of ['delegated', 'managed'] as const)
  for (const base of ['/v1', '/api/v1']) {
    test(`${routeKind} ${base}: fixture emits incremental read calls then accepts correlated result history`, () =>
      socket('tools', base, routeKind, async (f, send) => {
        const response = await send(input);
        assert.equal(response.status, 200);
        const text = await response.text();
        const chunks = text
          .split('\n\n')
          .filter((x) => x.startsWith('data: ') && !x.includes('[DONE]'))
          .map((x) => JSON.parse(x.slice(6)));
        const fragments = chunks.flatMap((c) =>
          c.choices.flatMap(
            (choice: { delta: { tool_calls?: { function?: { arguments?: string } }[] } }) =>
              choice.delta.tool_calls ?? [],
          ),
        );
        assert.equal(fragments.length, 2);
        assert.equal(
          fragments.map((x) => x.function?.arguments ?? '').join(''),
          '{"filePath":"fixture.txt"}',
        );
        const calls = [
          {
            id: 'call_read',
            type: 'function',
            function: { name: 'read', arguments: '{"filePath":"fixture.txt"}' },
          },
        ];
        const follow = await send({
          ...input,
          messages: [
            ...input.messages,
            { role: 'assistant', content: '', tool_calls: calls },
            { role: 'tool', tool_call_id: 'call_read', content: 'fixture-tool-result' },
          ],
        });
        assert.ok((await follow.text()).includes('fixture-final-answer'));
        assert.equal(f.sent.length, 2);
        assert.equal(f.usage.length, 2);
        assert.deepEqual(f.counts(), { authenticated: 2, secrets: 2, limits: 2, aborted: false });
        assert.ok(JSON.stringify(f.sent[1]).includes('fixture-tool-result'));
        assert.ok(
          !JSON.stringify({ audit: f.audit, usage: f.usage }).includes('fixture-tool-result'),
        );
      }));
    for (const mode of ['model-deny', 'provider-deny'] as const)
      test(`${routeKind} ${base}: ${mode} stops before credentials`, () =>
        socket(mode, base, routeKind, async (f, send) => {
          const response = await send(input);
          assert.equal(response.status, 403);
          await response.text();
          assert.equal(f.sent.length, 0);
          assert.equal(f.counts().secrets, 0);
          assert.equal(f.counts().limits, 0);
          assert.equal(f.usage.length, 0);
          assert.ok(f.audit.length > 0);
        }));
    test(`${routeKind} ${base}: fixture records upstream abort when client cancels the hanging response`, () =>
      socket('cancel', base, routeKind, async (f, send) => {
        const response = await send(input);
        assert.equal(response.status, 200);
        const reader = response.body?.getReader();
        assert.ok(reader);
        await reader.read();
        await reader.cancel();
        for (let i = 0; i < 200 && !f.usage.length; i++)
          await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(f.counts().aborted, true);
        assert.equal(f.usage[0]?.outcome, 'failed');
        assert.equal(f.usage[0]?.possiblyBilled, true);
        assert.equal(f.usage[0]?.usage.status, 'missing');
      }));
  }
