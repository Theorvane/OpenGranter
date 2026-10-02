import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatHandler, type PublishedModel } from '../src/gateway/chat-handler.ts';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';

const statements = [
  { effect: 'Allow' as const, actions: ['llm:InvokeModel'], resources: ['model:chat'] },
  { effect: 'Allow' as const, actions: ['llm:UseProvider'], resources: ['provider:openai'] },
  { effect: 'Allow' as const, actions: ['llm:UseProvider'], resources: ['provider:anthropic'] },
];

const route = {
  version: 'v1',
  candidates: [
    { id: 'openai', kind: 'managed' as const, upstreamModelId: 'gpt', providerId: 'openai' },
    {
      id: 'anthropic',
      kind: 'managed' as const,
      upstreamModelId: 'claude',
      providerId: 'anthropic',
    },
  ],
  jev: { credentialRef: 'secret/jev', minimumConfidence: 0.6, sendPrompt: false },
};

function chatRequest(body: unknown, token = 'proxy-token'): Request {
  return new Request('http://localhost/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = { model: 'chat', messages: [{ role: 'user', content: 'Hello' }] };

const attributedPrincipal = {
  id: 'user-1',
  active: true,
  credentialId: 'credential-1',
  policyVersions: [{ id: 'policy-1', version: 'v3' }],
  statements,
};

test('GET models lists only aliases with an IAM-authorized final provider', async () => {
  const audit: unknown[] = [];
  let externalCalls = 0;
  const handler = createChatHandler({
    newRequestId: () => 'req-models',
    authenticate: async () => ({
      ...attributedPrincipal,
      statements: [
        { effect: 'Allow' as const, actions: ['llm:InvokeModel'], resources: ['model:*'] },
        { effect: 'Allow' as const, actions: ['llm:UseProvider'], resources: ['provider:openai'] },
      ],
    }),
    listPublishedModels: async () => [
      {
        alias: 'managed-chat',
        created: 100,
        enabled: true,
        routes: [
          {
            kind: 'managed' as const,
            candidates: [
              { id: 'one', kind: 'managed' as const, upstreamModelId: 'gpt', providerId: 'openai' },
            ],
          },
        ],
      },
      {
        alias: 'delegated-chat',
        created: 200,
        enabled: true,
        routes: [
          {
            kind: 'delegated' as const,
            candidates: [
              {
                id: 'two',
                kind: 'delegated' as const,
                upstreamModelId: 'remote',
                providerId: 'openai',
              },
            ],
          },
        ],
      },
      {
        alias: 'denied-chat',
        created: 300,
        enabled: true,
        routes: [
          {
            kind: 'managed' as const,
            candidates: [
              {
                id: 'three',
                kind: 'managed' as const,
                upstreamModelId: 'secret',
                providerId: 'anthropic',
              },
            ],
          },
        ],
      },
      {
        alias: 'disabled-chat',
        created: 400,
        enabled: false,
        routes: [
          {
            kind: 'managed' as const,
            candidates: [
              {
                id: 'four',
                kind: 'managed' as const,
                upstreamModelId: 'gpt',
                providerId: 'openai',
              },
            ],
          },
        ],
      },
    ],
    resolveRoute: async () => {
      externalCalls++;
      return route;
    },
    checkLimit: async () => {
      externalCalls++;
      return true;
    },
    resolveSecret: async () => {
      externalCalls++;
      return 'key';
    },
    writeUsage: async () => {},
    writeAudit: async (event) => {
      audit.push(event);
    },
    invokeDirect: async () => {
      externalCalls++;
      return {};
    },
    fetchJev: async () => {
      externalCalls++;
      throw new Error('unexpected');
    },
  });
  const response = await handler(
    new Request('http://localhost/v1/models', { headers: { authorization: 'Bearer proxy-token' } }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    object: 'list',
    data: [
      { id: 'managed-chat', object: 'model', created: 100, owned_by: 'opengranter' },
      { id: 'delegated-chat', object: 'model', created: 200, owned_by: 'opengranter' },
    ],
  });
  assert.equal(externalCalls, 0);
  assert.deepEqual(audit, [
    {
      kind: 'models-listed',
      requestId: 'req-models',
      count: 2,
      principalId: 'user-1',
      credentialId: 'credential-1',
      policyVersions: [{ id: 'policy-1', version: 'v3' }],
    },
  ]);
});

test('GET models rejects missing or inactive identity before catalog lookup', async () => {
  for (const active of [undefined, false]) {
    const audit: unknown[] = [];
    let catalogCalled = false;
    const handler = createChatHandler({
      newRequestId: () => 'req-models-denied',
      authenticate: async () =>
        active === undefined ? undefined : { ...attributedPrincipal, active },
      listPublishedModels: async () => {
        catalogCalled = true;
        return [];
      },
      resolveRoute: async () => route,
      checkLimit: async () => true,
      resolveSecret: async () => 'key',
      writeUsage: async () => {},
      writeAudit: async (event) => {
        audit.push(event);
      },
      invokeDirect: async () => ({}),
    });
    const response = await handler(
      new Request('http://localhost/v1/models', {
        headers: { authorization: 'Bearer proxy-token' },
      }),
    );
    assert.equal(response.status, 401);
    assert.equal(catalogCalled, false);
    assert.deepEqual(audit, [{ kind: 'auth-denied', requestId: 'req-models-denied' }]);
  }
});

test('GET models fails closed on catalog errors, duplicate aliases, and audit failures', async () => {
  const entry: PublishedModel = {
    alias: 'chat',
    created: 100,
    enabled: true,
    routes: [
      {
        kind: 'managed',
        candidates: [{ id: 'one', kind: 'managed', upstreamModelId: 'gpt', providerId: 'openai' }],
      },
    ],
  };
  for (const catalog of [undefined, [entry, entry], [{ ...entry, created: -1 }]]) {
    const audit: unknown[] = [];
    const handler = createChatHandler({
      newRequestId: () => 'req-catalog-down',
      authenticate: async () => attributedPrincipal,
      listPublishedModels: async () => {
        if (!catalog) throw new Error('sensitive catalog detail');
        return catalog;
      },
      resolveRoute: async () => {
        throw new Error('unexpected');
      },
      checkLimit: async () => true,
      resolveSecret: async () => 'key',
      writeUsage: async () => {},
      writeAudit: async (event) => {
        audit.push(event);
      },
      invokeDirect: async () => ({}),
    });
    const response = await handler(
      new Request('http://localhost/v1/models', {
        headers: { authorization: 'Bearer proxy-token' },
      }),
    );
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes('sensitive'), false);
    assert.equal((audit[0] as { kind?: string }).kind, 'model-list-unavailable');
    assert.equal(JSON.stringify(audit).includes('sensitive'), false);
  }

  const handler = createChatHandler({
    newRequestId: () => 'req-audit-down',
    authenticate: async () => attributedPrincipal,
    listPublishedModels: async () => [],
    resolveRoute: async () => route,
    checkLimit: async () => true,
    resolveSecret: async () => 'key',
    writeUsage: async () => {},
    writeAudit: async () => {
      throw new Error('sensitive audit detail');
    },
    invokeDirect: async () => ({}),
  });
  const response = await handler(
    new Request('http://localhost/v1/models', { headers: { authorization: 'Bearer proxy-token' } }),
  );
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes('sensitive'), false);
});

test('GET models rejects query-based routing overrides before reading the catalog', async () => {
  let catalogCalled = false;
  const audit: unknown[] = [];
  const handler = createChatHandler({
    newRequestId: () => 'req-query',
    authenticate: async () => attributedPrincipal,
    listPublishedModels: async () => {
      catalogCalled = true;
      return [];
    },
    resolveRoute: async () => route,
    checkLimit: async () => true,
    resolveSecret: async () => 'key',
    writeUsage: async () => {},
    writeAudit: async (event) => {
      audit.push(event);
    },
    invokeDirect: async () => ({}),
  });
  const response = await handler(
    new Request('http://localhost/v1/models?provider=denied', {
      headers: { authorization: 'Bearer proxy-token' },
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(catalogCalled, false);
  assert.equal((audit[0] as { kind?: string }).kind, 'request-denied');
});

test('managed audit events carry safe identity and policy attribution', async () => {
  const audit: unknown[] = [];
  const handler = createChatHandler({
    newRequestId: () => 'req-attributed',
    authenticate: async () => attributedPrincipal,
    resolveRoute: async () => route,
    checkLimit: async () => true,
    resolveSecret: async () => 'sensitive-jev-key',
    writeUsage: async () => {},
    writeAudit: async (event) => {
      audit.push(event);
    },
    invokeDirect: async () => ({ id: 'completion-1', content: 'sensitive-response' }),
    fetchJev: async () => ({
      ok: true,
      json: async () => ({
        model: 'jev-1',
        answers: { route: { type: 'choice', choice: 'openai', confidence: 0.9 } },
      }),
    }),
  });
  assert.equal((await handler(chatRequest(validBody, 'sensitive-proxy-token'))).status, 200);
  assert.deepEqual(
    audit.map((event) => (event as { kind: string }).kind),
    ['selection-started', 'decision', 'attempt'],
  );
  for (const event of audit) {
    assert.equal((event as { principalId?: string }).principalId, 'user-1');
    assert.equal((event as { credentialId?: string }).credentialId, 'credential-1');
    assert.deepEqual((event as { policyVersions?: unknown }).policyVersions, [
      { id: 'policy-1', version: 'v3' },
    ]);
    const serialized = JSON.stringify(event);
    assert.equal(serialized.includes('sensitive-'), false);
    assert.equal(serialized.includes('statements'), false);
  }
});

test('authenticated validation failure carries attribution; missing attribution fails before route lookup', async () => {
  const audit: unknown[] = [];
  let routeCalls = 0;
  const ports = {
    newRequestId: () => 'req-denied',
    authenticate: async () => attributedPrincipal,
    resolveRoute: async () => {
      routeCalls++;
      return route;
    },
    checkLimit: async () => true,
    resolveSecret: async () => 'key',
    writeUsage: async () => {},
    writeAudit: async (event: unknown) => {
      audit.push(event);
    },
    invokeDirect: async () => ({}),
  };
  const invalid = await createChatHandler(ports)(chatRequest({ model: 'chat', messages: [] }));
  assert.equal(invalid.status, 400);
  assert.equal((audit[0] as { credentialId?: string }).credentialId, 'credential-1');
  assert.equal(routeCalls, 0);

  const missing = await createChatHandler({
    ...ports,
    authenticate: async () => ({ ...attributedPrincipal, credentialId: '' }),
  })(chatRequest(validBody));
  assert.equal(missing.status, 503);
  assert.equal(routeCalls, 0);
});

test('route lookup failure is attributed without leaking the store error', async () => {
  const audit: unknown[] = [];
  const handler = createChatHandler({
    newRequestId: () => 'req-route-down',
    authenticate: async () => attributedPrincipal,
    resolveRoute: async () => {
      throw new Error('sensitive route-store detail');
    },
    checkLimit: async () => true,
    resolveSecret: async () => 'key',
    writeUsage: async () => {},
    writeAudit: async (event) => {
      audit.push(event);
    },
    invokeDirect: async () => ({}),
  });
  const response = await handler(chatRequest(validBody));
  assert.equal(response.status, 503);
  assert.equal((audit[0] as { principalId?: string }).principalId, 'user-1');
  assert.equal((audit[0] as { credentialId?: string }).credentialId, 'credential-1');
  assert.equal((await response.text()).includes('sensitive'), false);
  assert.equal(JSON.stringify(audit).includes('sensitive'), false);
});

test('policy denial records the same attribution before any external call', async () => {
  const audit: unknown[] = [];
  let upstreamCalled = false;
  const handler = createChatHandler({
    newRequestId: () => 'req-policy-deny',
    authenticate: async () => ({ ...attributedPrincipal, statements: [] }),
    resolveRoute: async () => route,
    checkLimit: async () => {
      upstreamCalled = true;
      return true;
    },
    resolveSecret: async () => {
      upstreamCalled = true;
      return 'key';
    },
    writeUsage: async () => {},
    writeAudit: async (event) => {
      audit.push(event);
    },
    invokeDirect: async () => {
      upstreamCalled = true;
      return {};
    },
  });
  assert.equal((await handler(chatRequest(validBody))).status, 403);
  assert.equal(upstreamCalled, false);
  assert.deepEqual(audit, [
    {
      kind: 'denied',
      reason: 'no-candidates',
      requestId: 'req-policy-deny',
      routeVersion: 'v1',
      modelAlias: 'chat',
      principalId: 'user-1',
      credentialId: 'credential-1',
      policyVersions: [{ id: 'policy-1', version: 'v3' }],
    },
  ]);
});

test('audit attribution is fixed when the identity port mutates its source snapshot', async () => {
  const policyVersions = [{ id: 'policy-1', version: 'v3' }];
  const audit: unknown[] = [];
  const handler = createChatHandler({
    newRequestId: () => 'req-fixed',
    authenticate: async () => ({ ...attributedPrincipal, policyVersions }),
    resolveRoute: async () => {
      const version = policyVersions[0];
      if (version) version.version = 'v4';
      return route;
    },
    checkLimit: async () => true,
    resolveSecret: async () => 'jev-key',
    writeUsage: async () => {},
    writeAudit: async (event) => {
      audit.push(event);
    },
    invokeDirect: async () => ({ id: 'completion-1' }),
    fetchJev: async () => ({
      ok: true,
      json: async () => ({
        model: 'jev-1',
        answers: { route: { type: 'choice', choice: 'openai', confidence: 0.9 } },
      }),
    }),
  });
  assert.equal((await handler(chatRequest(validBody))).status, 200);
  for (const event of audit) {
    assert.deepEqual((event as { policyVersions?: unknown }).policyVersions, [
      { id: 'policy-1', version: 'v3' },
    ]);
  }
});

test('HTTP chat request authenticates then routes through Jev to direct adapter', async () => {
  const calls: string[] = [];
  const handler = createChatHandler({
    newRequestId: () => 'req-1',
    authenticate: async (token) => {
      calls.push(`auth:${token}`);
      return attributedPrincipal;
    },
    resolveRoute: async (alias) => {
      calls.push(`route:${alias}`);
      return route;
    },
    checkLimit: async () => {
      calls.push('limit');
      return true;
    },
    resolveSecret: async () => 'jev-key',
    writeUsage: async () => {},
    writeAudit: async (event) => {
      calls.push(`audit:${event.kind}`);
    },
    invokeDirect: async (candidate, request) => {
      calls.push(`provider:${candidate.id}`);
      assert.deepEqual(request.messages, validBody.messages);
      return { id: 'completion-1', object: 'chat.completion', model: 'chat', choices: [] };
    },
    fetchJev: async () => ({
      ok: true,
      json: async () => ({
        model: 'jev-1',
        answers: { route: { type: 'choice', choice: 'openai', confidence: 0.9 } },
      }),
    }),
  });
  const response = await handler(chatRequest(validBody));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-request-id'), 'req-1');
  assert.equal(((await response.json()) as { id: string }).id, 'completion-1');
  assert.deepEqual(calls.slice(0, 3), ['auth:proxy-token', 'route:chat', 'limit']);
  assert.equal(calls.includes('provider:openai'), true);
});

test('missing token returns 401 and does not resolve routes or call Jev', async () => {
  const calls: string[] = [];
  const audit: unknown[] = [];
  const handler = createChatHandler({
    newRequestId: () => 'req-2',
    authenticate: async () => {
      calls.push('auth');
      return undefined;
    },
    resolveRoute: async () => {
      calls.push('route');
      return route;
    },
    checkLimit: async () => {
      calls.push('limit');
      return true;
    },
    resolveSecret: async () => {
      calls.push('secret');
      return 'key';
    },
    writeUsage: async () => {},
    writeAudit: async (event) => {
      calls.push(`audit:${event.kind}`);
      audit.push(event);
    },
    invokeDirect: async () => {
      calls.push('provider');
      return {};
    },
    fetchJev: async () => {
      calls.push('jev');
      throw new Error('unexpected');
    },
  });
  const response = await handler(
    new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify(validBody),
    }),
  );
  assert.equal(response.status, 401);
  assert.deepEqual(calls, ['audit:auth-denied']);
  assert.deepEqual(audit, [{ kind: 'auth-denied', requestId: 'req-2' }]);
});

test('authentication-store failure is audited and returns a safe 503', async () => {
  const audit: unknown[] = [];
  const handler = createChatHandler({
    newRequestId: () => 'req-auth-down',
    authenticate: async () => {
      throw new Error('sensitive identity-store failure');
    },
    resolveRoute: async () => {
      throw new Error('unexpected route lookup');
    },
    checkLimit: async () => true,
    resolveSecret: async () => 'key',
    writeUsage: async () => {},
    writeAudit: async (event) => {
      audit.push(event);
    },
    invokeDirect: async () => {
      throw new Error('unexpected provider call');
    },
  });
  const response = await handler(chatRequest(validBody));
  assert.equal(response.status, 503);
  assert.equal(JSON.stringify(audit).includes('auth-unavailable'), true);
  assert.equal((await response.text()).includes('sensitive identity-store failure'), false);
});

test('route-store failure is audited without disclosing storage errors', async () => {
  const audit: unknown[] = [];
  const handler = createChatHandler({
    newRequestId: () => 'req-route-down',
    authenticate: async () => attributedPrincipal,
    resolveRoute: async () => {
      throw new Error('sensitive route-store failure');
    },
    checkLimit: async () => true,
    resolveSecret: async () => 'key',
    writeUsage: async () => {},
    writeAudit: async (event) => {
      audit.push(event);
    },
    invokeDirect: async () => {
      throw new Error('unexpected provider call');
    },
  });
  const response = await handler(chatRequest(validBody));
  assert.equal(response.status, 503);
  assert.equal(JSON.stringify(audit).includes('route-unavailable'), true);
  assert.equal((await response.text()).includes('sensitive route-store failure'), false);
});

test('unsupported fields and malformed messages are rejected before upstream calls', async () => {
  const bodies = [
    { ...validBody, stream: true },
    { ...validBody, top_a: 0.1 },
    { ...validBody, min_p: -0.1 },
    { ...validBody, top_k: -1 },
    { ...validBody, temperature: 2.1 },
    { model: 'chat', messages: [{ role: 'user', content: [{ type: 'image_url' }] }] },
    {
      model: 'chat',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'system', content: 'Late instruction' },
      ],
    },
    { model: 'chat', messages: [{ role: { toString: 'user' }, content: 'Hello' }] },
  ];
  for (const body of bodies) {
    let upstreamCalled = false;
    const handler = createChatHandler({
      newRequestId: () => 'req-3',
      authenticate: async () => attributedPrincipal,
      resolveRoute: async () => route,
      checkLimit: async () => true,
      resolveSecret: async () => 'key',
      writeUsage: async () => {},
      writeAudit: async () => {},
      invokeDirect: async () => {
        upstreamCalled = true;
        return {};
      },
      fetchJev: async () => {
        upstreamCalled = true;
        throw new Error('unexpected');
      },
    });
    const response = await handler(chatRequest(body));
    assert.equal(response.status, 400);
    assert.equal(upstreamCalled, false);
  }
});

test('body stream failure returns a safe validation error', async () => {
  const handler = createChatHandler({
    newRequestId: () => 'req-stream',
    authenticate: async () => attributedPrincipal,
    resolveRoute: async () => route,
    checkLimit: async () => true,
    resolveSecret: async () => 'key',
    writeUsage: async () => {},
    writeAudit: async () => {},
    invokeDirect: async () => {
      throw new Error('unexpected provider call');
    },
    fetchJev: async () => {
      throw new Error('unexpected Jev call');
    },
  });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error('private stream failure'));
    },
  });
  const request = new Request('http://localhost/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  const response = await handler(request);
  assert.equal(response.status, 400);
  assert.equal((await response.text()).includes('private stream failure'), false);
});

test('unknown and unauthorized models fail before Jev or direct provider', async () => {
  for (const mode of ['unknown', 'denied'] as const) {
    let upstreamCalled = false;
    const handler = createChatHandler({
      newRequestId: () => 'req-4',
      authenticate: async () => ({
        ...attributedPrincipal,
        statements: mode === 'denied' ? [] : statements,
      }),
      resolveRoute: async () => (mode === 'unknown' ? undefined : route),
      checkLimit: async () => true,
      resolveSecret: async () => 'key',
      writeUsage: async () => {},
      writeAudit: async () => {},
      invokeDirect: async () => {
        upstreamCalled = true;
        return {};
      },
      fetchJev: async () => {
        upstreamCalled = true;
        throw new Error('unexpected');
      },
    });
    const response = await handler(chatRequest(validBody));
    assert.equal(response.status, mode === 'unknown' ? 404 : 403);
    assert.equal(upstreamCalled, false);
  }
});

test('HTTP boundary returns fallback provider result after retryable failure', async () => {
  const attempted: string[] = [];
  const handler = createChatHandler({
    newRequestId: () => 'req-5',
    authenticate: async () => attributedPrincipal,
    resolveRoute: async () => route,
    checkLimit: async () => true,
    resolveSecret: async () => 'key',
    writeUsage: async () => {},
    writeAudit: async () => {},
    invokeDirect: async (candidate) => {
      attempted.push(candidate.id);
      if (candidate.id === 'openai') throw new DirectProviderFailure('rate-limit', false, false);
      return { id: 'backup-completion', object: 'chat.completion', model: 'chat', choices: [] };
    },
    fetchJev: async () => ({
      ok: true,
      json: async () => ({
        model: 'jev-1',
        answers: { route: { type: 'choice', choice: 'openai', confidence: 0.9 } },
      }),
    }),
  });
  const response = await handler(chatRequest(validBody));
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as { id: string }).id, 'backup-completion');
  assert.deepEqual(attempted, ['openai', 'anthropic']);
});
