import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';

test('Node server accepts a socket request and returns the Jev-managed completion', async () => {
  const server = createNodeChatServer({
    newRequestId: () => 'socket-1',
    authenticate: async (token) =>
      token === 'proxy-key'
        ? {
            id: 'user-1',
            active: true,
            credentialId: 'credential-1',
            policyVersions: [{ id: 'policy-1', version: 'v1' }],
            statements: [
              { effect: 'Allow', actions: ['llm:InvokeModel'], resources: ['model:chat'] },
              { effect: 'Allow', actions: ['llm:UseProvider'], resources: ['provider:openai'] },
            ],
          }
        : undefined,
    resolveRoute: async () => ({
      version: 'v1',
      candidates: [{ id: 'openai', kind: 'managed', upstreamModelId: 'gpt', providerId: 'openai' }],
      jev: { credentialRef: 'jev-ref', minimumConfidence: 0.6, sendPrompt: false },
    }),
    listPublishedModels: async () => [
      {
        alias: 'chat',
        created: 100,
        enabled: true,
        routes: [
          {
            kind: 'managed',
            candidates: [
              { id: 'openai', kind: 'managed', upstreamModelId: 'gpt', providerId: 'openai' },
            ],
          },
        ],
      },
    ],
    checkLimit: async () => true,
    resolveSecret: async () => 'jev-key',
    writeAudit: async () => {},
    invokeDirect: async () => ({
      id: 'completion-1',
      object: 'chat.completion',
      model: 'chat',
      choices: [],
    }),
    fetchJev: async () => ({
      ok: true,
      json: async () => ({
        model: 'jev-1',
        answers: { route: { type: 'choice', choice: 'openai', confidence: 0.9 } },
      }),
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer proxy-key', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'chat', messages: [{ role: 'user', content: 'Hello' }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-request-id'), 'socket-1');
    assert.equal(((await response.json()) as { id: string }).id, 'completion-1');
    const models = await fetch(`http://127.0.0.1:${address.port}/v1/models`, {
      headers: { authorization: 'Bearer proxy-key' },
    });
    assert.equal(models.status, 200);
    assert.deepEqual(await models.json(), {
      object: 'list',
      data: [{ id: 'chat', object: 'model', created: 100, owned_by: 'opengranter' }],
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
