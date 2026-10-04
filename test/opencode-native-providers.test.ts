import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import {
  type OpenCodeFixtureMode,
  openCodeGatewayFixture,
} from '../scripts/opencode-gateway-fixture.ts';
import { openCodeConfig } from '../scripts/opencode-process.ts';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import type { AssistantFunctionCall } from '../src/providers/assistant-response.ts';

const input = {
  model: 'chat',
  stream: true,
  stream_options: { include_usage: true },
  max_tokens: 2000,
  messages: [{ role: 'user', content: 'fixture prompt' }],
  tools: [
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
  ],
  tool_choice: 'auto',
};
type Provider = 'openai' | 'anthropic' | 'google';
async function socket(
  mode: OpenCodeFixtureMode,
  provider: Provider,
  base: string,
  run: (
    f: ReturnType<typeof openCodeGatewayFixture>,
    send: (body: object) => Promise<Response>,
  ) => Promise<void>,
) {
  const f = openCodeGatewayFixture(mode, 'managed', provider);
  const server = createNodeChatServer(f.ports);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(f, (body) =>
      fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${base}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer fixture-proxy-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
    );
    assert.ok(
      f.usage.every((r) => r.routeKind === 'managed' && r.actualInferenceProviderId === provider),
    );
    assert.doesNotMatch(
      JSON.stringify({ audit: f.audit, usage: f.usage }),
      /fixture prompt|fixture-tool-result|fixture.txt|fixture-partial|fixture-signature|fixture-upstream-key|fixture-proxy-token/u,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}
function calls(wire: string): AssistantFunctionCall[] {
  const result = new Map<number, AssistantFunctionCall>();
  for (const frame of wire.split('\n\n')) {
    if (!frame.startsWith('data: ') || frame.includes('[DONE]')) continue;
    const chunk = JSON.parse(frame.slice(6));
    for (const choice of chunk.choices)
      for (const part of choice.delta.tool_calls ?? []) {
        const previous = result.get(part.index);
        result.set(part.index, {
          id: part.id ?? previous?.id,
          type: 'function',
          function: {
            name: part.function?.name ?? previous?.function.name,
            arguments: (previous?.function.arguments ?? '') + (part.function?.arguments ?? ''),
          },
          ...(part.extra_content === undefined
            ? previous?.extra_content === undefined
              ? {}
              : { extra_content: previous.extra_content }
            : { extra_content: part.extra_content }),
        });
      }
  }
  return [...result.values()];
}
const followup = (returned: AssistantFunctionCall[]) => ({
  ...input,
  messages: [
    ...input.messages,
    { role: 'assistant', content: null, tool_calls: returned },
    { role: 'tool', tool_call_id: 'call_read', content: 'fixture-tool-result' },
  ],
});
for (const provider of ['openai', 'anthropic', 'google'] as const)
  for (const base of ['/v1', '/api/v1'])
    test(`OpenCode ${provider} ${base} auxiliary text cannot trigger tool follow-up Deny`, () =>
      socket('followup-deny', provider, base, async (f, send) => {
        const { tools: _tools, tool_choice: _choice, ...auxiliary } = input;
        const title = await send(auxiliary);
        assert.equal(title.status, 200);
        assert.ok((await title.text()).includes('fixture-final-answer'));
        const first = await send(input);
        assert.equal(first.status, 200);
        const returned = calls(await first.text());
        assert.equal(returned.length, 1);
        assert.equal((await send(followup(returned))).status, 403);
        assert.equal(f.sent.length, 2);
        assert.equal(f.counts().authenticated, 3);
        assert.equal(f.counts().secrets, 2);
        assert.equal(f.counts().limits, 2);
        assert.equal(f.usage.length, 2);
      }));
test('OpenCode Google signature namespace is explicit and preserves provider/model registration', () => {
  const standard = openCodeConfig('http://127.0.0.1/v1', true);
  assert.equal(Object.hasOwn(standard.provider.opengranter.options, 'name'), false);
  const signed = openCodeConfig('http://127.0.0.1/v1', true, true);
  assert.equal(signed.provider.opengranter.options.name, 'google');
  assert.equal(signed.model, 'opengranter/chat');
  assert.deepEqual(signed.enabled_providers, ['opengranter']);
  assert.equal(
    signed.provider.opengranter.options.baseURL,
    standard.provider.opengranter.options.baseURL,
  );
  assert.equal(
    signed.provider.opengranter.options.apiKey,
    standard.provider.opengranter.options.apiKey,
  );
  assert.deepEqual(signed.permission, standard.permission);
});
for (const provider of ['anthropic', 'google'] as const)
  for (const base of ['/v1', '/api/v1']) {
    test(`OpenCode ${provider} ${base} native text enforces registration shape and cap`, () =>
      socket('text', provider, base, async (f, send) => {
        const response = await send(input);
        assert.equal(response.status, 200);
        const wire = await response.text();
        assert.ok(wire.includes('fixture-final-answer'));
        assert.ok(wire.includes('[DONE]'));
        assert.equal(f.sent.length, 1);
        assert.equal(f.usage[0]?.usage.totalTokens, 5);
        const body = f.sent[0];
        assert.ok(body);
        assert.equal(body.provider, undefined);
        if (provider === 'anthropic') {
          assert.equal(body.model, 'claude-exact');
          assert.equal(body.max_tokens, 1000);
          assert.equal((body.tools as { name: string }[])[0]?.name, 'read');
        } else {
          assert.equal(body.model, undefined);
          assert.equal(body.stream, undefined);
          assert.equal(body.stream_options, undefined);
          assert.equal(
            (body.generationConfig as { maxOutputTokens: number }).maxOutputTokens,
            1000,
          );
          assert.equal(
            (body.tools as { functionDeclarations: { name: string }[] }[])[0]
              ?.functionDeclarations[0]?.name,
            'read',
          );
        }
      }));
    test(`OpenCode ${provider} ${base} complete read calls replay native correlated results`, () =>
      socket('tools', provider, base, async (f, send) => {
        const response = await send(input);
        assert.equal(response.status, 200);
        const returned = calls(await response.text());
        assert.deepEqual(returned, [
          {
            id: 'call_read',
            type: 'function',
            function: { name: 'read', arguments: '{"filePath":"fixture.txt"}' },
          },
        ]);
        const next = await send(followup(returned));
        assert.equal(next.status, 200);
        assert.ok((await next.text()).includes('fixture-final-answer'));
        assert.equal(f.usage.length, 2);
        assert.deepEqual(f.counts(), { authenticated: 2, secrets: 2, limits: 2, aborted: false });
        const history = f.sent[1];
        assert.ok(history);
        if (provider === 'anthropic')
          assert.ok(JSON.stringify(history.messages).includes('"tool_use_id":"call_read"'));
        else
          assert.ok(
            JSON.stringify(history.contents).includes('"functionResponse":{"id":"call_read"'),
          );
      }));
    for (const mode of ['model-deny', 'provider-deny'] as const)
      test(`OpenCode ${provider} ${base} ${mode} precedes limit and keys`, () =>
        socket(mode, provider, base, async (f, send) => {
          assert.equal((await send(input)).status, 403);
          assert.equal(f.sent.length, 0);
          assert.equal(f.counts().secrets, 0);
          assert.equal(f.counts().limits, 0);
          assert.equal(f.usage.length, 0);
        }));
    test(`OpenCode ${provider} ${base} fresh provider Deny prevents result continuation inference`, () =>
      socket('followup-deny', provider, base, async (f, send) => {
        const first = await send(input);
        assert.equal(first.status, 200);
        const returned = calls(await first.text());
        assert.equal(returned.length, 1);
        assert.equal((await send(followup(returned))).status, 403);
        assert.equal(f.sent.length, 1);
        assert.equal(f.counts().secrets, 1);
        assert.equal(f.counts().limits, 1);
        assert.equal(f.usage.length, 1);
      }));
    test(`OpenCode ${provider} ${base} cancelled native response has billed missing usage`, () =>
      socket('cancel', provider, base, async (f, send) => {
        const response = await send(input);
        assert.equal(response.status, 200);
        const reader = response.body?.getReader();
        assert.ok(reader);
        await reader.read();
        await reader.cancel();
        for (let i = 0; i < 200 && !f.usage.length; i++)
          await new Promise((r) => setTimeout(r, 10));
        assert.equal(f.counts().aborted, true);
        assert.equal(f.usage[0]?.outcome, 'failed');
        assert.equal(f.usage[0]?.possiblyBilled, true);
        assert.equal(f.usage[0]?.usage.status, 'missing');
      }));
  }
for (const base of ['/v1', '/api/v1'])
  test(`OpenCode Google ${base} text fixture preserves omitted native generation settings`, () =>
    socket('text', 'google', base, async (f, send) => {
      const response = await send({ model: 'chat', messages: input.messages, stream: true });
      assert.equal(response.status, 200);
      assert.ok((await response.text()).includes('fixture-final-answer'));
      assert.equal(f.sent[0]?.generationConfig, undefined);
    }));
for (const base of ['/v1', '/api/v1'])
  for (const strip of [false, true])
    test(`OpenCode Google fixture ${base} signed wire ${strip ? 'loss fails safely' : 'round trip succeeds'}`, () =>
      socket('signed-tools', 'google', base, async (f, send) => {
        const first = await send(input);
        assert.equal(first.status, 200);
        const returned = calls(await first.text());
        assert.deepEqual(returned[0]?.extra_content, {
          google: { thought_signature: 'fixture-signature+/==' },
        });
        const replay = strip
          ? returned.map(({ extra_content: _extra, ...call }) => call)
          : returned;
        const next = await send(followup(replay));
        assert.equal(next.status, strip ? 502 : 200);
        const wire = await next.text();
        if (!strip) assert.ok(wire.includes('fixture-final-answer'));
        else {
          assert.doesNotMatch(wire, /fixture-signature|private|fixture-upstream-key/u);
          assert.equal(f.usage[1]?.outcome, 'failed');
          assert.equal(f.usage[1]?.possiblyBilled, true);
        }
      }));
