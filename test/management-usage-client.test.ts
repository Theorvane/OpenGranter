import assert from 'node:assert/strict';
import test from 'node:test';
import { createSsoUsageClient } from '../src/management/usage-client.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

function row(attemptId = 'z', occurredAt = 10) {
  return buildUsageRecord({
    principalId: 'human',
    credentialId: 'historical',
    policyVersions: [],
    requestId: 'r',
    attemptId,
    modelAlias: 'chat',
    routeKind: 'managed',
    upstreamModelId: 'upstream',
    selectedCandidateId: 'candidate',
    occurredAt,
    latencyMs: 2,
    outcome: 'succeeded',
    possiblyBilled: true,
    possibleDuplicate: true,
    estimatedCost: { amountDecimal: '0.0100', currency: 'USD', priceVersion: 'v1' },
  });
}
function page(data: unknown[] = [row()], has_more = false, next_cursor: string | null = null) {
  return Response.json({ object: 'list', data, has_more, next_cursor });
}
test('JSON keeps unknown billing and duplicate markers and strips private extensions', async () => {
  let path = '';
  const client = createSsoUsageClient(async (url, init) => {
    path = url;
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(init.headers, { accept: 'application/json' });
    return page([{ ...row(), prompt: 'PRIVATE', usage: { ...row().usage, secret: 'PRIVATE' } }]);
  });
  const result = await client.read({ model: 'chat', fromMs: 0, toMs: 11, limit: 2 });
  assert.equal(path, '/management/v1/usage?format=json&model=chat&from_ms=0&to_ms=11&limit=2');
  assert.deepEqual(result, {
    state: 'ready',
    data: [
      {
        ...row(),
        costComparison: { status: 'estimate_only', reportedMinusEstimated: null, currency: null },
      },
    ],
    hasMore: false,
    nextCursor: null,
  });
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('empty is ready, not unavailable or invented zero billing', async () => {
  assert.deepEqual(await createSsoUsageClient(async () => page([])).read(), {
    state: 'ready',
    data: [],
    hasMore: false,
    nextCursor: null,
  });
});

const cursor = (time: number, id: string) =>
  Buffer.from(JSON.stringify([time, id])).toString('base64url');
test('continuation is opaque, equals final row and next request respects UTF8 key order', async () => {
  const next = cursor(10, 'z');
  const client = createSsoUsageClient(async () => page([row()], true, next));
  const result = await client.read({ limit: 1 });
  assert.equal(result.state, 'ready');
  if (result.state === 'ready') assert.equal(result.nextCursor, next);
  assert.equal(
    (await createSsoUsageClient(async () => page([row('a', 10)])).read({ cursor: next })).state,
    'ready',
  );
  assert.equal(
    (await createSsoUsageClient(async () => page([row('é', 10)])).read({ cursor: next })).state,
    'unavailable',
  );
});
test('malformed pages, private fields, impossible usage and filter/order violations fail closed', async () => {
  for (const response of [
    { object: 'list', data: [row()], has_more: true, next_cursor: cursor(1, 'wrong') },
    { object: 'list', data: [], has_more: true, next_cursor: cursor(10, 'z') },
    { object: 'list', data: [row()], has_more: false, next_cursor: cursor(10, 'z') },
    { object: 'list', data: [row(), row()], has_more: false, next_cursor: null },
    { object: 'list', data: [row('a', 1), row('z', 2)], has_more: false, next_cursor: null },
    {
      object: 'list',
      data: [
        {
          ...row(),
          usage: {
            status: 'reported',
            promptTokens: null,
            completionTokens: null,
            totalTokens: null,
          },
        },
      ],
      has_more: false,
      next_cursor: null,
    },
    {
      object: 'list',
      data: [
        {
          ...row(),
          upstreamBilledCost: { amountDecimal: 'NaN', currency: 'USD', source: 'direct-provider' },
        },
      ],
      has_more: false,
      next_cursor: null,
    },
    {
      object: 'list',
      data: [{ ...row(), principalId: 'other' }],
      has_more: false,
      next_cursor: null,
    },
    {
      object: 'list',
      data: [{ ...row(), modelAlias: 'other' }],
      has_more: false,
      next_cursor: null,
    },
    { object: 'list', data: [row('z', 20)], has_more: false, next_cursor: null },
    { object: 'list', data: [row(), row('a', 1)], has_more: false, next_cursor: null },
    { object: 'list', data: [null], has_more: false, next_cursor: null },
    { object: 'list', data: [row()], has_more: 'false', next_cursor: null },
    { object: 'other', data: [], has_more: false, next_cursor: null },
  ]) {
    assert.deepEqual(
      await createSsoUsageClient(async () => Response.json(response)).read({
        principalId: 'human',
        model: 'chat',
        toMs: 11,
        limit: 1,
      }),
      { state: 'unavailable' },
    );
  }
});
test('malformed filters never request; status errors never consume private bodies', async () => {
  let requests = 0;
  const client = createSsoUsageClient(async () => {
    requests++;
    return page();
  });
  for (const filters of [
    { limit: 0 },
    { limit: 101 },
    { fromMs: 2, toMs: 2 },
    { model: '\n' },
    { cursor: 'bad!' },
    { principalId: '' },
  ])
    assert.deepEqual(await client.read(filters), { state: 'invalid_query' });
  assert.equal(requests, 0);
  for (const [status, state] of [
    [400, 'invalid_query'],
    [401, 'unauthenticated'],
    [403, 'denied'],
    [500, 'unavailable'],
    [302, 'unavailable'],
  ] as const) {
    let cancelled = false;
    const result = await createSsoUsageClient(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { status },
        ),
    ).read();
    assert.deepEqual(result, { state });
    assert.equal(cancelled, true);
  }
});
test('bounds streamed JSON bytes, strict UTF8 and media; rejects HTML without consuming', async () => {
  for (const response of [
    new Response('PRIVATE', { headers: { 'content-type': 'text/html' } }),
    new Response('{', { headers: { 'content-type': 'application/json' } }),
    new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }),
    new Response(' '.repeat(2 * 1024 * 1024 + 1), {
      headers: { 'content-type': 'application/json' },
    }),
    new Response('{}', {
      headers: { 'content-type': 'application/json', 'content-length': '2097153' },
    }),
  ])
    assert.deepEqual(await createSsoUsageClient(async () => response).read(), {
      state: 'unavailable',
    });
});
test('new read and invalidate cancel stale identity even when transport ignores abort', async () => {
  let release: ((response: Response) => void) | undefined;
  let calls = 0;
  const client = createSsoUsageClient(async () =>
    ++calls === 1
      ? new Promise<Response>((resolve) => {
          release = resolve;
        })
      : page([]),
  );
  const stale = client.read();
  assert.equal((await client.read()).state, 'ready');
  assert.deepEqual(await stale, { state: 'cancelled' });
  release?.(page());
  const blocked = createSsoUsageClient(
    async () =>
      new Response(new ReadableStream(), { headers: { 'content-type': 'application/json' } }),
  );
  const pending = blocked.read();
  await new Promise((done) => setImmediate(done));
  blocked.invalidate();
  assert.deepEqual(await pending, { state: 'cancelled' });
});
test('deadline remains bounded for ignored-abort transport', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const result = createSsoUsageClient(() => new Promise<Response>(() => {})).read();
  t.mock.timers.tick(15000);
  assert.deepEqual(await result, { state: 'unavailable' });
});

test('JSON transport uses signed SSO, SQL history and mandatory durable audit', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { createSsoAccessTokenFixture } = await import('./sso-access-token-fixture.ts');
  const { loadPostgresMigrationSources } = await import(
    '../src/storage/postgres-migration-sources.ts'
  );
  const { createPostgresSsoUsageHistoryHandler } = await import(
    '../src/gateway/postgres-sso-usage-history-http.ts'
  );
  const { createPostgresUsageLedger } = await import('../src/usage/postgres-ledger.ts');
  const { buildUsageRecord } = await import('../src/usage/record-usage.ts');
  const jwt = await createSsoAccessTokenFixture();
  const token = await jwt.token();
  const db = new PGlite();
  try {
    for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
    await db.exec(`INSERT INTO iam_principals VALUES ('human', 'human', true);
      INSERT INTO iam_policies VALUES ('reader', 'v1', '[{"effect":"Allow","actions":["usage:ReadSelf"],"resources":["principal:human"]}]');
      INSERT INTO iam_principal_policies VALUES ('human', 'reader');`);
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    const sql = {
      query: (query: string, params: readonly unknown[]) => db.query(query, [...params]),
    };
    await createPostgresUsageLedger(sql)(
      buildUsageRecord({
        principalId: 'human',
        credentialId: 'historical',
        policyVersions: [],
        requestId: 'inference',
        attemptId: 'attempt',
        modelAlias: 'chat',
        routeKind: 'managed',
        upstreamModelId: 'upstream',
        selectedCandidateId: 'candidate',
        occurredAt: 10,
        latencyMs: 2,
        outcome: 'succeeded',
        possiblyBilled: true,
        possibleDuplicate: false,
      }),
    );
    const handler = createPostgresSsoUsageHistoryHandler({
      ...jwt.config,
      client: sql,
      newRequestId: () => 'json-read',
    });
    const client = createSsoUsageClient((path, init) =>
      handler(
        new Request(`https://local.invalid${path}`, {
          ...init,
          headers: { authorization: `Bearer ${token}` },
        }),
      ),
    );
    const result = await client.read({ model: 'chat', fromMs: 0, toMs: 11 });
    assert.equal(result.state, 'ready');
    if (result.state !== 'ready') throw new Error('Expected JSON');
    assert.equal(result.data[0]?.usage.status, 'missing');
    assert.equal(result.data[0]?.upstreamBilledCost, null);
    assert.equal(result.nextCursor, null);
    const audit = await db.query(
      'SELECT outcome, record_count, principal_id FROM sso_usage_audit_events',
    );
    assert.deepEqual(audit.rows, [{ outcome: 'ready', record_count: 1, principal_id: 'human' }]);
    await db.exec("UPDATE iam_principals SET active=false WHERE principal_id='human'");
    assert.deepEqual(await client.read(), { state: 'unauthenticated' });
    const denied = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM sso_usage_audit_events WHERE outcome='unauthenticated' AND record_count=0",
    );
    assert.equal(denied.rows[0]?.n, 1);
    await db.exec(
      "UPDATE iam_principals SET active=true WHERE principal_id='human'; DROP TABLE sso_usage_audit_events",
    );
    assert.deepEqual(await client.read(), { state: 'unavailable' });
  } finally {
    await db.close();
  }
});

test('reported usage preserves decimal cost sources alongside exact comparison', async () => {
  const value = buildUsageRecord({
    ...row(),
    actualInferenceProviderId: undefined,
    providerUsage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    upstreamBilledCost: { amountDecimal: '0.00000100', currency: 'USD', source: 'direct-provider' },
  });
  const result = await createSsoUsageClient(async () => page([value])).read();
  assert.deepEqual(result, {
    state: 'ready',
    data: [
      {
        ...value,
        costComparison: {
          status: 'reported_below_estimate',
          reportedMinusEstimated: '-0.009999',
          currency: 'USD',
        },
      },
    ],
    hasMore: false,
    nextCursor: null,
  });
});

test('JSON rejects complete-looking pages with mismatched identity Content-Length', async () => {
  const text = JSON.stringify({
    object: 'list',
    data: [row('é')],
    has_more: false,
    next_cursor: null,
  });
  const bytes = new TextEncoder().encode(text);
  for (const declared of [bytes.length - 1, bytes.length + 1, text.length, 0]) {
    const response = new Response(bytes, {
      headers: { 'content-type': 'application/json', 'content-length': String(declared) },
    });
    assert.deepEqual(await createSsoUsageClient(async () => response).read(), {
      state: 'unavailable',
    });
  }
});
test('JSON accepts byte-exact UTF8 identity, absent length and compressed decoded pages', async () => {
  const text = JSON.stringify({
    object: 'list',
    data: [row('é')],
    has_more: false,
    next_cursor: null,
  });
  const bytes = new TextEncoder().encode(text);
  const variants: Record<string, string>[] = [
    {},
    { 'content-length': String(bytes.length) },
    { 'content-length': String(bytes.length), 'content-encoding': 'identity' },
    { 'content-length': '1', 'content-encoding': 'gzip' },
    { 'content-length': '1', 'content-encoding': 'br' },
  ];
  for (const extra of variants) {
    const response = new Response(bytes, {
      headers: { 'content-type': 'application/json', ...extra },
    });
    assert.deepEqual(await createSsoUsageClient(async () => response).read(), {
      state: 'ready',
      data: [
        {
          ...row('é'),
          costComparison: { status: 'estimate_only', reportedMinusEstimated: null, currency: null },
        },
      ],
      hasMore: false,
      nextCursor: null,
    });
  }
});

test('pending JSON read preserves its original filter scope after caller mutation', async () => {
  for (const matchesOriginal of [true, false]) {
    const filters = {
      principalId: 'human',
      model: 'chat',
      fromMs: 0,
      toMs: 11,
      limit: 1,
      cursor: cursor(11, 'anchor'),
    };
    let release!: (response: Response) => void;
    let requested = '';
    const client = createSsoUsageClient(async (url) => {
      requested = url;
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    });
    const pending = client.read(filters);
    Object.assign(filters, {
      principalId: 'other',
      model: 'other-model',
      fromMs: 20,
      toMs: 30,
      limit: 2,
      cursor: cursor(30, 'z'),
    });
    release(
      matchesOriginal
        ? page()
        : page([{ ...row('y', 25), principalId: 'other', modelAlias: 'other-model' }]),
    );
    assert.equal(
      new URL(requested, 'https://example.test').searchParams.get('principal_id'),
      'human',
    );
    assert.equal((await pending).state, matchesOriginal ? 'ready' : 'unavailable');
  }
});

test('JSON page size cannot be relaxed while the response is pending', async () => {
  const filters = { limit: 1 };
  let release!: (response: Response) => void;
  const client = createSsoUsageClient(
    async () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  const pending = client.read(filters);
  filters.limit = 2;
  release(page([row('z'), row('a')]));
  assert.equal((await pending).state, 'unavailable');
});

test('JSON read snapshots each allowlisted accessor once', async () => {
  let reads = 0;
  const filters = {
    get principalId() {
      reads++;
      return reads === 1 ? 'human' : 'other';
    },
  };
  const result = await createSsoUsageClient(async () => page()).read(filters);
  assert.equal(result.state, 'ready');
  assert.equal(reads, 1);
});
