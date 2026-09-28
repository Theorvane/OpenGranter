import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import type { Statement } from '../src/policy/evaluate.ts';
import { encodeUsageCursor, type UsageHistoryQuery } from '../src/usage/history.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

const ownRecord = buildUsageRecord({
  principalId: 'person-1',
  credentialId: 'credential-1',
  policyVersions: [{ id: 'policy-1', version: 'v1' }],
  requestId: 'chat-1',
  attemptId: 'chat-1/managed/1',
  modelAlias: 'chat',
  routeKind: 'managed',
  upstreamModelId: 'gpt',
  selectedCandidateId: 'candidate-1',
  actualInferenceProviderId: 'openai',
  occurredAt: 100,
  latencyMs: 5,
  outcome: 'succeeded',
  possiblyBilled: true,
  possibleDuplicate: false,
  providerUsage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
});

function request(query = '') {
  return new Request(`http://localhost/v1/usage${query}`, {
    headers: { authorization: 'Bearer proxy-token' },
  });
}

test('self-authorized usage read asks storage only for the authenticated principal', async () => {
  const queried: unknown[] = [];
  const audit: unknown[] = [];
  const handler = createChatHandler({
    newRequestId: () => 'read-1',
    authenticate: async () => ({
      id: 'person-1',
      active: true,
      credentialId: 'credential-1',
      policyVersions: [{ id: 'policy-1', version: 'v1' }],
      statements: [
        { effect: 'Allow', actions: ['usage:ReadSelf'], resources: ['principal:person-1'] },
      ],
    }),
    resolveRoute: async () => {
      throw new Error('route must not be read');
    },
    checkLimit: async () => {
      throw new Error('limit must not be checked');
    },
    resolveSecret: async () => {
      throw new Error('secret must not be read');
    },
    writeUsage: async () => {
      throw new Error('usage must not be written');
    },
    writeAudit: async (event) => {
      audit.push(event);
    },
    invokeDirect: async () => {
      throw new Error('provider must not be called');
    },
    listUsage: async (query) => {
      queried.push(query);
      return { records: [ownRecord], hasMore: false };
    },
  });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(queried, [{ principalId: 'person-1', limit: 50, cursor: null }]);
  const body = (await response.json()) as {
    object: string;
    data: unknown[];
    has_more: boolean;
    next_cursor: string | null;
  };
  assert.equal(body.object, 'list');
  assert.equal(body.data.length, 1);
  assert.equal(body.has_more, false);
  assert.equal(body.next_cursor, null);
  assert.equal((audit[0] as { kind: string }).kind, 'usage-read');
});

function fixture(
  options: {
    statements?: readonly Statement[];
    listUsage?: (query: UsageHistoryQuery) => Promise<unknown>;
    writeAudit?: (event: unknown) => Promise<void>;
  } = {},
) {
  const state = { queries: [] as UsageHistoryQuery[], audit: [] as unknown[] };
  const handler = createChatHandler({
    newRequestId: () => 'read-2',
    authenticate: async () => ({
      id: 'person-1',
      active: true,
      credentialId: 'credential-1',
      policyVersions: [{ id: 'policy-1', version: 'v1' }],
      statements: options.statements ?? [
        { effect: 'Allow', actions: ['usage:ReadSelf'], resources: ['principal:person-1'] },
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
      throw new Error('unexpected write');
    },
    writeAudit: async (event) => {
      state.audit.push(event);
      await options.writeAudit?.(event);
    },
    invokeDirect: async () => {
      throw new Error('unexpected provider');
    },
    listUsage: async (query) => {
      state.queries.push(query);
      return (
        ((await options.listUsage?.(query)) as {
          records: (typeof ownRecord)[];
          hasMore: boolean;
        }) ?? { records: [ownRecord], hasMore: false }
      );
    },
  });
  return { handler, state };
}

test('default and explicit Deny stop self reads before storage', async () => {
  for (const statements of [
    [],
    [
      { effect: 'Allow' as const, actions: ['usage:ReadSelf'], resources: ['principal:person-1'] },
      { effect: 'Deny' as const, actions: ['usage:ReadSelf'], resources: ['principal:person-1'] },
    ],
    [{ effect: 'Allow' as const, actions: ['usage:ReadAll'], resources: ['principal:*'] }],
  ]) {
    const { handler, state } = fixture({ statements });
    const response = await handler(request());
    assert.equal(response.status, 403);
    assert.deepEqual(state.queries, []);
    assert.equal((state.audit[0] as { kind: string }).kind, 'usage-read-denied');
  }
});

test('specified principal requires ReadAll on that principal', async () => {
  const targetRecord = { ...ownRecord, principalId: 'person-2' };
  const { handler, state } = fixture({
    statements: [
      { effect: 'Allow', actions: ['usage:ReadAll'], resources: ['principal:person-2'] },
    ],
    listUsage: async () => ({ records: [targetRecord], hasMore: false }),
  });
  const response = await handler(request('?principal_id=person-2'));
  assert.equal(response.status, 200);
  assert.equal(state.queries[0]?.principalId, 'person-2');
  assert.equal(
    ((await response.json()) as { data: { principalId: string }[] }).data[0]?.principalId,
    'person-2',
  );
  const denied = fixture();
  assert.equal((await denied.handler(request('?principal_id=person-2'))).status, 403);
  assert.deepEqual(denied.state.queries, []);
  const explicitDeny = fixture({
    statements: [
      { effect: 'Allow', actions: ['usage:ReadAll'], resources: ['principal:*'] },
      { effect: 'Deny', actions: ['usage:ReadAll'], resources: ['principal:person-2'] },
    ],
  });
  assert.equal((await explicitDeny.handler(request('?principal_id=person-2'))).status, 403);
  assert.deepEqual(explicitDeny.state.queries, []);
  const selfViaAll = fixture({
    statements: [
      { effect: 'Allow', actions: ['usage:ReadSelf'], resources: ['principal:person-1'] },
    ],
  });
  assert.equal((await selfViaAll.handler(request('?principal_id=person-1'))).status, 403);
});

test('invalid query and forged cursor cannot widen the principal read', async () => {
  for (const query of ['?limit=0', '?limit=101', '?limit=1&limit=2', '?cursor=!', '?other=x']) {
    const { handler, state } = fixture();
    assert.equal((await handler(request(query))).status, 400);
    assert.deepEqual(state.queries, []);
  }
  const cursor = encodeUsageCursor({ occurredAt: 100, attemptId: 'person-2-attempt' });
  const { handler, state } = fixture();
  assert.equal((await handler(request(`?cursor=${cursor}&limit=1`))).status, 200);
  assert.equal(state.queries[0]?.principalId, 'person-1');
  assert.equal(state.queries[0]?.cursor?.attemptId, 'person-2-attempt');
});

test('usage history returns an opaque cursor for the last item on a full page', async () => {
  const { handler, state } = fixture({
    listUsage: async (query) => ({ records: [ownRecord], hasMore: query.cursor === null }),
  });
  const first = await handler(request('?limit=1'));
  assert.equal(first.status, 200);
  const firstBody = (await first.json()) as { next_cursor: string; has_more: boolean };
  assert.equal(firstBody.has_more, true);
  assert.ok(firstBody.next_cursor);
  const second = await handler(request(`?limit=1&cursor=${firstBody.next_cursor}`));
  assert.equal(second.status, 200);
  assert.equal(state.queries[1]?.cursor?.attemptId, ownRecord.attemptId);
  assert.equal(((await second.json()) as { has_more: boolean }).has_more, false);
});

test('mixed-principal or malformed storage results fail closed without partial data', async () => {
  for (const records of [
    [ownRecord, { ...ownRecord, principalId: 'person-2' }],
    [{ ...ownRecord, usage: { status: 'reported', promptTokens: -1 } }],
    [
      { ...ownRecord, prompt: 'private prompt' },
      { ...ownRecord, principalId: 'person-2' },
    ],
  ]) {
    const { handler, state } = fixture({ listUsage: async () => ({ records, hasMore: false }) });
    const response = await handler(request());
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes('private prompt'), false);
    assert.equal((state.audit.at(-1) as { kind: string }).kind, 'usage-read-unavailable');
  }
});

test('reader response excludes unexpected stored content and secret properties', async () => {
  const { handler } = fixture({
    listUsage: async () => ({
      records: [
        Object.assign(
          { ...ownRecord },
          {
            prompt: 'private prompt',
            response: 'private response',
            providerKey: 'private key',
          },
        ),
      ],
      hasMore: false,
    }),
  });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal((await response.text()).includes('private'), false);
});

test('storage and required audit failures return safe service errors', async () => {
  const unavailable = fixture({
    listUsage: async () => {
      throw new Error('sensitive database detail');
    },
  });
  const unavailableResponse = await unavailable.handler(request());
  assert.equal(unavailableResponse.status, 503);
  assert.equal((await unavailableResponse.text()).includes('sensitive'), false);
  const auditFailure = fixture({
    writeAudit: async () => {
      throw new Error('audit down');
    },
  });
  const auditResponse = await auditFailure.handler(request());
  assert.equal(auditResponse.status, 503);
  assert.equal(
    ((await auditResponse.json()) as { error: { code: string } }).error.code,
    'audit_unavailable',
  );
  let failedOnce = false;
  const oneAuditFailure = fixture({
    writeAudit: async (event) => {
      if (!failedOnce && (event as { kind: string }).kind === 'usage-read') {
        failedOnce = true;
        throw new Error('audit temporarily down');
      }
    },
  });
  const oneFailureResponse = await oneAuditFailure.handler(request());
  assert.equal(
    ((await oneFailureResponse.json()) as { error: { code: string } }).error.code,
    'audit_unavailable',
  );
});

test('model and time filters reach the authorized storage query', async () => {
  const { handler, state } = fixture();
  const response = await handler(request('?model=chat&from_ms=100&to_ms=101'));
  assert.equal(response.status, 200);
  assert.deepEqual(state.queries, [
    {
      principalId: 'person-1',
      limit: 50,
      cursor: null,
      modelAlias: 'chat',
      fromMs: 100,
      toMs: 101,
    },
  ]);
});

test('out-of-filter storage records fail closed and create safe audit', async () => {
  for (const query of ['?model=other', '?from_ms=101', '?to_ms=100']) {
    const { handler, state } = fixture();
    const response = await handler(request(query));
    assert.equal(response.status, 503);
    assert.equal((state.audit[0] as { kind: string }).kind, 'usage-read-unavailable');
  }
});

test('invalid filter inputs reject before storage', async () => {
  for (const query of [
    '?model=',
    '?model=%00chat',
    `?model=${'x'.repeat(257)}`,
    '?model=chat&model=other',
    '?from_ms=-1',
    '?from_ms=01',
    '?from_ms=1.5',
    '?to_ms=9007199254740992',
    '?from_ms=100&to_ms=100',
    '?from_ms=101&to_ms=100',
  ]) {
    const { handler, state } = fixture();
    assert.equal((await handler(request(query))).status, 400);
    assert.equal(state.queries.length, 0);
  }
});

test('filtered reads still enforce default and explicit Deny and required audit', async () => {
  for (const statements of [
    [],
    [
      { effect: 'Allow' as const, actions: ['usage:ReadSelf'], resources: ['principal:person-1'] },
      { effect: 'Deny' as const, actions: ['usage:ReadSelf'], resources: ['principal:person-1'] },
    ],
  ]) {
    const { handler, state } = fixture({ statements });
    assert.equal((await handler(request('?model=chat&from_ms=0'))).status, 403);
    assert.equal(state.queries.length, 0);
  }
  const { handler } = fixture({
    writeAudit: async () => {
      throw new Error('secret failure');
    },
  });
  assert.equal((await handler(request('?model=chat'))).status, 503);
});

test('authorized filtered CSV uses identical storage scope and exposes page continuation', async () => {
  const { handler, state } = fixture({
    listUsage: async () => ({ records: [ownRecord], hasMore: true }),
  });
  const response = await handler(request('?format=csv&model=chat&from_ms=100&to_ms=101'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.equal(
    response.headers.get('content-disposition'),
    'attachment; filename="opengranter-usage.csv"',
  );
  assert.equal(response.headers.get('x-has-more'), 'true');
  assert.equal(
    response.headers.get('x-next-cursor'),
    encodeUsageCursor({ occurredAt: 100, attemptId: ownRecord.attemptId }),
  );
  assert.deepEqual(state.queries, [
    {
      principalId: 'person-1',
      limit: 50,
      cursor: null,
      modelAlias: 'chat',
      fromMs: 100,
      toMs: 101,
    },
  ]);
  assert.ok((await response.text()).includes('"chat-1/managed/1"'));
  assert.equal((state.audit[0] as { kind: string }).kind, 'usage-read');
});

test('CSV format cannot bypass denial, storage validation, or required audit', async () => {
  for (const statements of [
    [],
    [
      { effect: 'Allow' as const, actions: ['usage:ReadSelf'], resources: ['principal:person-1'] },
      { effect: 'Deny' as const, actions: ['usage:ReadSelf'], resources: ['principal:person-1'] },
    ],
  ]) {
    const { handler, state } = fixture({ statements });
    assert.equal((await handler(request('?format=csv'))).status, 403);
    assert.equal(state.queries.length, 0);
  }
  for (const options of [
    {
      listUsage: async () => {
        throw new Error('private storage');
      },
    },
    {
      listUsage: async () => ({
        records: [{ ...ownRecord, principalId: 'other' }],
        hasMore: false,
      }),
    },
    {
      writeAudit: async () => {
        throw new Error('private audit');
      },
    },
  ]) {
    const { handler } = fixture(options);
    const response = await handler(request('?format=csv'));
    assert.equal(response.status, 503);
    assert.ok(response.headers.get('content-type')?.includes('application/json'));
    assert.ok(!(await response.text()).includes('private'));
  }
});

test('empty CSV pages provide column headers and explicit completion', async () => {
  const { handler } = fixture({ listUsage: async () => ({ records: [], hasMore: false }) });
  const response = await handler(request('?format=csv'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-has-more'), 'false');
  assert.equal(response.headers.get('x-next-cursor'), null);
  assert.equal((await response.text()).split('\r\n').length, 2);
});

test('unsupported or repeated export formats reject before storage', async () => {
  for (const query of ['?format=', '?format=xml', '?format=CSV', '?format=csv&format=json']) {
    const { handler, state } = fixture();
    assert.equal((await handler(request(query))).status, 400);
    assert.equal(state.queries.length, 0);
  }
  const { handler } = fixture();
  assert.equal((await handler(request('?format=json'))).status, 200);
});
