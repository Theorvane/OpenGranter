import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createDirectChatInvoker, type DirectChatPorts } from '../src/providers/direct-chat.ts';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';

const candidate = {
  id: 'one',
  kind: 'managed' as const,
  providerId: 'provider',
  upstreamModelId: 'upstream',
};
const request = { model: 'chat', messages: [{ role: 'user' as const, content: 'Hello' }] };
const bodies = {
  openai: {
    choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
  },
  anthropic: { content: [{ type: 'text', text: 'Hi' }], stop_reason: 'end_turn' },
  google: { candidates: [{ content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' }] },
};

for (const kind of ['openai', 'anthropic', 'google'] as const) {
  test(`${kind} rejects invalid timeouts before credential access`, async () => {
    for (const timeout of [
      0,
      -1,
      1.5,
      2_147_483_648,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '1',
      null,
    ]) {
      let secrets = 0;
      let fetches = 0;
      const invoke = createDirectChatInvoker({
        registrations: [
          { providerId: 'provider', kind, credentialRef: 'fixture-ref', maxOutputTokens: 128 },
        ],
        timeoutMs: timeout as number,
        resolveSecret: async () => {
          secrets++;
          return 'fixture-key';
        },
        fetcher: async () => {
          fetches++;
          return Response.json(bodies[kind]);
        },
      });
      await assert.rejects(invoke(candidate, request), (error: unknown) => {
        assert.ok(error instanceof DirectProviderFailure);
        assert.equal(error.category, 'other');
        assert.equal(error.responseStarted, false);
        assert.equal(error.possiblyBilled, false);
        assert.equal(error.message, 'Direct provider attempt failed');
        return true;
      });
      assert.equal(secrets, 0);
      assert.equal(fetches, 0);
    }
  });
  test(`${kind} accepts default and bounded valid timeouts`, async () => {
    for (const timeout of [undefined, 1, 2_147_483_647]) {
      let fetches = 0;
      const invoke = createDirectChatInvoker({
        registrations: [
          { providerId: 'provider', kind, credentialRef: 'fixture-ref', maxOutputTokens: 128 },
        ],
        ...(timeout === undefined ? {} : { timeoutMs: timeout }),
        resolveSecret: async () => 'fixture-key',
        fetcher: async (_url, init) => {
          fetches++;
          assert.ok(init?.signal instanceof AbortSignal);
          return Response.json(bodies[kind]);
        },
      });
      assert.equal((await invoke(candidate, request)).choices[0].message.content, 'Hi');
      assert.equal(fetches, 1);
    }
  });
}

test('secret lookup cannot replace an already validated direct timeout', async () => {
  const ports: DirectChatPorts & { timeoutMs: number } = {
    registrations: [{ providerId: 'provider', kind: 'openai', credentialRef: 'fixture-ref' }],
    timeoutMs: 30_000,
    resolveSecret: async () => {
      ports.timeoutMs = -1;
      return 'fixture-key';
    },
    fetcher: async () => Response.json(bodies.openai),
  };
  const invoke = createDirectChatInvoker(ports);
  assert.equal((await invoke(candidate, request)).choices[0].message.content, 'Hi');
  await assert.rejects(
    invoke(candidate, request),
    (error: unknown) => error instanceof DirectProviderFailure && !error.possiblyBilled,
  );
});

test('invalid timeout stops gateway fallback without secret, fetch, or billable usage', async () => {
  const selected: string[] = [];
  const audits: unknown[] = [];
  let secrets = 0;
  let fetches = 0;
  let usageWrites = 0;
  const invoke = createDirectChatInvoker({
    registrations: [{ providerId: 'provider', kind: 'openai', credentialRef: 'fixture-ref' }],
    timeoutMs: -1,
    resolveSecret: async () => {
      secrets++;
      return 'fixture-key';
    },
    fetcher: async () => {
      fetches++;
      return Response.json(bodies.openai);
    },
  });
  const handler = createChatHandler({
    newRequestId: () => 'invalid-timeout',
    authenticate: async () => ({
      id: 'user',
      active: true,
      credentialId: 'credential',
      policyVersions: [],
      statements: [{ effect: 'Allow', actions: ['llm:*'], resources: ['*'] }],
    }),
    resolveRoute: async () => ({
      version: 'v1',
      candidates: [candidate, { ...candidate, id: 'fallback' }],
    }),
    checkLimit: async () => true,
    resolveSecret: async () => {
      throw new Error('unexpected gateway secret');
    },
    invokeDirect: async (selectedCandidate, chat) => {
      selected.push(selectedCandidate.id);
      return invoke(selectedCandidate, chat);
    },
    writeUsage: async () => {
      usageWrites++;
    },
    writeAudit: async (event) => {
      audits.push(event);
    },
  });
  const response = await handler(
    new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' },
      body: JSON.stringify(request),
    }),
  );
  assert.equal(response.status, 502);
  assert.deepEqual(selected, ['one']);
  assert.equal(secrets, 0);
  assert.equal(fetches, 0);
  assert.equal(usageWrites, 0);
  assert.equal(JSON.stringify(audits).includes('"possiblyBilled":false'), true);
  assert.equal(JSON.stringify(audits).includes('fixture-key'), false);
});
