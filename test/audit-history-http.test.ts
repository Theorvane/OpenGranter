import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';

const event = {
  eventId: '8',
  occurredAt: 1000,
  kind: 'models-listed',
  requestId: 'model-list-1',
  principalId: 'person-1',
  credentialId: 'credential-1',
  policyVersions: [{ id: 'policy-1', version: 'v1' }],
  details: { count: 1, prompt: 'private prompt' },
};

function fixture(
  options: {
    statements?: readonly { effect: 'Allow' | 'Deny'; actions: string[]; resources: string[] }[];
    listAudit?: (query: unknown) => Promise<unknown>;
    writeAudit?: (event: unknown) => Promise<void>;
  } = {},
) {
  const state = { queries: [] as unknown[], audit: [] as unknown[] };
  const handler = createChatHandler({
    newRequestId: () => 'audit-read-1',
    authenticate: async () => ({
      id: 'person-1',
      active: true,
      credentialId: 'credential-1',
      policyVersions: [{ id: 'policy-1', version: 'v1' }],
      statements: options.statements ?? [
        { effect: 'Allow', actions: ['audit:Read'], resources: ['principal:person-1'] },
      ],
    }),
    resolveRoute: async () => {
      throw new Error('unexpected route');
    },
    checkLimit: async () => {
      throw new Error('unexpected limit');
    },
    resolveSecret: async () => {
      throw new Error('unexpected secret');
    },
    writeUsage: async () => {
      throw new Error('unexpected usage');
    },
    writeAudit: async (auditEvent) => {
      state.audit.push(auditEvent);
      await options.writeAudit?.(auditEvent);
    },
    invokeDirect: async () => {
      throw new Error('unexpected inference');
    },
    listAudit: async (query) => {
      state.queries.push(query);
      return ((await options.listAudit?.(query)) ?? { events: [event], nextCursor: null }) as {
        events: (typeof event)[];
        nextCursor: string | null;
      };
    },
  });
  return { handler, state };
}

function request(query = '', authorization = 'Bearer proxy-token') {
  return new Request(`http://localhost/v1/audit${query}`, { headers: { authorization } });
}

test('an explicitly granted audit reader sees only projected principal metadata', async () => {
  const { handler, state } = fixture();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(state.queries, [{ principalId: 'person-1', limit: 50, cursor: null }]);
  const body = await response.text();
  assert.equal(body.includes('private prompt'), false);
  assert.equal(JSON.parse(body).data[0].details.count, 1);
  assert.equal((state.audit[0] as { kind: string }).kind, 'audit-history-read');
});

test('default and explicit Deny stop reads before storage', async () => {
  for (const statements of [
    [],
    [
      { effect: 'Allow' as const, actions: ['audit:Read'], resources: ['principal:person-1'] },
      { effect: 'Deny' as const, actions: ['audit:Read'], resources: ['principal:person-1'] },
    ],
  ]) {
    const { handler, state } = fixture({ statements });
    assert.equal((await handler(request())).status, 403);
    assert.deepEqual(state.queries, []);
    assert.equal((state.audit[0] as { kind: string }).kind, 'audit-history-read-denied');
  }
});

test('cross-principal read requires a grant on the target principal', async () => {
  const targetEvent = { ...event, principalId: 'person-2' };
  const granted = fixture({
    statements: [{ effect: 'Allow', actions: ['audit:Read'], resources: ['principal:person-2'] }],
    listAudit: async () => ({ events: [targetEvent], nextCursor: null }),
  });
  const response = await granted.handler(request('?principal_id=person-2'));
  assert.equal(response.status, 200);
  assert.deepEqual(granted.state.queries, [{ principalId: 'person-2', limit: 50, cursor: null }]);
  const denied = fixture();
  assert.equal((await denied.handler(request('?principal_id=person-2'))).status, 403);
  assert.deepEqual(denied.state.queries, []);
});

test('invalid queries and unauthenticated calls cannot reach the reader', async () => {
  for (const query of [
    '?limit=0',
    '?limit=101',
    '?limit=1&limit=2',
    '?cursor=0',
    '?cursor=99999999999999999999',
    '?principal_id=',
    '?principal_id=person%0A2',
    '?unknown=x',
  ]) {
    const { handler, state } = fixture();
    assert.equal((await handler(request(query))).status, 400, query);
    assert.deepEqual(state.queries, []);
  }
  const { handler, state } = fixture();
  assert.equal((await handler(request('', 'invalid'))).status, 401);
  assert.deepEqual(state.queries, []);
});

test('pagination preserves the bounded principal filter and cursor', async () => {
  const { handler, state } = fixture({
    listAudit: async (query) => ({
      events: [
        (query as { cursor: string | null }).cursor === null ? event : { ...event, eventId: '7' },
      ],
      nextCursor: (query as { cursor: string | null }).cursor === null ? '8' : null,
    }),
  });
  const first = await handler(request('?limit=1'));
  assert.equal(first.status, 200);
  assert.equal(((await first.json()) as { next_cursor: string }).next_cursor, '8');
  const second = await handler(request('?limit=1&cursor=8'));
  assert.equal(second.status, 200);
  assert.deepEqual(state.queries, [
    { principalId: 'person-1', limit: 1, cursor: null },
    { principalId: 'person-1', limit: 1, cursor: '8' },
  ]);
});

test('malformed and cross-principal reader pages fail without partial data', async () => {
  for (const page of [
    { events: [{ ...event, principalId: 'person-2' }], nextCursor: null },
    { events: [{ ...event, eventId: 'bad' }], nextCursor: null },
    { events: [event, { ...event, eventId: '9' }], nextCursor: null },
    { events: [event], nextCursor: '7' },
    { events: [{ ...event, details: { count: -1 } }], nextCursor: null },
    { events: [event, event], nextCursor: null },
  ]) {
    const { handler, state } = fixture({ listAudit: async () => page });
    const response = await handler(request());
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes('private'), false);
    assert.equal((state.audit.at(-1) as { kind: string }).kind, 'audit-history-read-unavailable');
  }
});

test('storage and required audit failures return safe service errors', async () => {
  const storage = fixture({
    listAudit: async () => {
      throw new Error('private database detail');
    },
  });
  const storageResponse = await storage.handler(request());
  assert.equal(storageResponse.status, 503);
  assert.equal((await storageResponse.text()).includes('private'), false);
  const write = fixture({
    writeAudit: async () => {
      throw new Error('private audit detail');
    },
  });
  const writeResponse = await write.handler(request());
  assert.equal(writeResponse.status, 503);
  assert.equal((await writeResponse.text()).includes('private'), false);
});

test('audit read events persist only target and count metadata', async () => {
  const { projectGatewayAuditEvent } = await import('../src/audit/postgres-gateway-audit.ts');
  const base = {
    principalId: 'person-1',
    credentialId: 'credential-1',
    policyVersions: [{ id: 'policy-1', version: 'v1' }],
    requestId: 'audit-read-1',
    targetPrincipalId: 'person-2',
    prompt: 'private prompt',
  };
  for (const kind of [
    'audit-history-read',
    'audit-history-read-denied',
    'audit-history-read-unavailable',
  ]) {
    const projected = projectGatewayAuditEvent({ ...base, kind, count: 2 }, 1000);
    assert.equal(projected.details.targetPrincipalId, 'person-2');
    assert.equal(JSON.stringify(projected).includes('private prompt'), false);
    assert.deepEqual(
      projected.details,
      kind === 'audit-history-read'
        ? { targetPrincipalId: 'person-2', count: 2 }
        : { targetPrincipalId: 'person-2' },
    );
  }
});

test('audit time bounds reach the authorized reader', async () => {
  const { handler, state } = fixture();
  const response = await handler(request('?from_ms=1000&to_ms=1001'));
  assert.equal(response.status, 200);
  assert.deepEqual(state.queries, [
    { principalId: 'person-1', limit: 50, cursor: null, fromMs: 1000, toMs: 1001 },
  ]);
});

test('out-of-range injected audit pages fail closed', async () => {
  for (const query of ['?from_ms=1001', '?to_ms=1000']) {
    const { handler, state } = fixture();
    assert.equal((await handler(request(query))).status, 503);
    assert.equal((state.audit[0] as { kind: string }).kind, 'audit-history-read-unavailable');
  }
});

test('invalid audit time ranges reject before storage', async () => {
  for (const query of [
    '?from_ms=-1',
    '?from_ms=01',
    '?to_ms=1.5',
    '?from_ms=',
    '?to_ms=9007199254740992',
    '?from_ms=1000&to_ms=1000',
    '?from_ms=1001&to_ms=1000',
    '?from_ms=0&from_ms=1',
  ]) {
    const { handler, state } = fixture();
    assert.equal((await handler(request(query))).status, 400);
    assert.equal(state.queries.length, 0);
  }
});

test('audit ranges do not bypass permissions or required read auditing', async () => {
  for (const statements of [
    [],
    [
      { effect: 'Allow' as const, actions: ['audit:Read'], resources: ['principal:person-1'] },
      { effect: 'Deny' as const, actions: ['audit:Read'], resources: ['principal:person-1'] },
    ],
  ]) {
    const { handler, state } = fixture({ statements });
    assert.equal((await handler(request('?from_ms=0'))).status, 403);
    assert.equal(state.queries.length, 0);
  }
  const { handler } = fixture({
    writeAudit: async () => {
      throw new Error('private failure');
    },
  });
  assert.equal((await handler(request('?from_ms=0'))).status, 503);
});
