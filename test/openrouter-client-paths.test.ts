import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { type ChatHandlerPorts, createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';

function fixture(
  options: {
    delegated?: boolean;
    authenticated?: boolean;
    denied?: boolean;
    limited?: boolean;
    auditFails?: boolean;
  } = {},
) {
  const events: unknown[] = [];
  const activity: string[] = [];
  const candidate = {
    id: 'candidate',
    kind: options.delegated ? ('delegated' as const) : ('managed' as const),
    providerId: 'provider',
    upstreamModelId: 'upstream/model',
  };
  const completion = {
    id: 'completion',
    object: 'chat.completion',
    created: 1,
    model: 'published/model',
    choices: [
      { index: 0, message: { role: 'assistant', content: 'fixture reply' }, finish_reason: 'stop' },
    ],
  };
  const ports: ChatHandlerPorts<typeof completion> = {
    newRequestId: () => 'request',
    authenticate: async (token) => {
      activity.push('authenticate');
      assert.equal(token, 'proxy-fixture');
      return options.authenticated === false
        ? undefined
        : {
            id: 'user',
            active: true,
            credentialId: 'credential',
            policyVersions: [],
            statements: options.denied
              ? []
              : [{ effect: 'Allow', actions: ['*'], resources: ['*'] }],
          };
    },
    resolveRoute: async () => {
      activity.push('route');
      return options.delegated
        ? {
            kind: 'delegated',
            version: 'v1',
            credentialRef: 'secret/upstream',
            candidates: [candidate],
          }
        : { version: 'v1', candidates: [candidate] };
    },
    listPublishedModels: async () => {
      activity.push('catalog');
      return [
        {
          alias: 'published/model',
          created: 1,
          enabled: true,
          routes: [{ kind: candidate.kind, candidates: [candidate] }],
        },
      ];
    },
    checkLimit: async () => {
      activity.push('limit');
      return !options.limited;
    },
    resolveSecret: async () => {
      activity.push('secret');
      return 'fixture';
    },
    writeAudit: async (event) => {
      if (options.auditFails) throw new Error('private audit fixture');
      events.push(event);
    },
    writeUsage: async () => {
      activity.push('usage');
    },
    invokeDirect: async (_, body) => {
      activity.push('direct');
      assert.equal(body.model, 'published/model');
      return completion;
    },
    resolveVerifiedProviderSlug: async () => {
      activity.push('mapping');
      return 'provider';
    },
    invokeOpenRouter: async (ref, attempt, body) => {
      activity.push('delegated');
      assert.equal(ref, 'secret/upstream');
      assert.equal(attempt.upstreamModelId, 'upstream/model');
      assert.deepEqual(attempt.authorizedProviderSlugs, ['provider']);
      assert.equal(body.model, 'published/model');
      return completion;
    },
  };
  return { ports, events, activity, completion };
}
function clientRequest(path: string, method = path.endsWith('/models') ? 'GET' : 'POST') {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      authorization: 'Bearer proxy-fixture',
      'content-type': 'application/json',
      'HTTP-Referer': 'https://client.example',
      'X-OpenRouter-Title': 'Fixture client',
    },
    ...(method === 'POST'
      ? {
          body: JSON.stringify({
            model: 'published/model',
            messages: [{ role: 'user', content: 'fixture' }],
            stream: false,
          }),
        }
      : {}),
  });
}
for (const delegated of [false, true]) {
  test(`${delegated ? 'delegated' : 'managed'} chat agrees across OpenRouter and existing paths`, async () => {
    const expected = fixture({ delegated });
    const alias = fixture({ delegated });
    const baseline = await createChatHandler(expected.ports)(clientRequest('/v1/chat/completions'));
    const response = await createChatHandler(alias.ports)(
      clientRequest('/api/v1/chat/completions'),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-request-id'), 'request');
    assert.deepEqual(await response.json(), await baseline.json());
    assert.deepEqual(alias.activity, expected.activity);
    assert.deepEqual(alias.events, expected.events);
  });
}
for (const denied of [false, true]) {
  test(`model discovery shares IAM filtering (denied=${denied})`, async () => {
    const f = fixture({ denied });
    const response = await createChatHandler(f.ports)(clientRequest('/api/v1/models'));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      object: 'list',
      data: denied
        ? []
        : [{ id: 'published/model', object: 'model', created: 1, owned_by: 'opengranter' }],
    });
    assert.deepEqual(f.activity, ['authenticate', 'catalog']);
  });
}
for (const [options, status, code, message] of [
  [{ authenticated: false }, 401, 'unauthorized', 'Authentication is required.'],
  [{ denied: true }, 403, 'forbidden', 'Access is denied.'],
  [{ limited: true }, 429, 'limit_exceeded', 'Request limit exceeded.'],
  [
    { auditFails: true },
    503,
    'audit_unavailable',
    'Required audit recording is temporarily unavailable.',
  ],
] as const) {
  test(`OpenRouter chat path preserves ${code} and stops inference`, async () => {
    const f = fixture(options);
    const response = await createChatHandler(f.ports)(clientRequest('/api/v1/chat/completions'));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), {
      error: { code: status, message, metadata: { opengranter_code: code } },
      request_id: 'request',
    });
    assert.equal(f.activity.includes('direct'), false);
    assert.equal(f.activity.includes('delegated'), false);
    assert.equal(f.activity.includes('usage'), false);
  });
}

test('exact dispatch rejects near misses, wrong methods and unrelated OpenRouter endpoints', async () => {
  for (const [path, method] of [
    ['/api/v1/models', 'POST'],
    ['/api/v1/chat/completions', 'GET'],
    ['/api/v1/models/', 'GET'],
    ['/api/v1/chat/completions-extra', 'POST'],
    ['/api/v1/usage', 'GET'],
    ['/api/v1/audit', 'GET'],
    ['/api/v1/credits', 'GET'],
  ]) {
    const f = fixture();
    assert.equal((await createChatHandler(f.ports)(clientRequest(path!, method!))).status, 404);
    assert.deepEqual(f.activity, []);
  }
});

test('external-client /api/v1 base works through the real Node socket', async () => {
  const f = fixture({ delegated: true });
  const server = createNodeChatServer(f.ports);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}/api/v1`;
    const headers = {
      authorization: 'Bearer proxy-fixture',
      'content-type': 'application/json',
      'HTTP-Referer': 'https://client.example',
      'X-OpenRouter-Title': 'Fixture client',
    };
    const models = await fetch(`${base}/models`, { headers });
    assert.equal(models.status, 200);
    assert.equal(
      ((await models.json()) as { data: { id: string }[] }).data[0]?.id,
      'published/model',
    );
    const chat = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'published/model',
        messages: [{ role: 'user', content: 'fixture' }],
        stream: false,
      }),
    });
    assert.equal(chat.status, 200);
    assert.deepEqual(await chat.json(), f.completion);
    assert.equal(f.activity.includes('delegated'), true);
    assert.equal(f.activity.includes('usage'), true);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
