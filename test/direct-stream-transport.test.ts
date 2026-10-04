import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatRequest } from '../src/gateway/chat-handler.ts';
import type { DirectChatPorts } from '../src/providers/direct-chat.ts';
import * as direct from '../src/providers/direct-chat.ts';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';

const registration = {
  providerId: 'openai',
  kind: 'openai' as const,
  credentialRef: 'secret/openai',
  maxOutputTokens: 50,
};
const candidate = () => ({
  id: 'candidate',
  kind: 'managed' as const,
  providerId: 'openai',
  upstreamModelId: 'gpt-exact',
});
const request = () => ({
  model: 'chat',
  messages: [{ role: 'user' as const, content: 'private prompt' }],
  max_tokens: 100,
  temperature: 0.2,
});
const completion = {
  id: 'gen',
  created: 42,
  choices: [
    { index: 0, message: { role: 'assistant', content: 'private answer' }, finish_reason: 'stop' },
  ],
};
test('direct invocation captures approved upstream and client aliases before secret await', async () => {
  const c = candidate(),
    r = request();
  let body: Record<string, unknown> | undefined;
  const invoke = direct.createDirectChatInvoker({
    registrations: [registration],
    resolveSecret: async () => {
      c.upstreamModelId = 'unapproved';
      r.model = 'changed';
      return 'private-key';
    },
    fetcher: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json(completion);
    },
  });
  const result = await invoke(c, r);
  assert.equal(body?.model, 'gpt-exact');
  assert.equal(result.model, 'chat');
});
test('text transport captures native controls and requests final usage before secrets', async () => {
  const c = candidate(),
    r = request();
  let sent: Record<string, unknown> | undefined;
  const ports: DirectChatPorts = {
    registrations: [registration],
    resolveSecret: async () => {
      c.upstreamModelId = 'changed';
      r.messages[0] = { role: 'user', content: 'changed' };
      return 'private-key';
    },
    fetcher: async (url, init) => {
      assert.equal(String(url), 'https://api.openai.com/v1/chat/completions');
      assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer private-key');
      sent = JSON.parse(String(init?.body));
      return new Response('fixture', { headers: { 'content-type': 'text/event-stream' } });
    },
  };
  assert.equal(typeof direct.createDirectChatTransport, 'function');
  const result = await direct.createDirectChatTransport(ports)(c, r, true);
  assert.deepEqual(sent, {
    model: 'gpt-exact',
    messages: [{ role: 'user', content: 'private prompt' }],
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 50,
    temperature: 0.2,
  });
  assert.equal(result.clientModelAlias, 'chat');
  assert.equal(result.candidate.upstreamModelId, 'gpt-exact');
  assert.ok(Object.isFrozen(result.candidate));
  await result.response.body?.cancel();
});
for (const kind of ['anthropic', 'google'] as const)
  test(`text transport rejects ${kind} before secrets`, async () => {
    let secrets = 0;
    const transport = direct.createDirectChatTransport({
      registrations: [{ ...registration, kind }],
      resolveSecret: async () => {
        secrets++;
        return 'key';
      },
    });
    await assert.rejects(transport(candidate(), request(), true), DirectProviderFailure);
    assert.equal(secrets, 0);
  });
for (const extra of [
  { tools: [] },
  { tool_choice: 'none' },
  { parallel_tool_calls: false },
  { min_p: 0.1 },
  { stream_options: { extra: true } },
])
  test(`unsupported stream request ${Object.keys(extra)[0]} stops before credentials`, async () => {
    let secrets = 0;
    const transport = direct.createDirectChatTransport({
      registrations: [registration],
      resolveSecret: async () => {
        secrets++;
        return 'key';
      },
    });
    await assert.rejects(
      transport(candidate(), { ...request(), ...extra } as ChatRequest, true),
      DirectProviderFailure,
    );
    assert.equal(secrets, 0);
  });
test('cancelled secret lookup cannot delay transport failure or start fetch', async () => {
  const controller = new AbortController();
  let fetched = 0;
  const invoke = direct.createDirectChatTransport({
    registrations: [registration],
    resolveSecret: async () => {
      controller.abort();
      return new Promise(() => {});
    },
    fetcher: async () => {
      fetched++;
      return Response.json(completion);
    },
  });
  await assert.rejects(
    invoke(candidate(), request(), true, controller.signal),
    DirectProviderFailure,
  );
  assert.equal(fetched, 0);
});
test('native transport failure is content-free and possibly billed without retry', async () => {
  let fetched = 0;
  const invoke = direct.createDirectChatTransport({
    registrations: [registration],
    resolveSecret: async () => 'key',
    fetcher: async () => {
      fetched++;
      throw Error('private-key private prompt');
    },
  });
  await assert.rejects(
    invoke(candidate(), request(), true),
    (error: unknown) =>
      error instanceof DirectProviderFailure &&
      error.possiblyBilled &&
      !error.responseStarted &&
      !error.message.includes('private'),
  );
  assert.equal(fetched, 1);
});
test('pre-aborted transport does not look up credentials', async () => {
  const controller = new AbortController();
  controller.abort('private reason');
  let secrets = 0;
  const invoke = direct.createDirectChatTransport({
    registrations: [registration],
    resolveSecret: async () => {
      secrets++;
      return 'key';
    },
  });
  await assert.rejects(
    invoke(candidate(), request(), true, controller.signal),
    DirectProviderFailure,
  );
  assert.equal(secrets, 0);
});
test('uncooperative fetch is interrupted and its late response is cancelled', async () => {
  const controller = new AbortController();
  let release!: (response: Response) => void;
  let cancelled = false;
  const invoke = direct.createDirectChatTransport({
    registrations: [registration],
    resolveSecret: async () => 'key',
    fetcher: async () => {
      controller.abort();
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  await assert.rejects(
    invoke(candidate(), request(), true, controller.signal),
    DirectProviderFailure,
  );
  release(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelled, true);
});
test('nonstream response normalization uses the same registration snapshot as its transport', async () => {
  let reads = 0;
  const ports: DirectChatPorts = {
    get registrations(): DirectChatPorts['registrations'] {
      reads++;
      return [{ ...registration, kind: reads === 1 ? 'openai' : 'google' }];
    },
    resolveSecret: async () => 'key',
    fetcher: async () => Response.json(completion),
  };
  const result = await direct.createDirectChatInvoker(ports)(candidate(), request());
  assert.equal(result.choices[0].message.content, 'private answer');
  assert.equal(reads, 1);
});
