import assert from 'node:assert/strict';
import test from 'node:test';
import { createSsoUsageHistoryHandler } from '../src/gateway/sso-usage-history-http.ts';
import { createSsoUsageExportClient } from '../src/management/usage-export-client.ts';

const cursor = btoa(JSON.stringify([12, 'attempt'])).replace(/=+$/u, '');
function csv(body = 'request_id\r\n', more = false, next: string | null = null) {
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'x-has-more': String(more),
      ...(next === null ? {} : { 'x-next-cursor': next }),
    },
  });
}
test('export uses real Fetch boundary and preserves CSV and continuation without credentials', async () => {
  const handler = createSsoUsageHistoryHandler({
    newRequestId: () => 'server-id',
    history: {
      read: async (token, requestId, query) => {
        assert.equal(token, 'trusted');
        assert.equal(requestId, 'server-id');
        const params = new URLSearchParams(query);
        assert.equal(params.get('format'), 'csv');
        assert.equal(params.get('model'), 'team/a&b');
        assert.equal(params.get('principal_id'), 'human');
        assert.equal(params.get('from_ms'), '0');
        assert.equal(params.get('to_ms'), '42');
        assert.equal(params.get('limit'), '10');
        assert.equal(params.get('cursor'), cursor);
        return {
          state: 'ready',
          format: 'csv',
          csv: 'usage_status,estimated_amount\r\nmissing,\r\n',
          hasMore: true,
          nextCursor: cursor,
        };
      },
    },
  });
  const client = createSsoUsageExportClient(async (path, init) => {
    assert.equal(init.method, 'GET');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(init.headers, { accept: 'text/csv' });
    assert.equal(init.body, undefined);
    return handler(
      new Request(`https://local.invalid${path}`, {
        ...init,
        headers: { authorization: 'Bearer trusted' },
      }),
    );
  });
  assert.deepEqual(
    await client.read({
      principalId: 'human',
      model: 'team/a&b',
      fromMs: 0,
      toMs: 42,
      limit: 10,
      cursor,
    }),
    {
      state: 'ready',
      csv: 'usage_status,estimated_amount\r\nmissing,\r\n',
      hasMore: true,
      nextCursor: cursor,
    },
  );
});
test('empty export is ready and no principal is invented for self view', async () => {
  const client = createSsoUsageExportClient(async (path) => {
    assert.equal(path, '/management/v1/usage?format=csv');
    return csv();
  });
  assert.deepEqual(await client.read(), {
    state: 'ready',
    csv: 'request_id\r\n',
    hasMore: false,
    nextCursor: null,
  });
});
test('fixed status states never return private server errors', async () => {
  for (const [status, state] of [
    [400, 'invalid_query'],
    [401, 'unauthenticated'],
    [403, 'denied'],
    [404, 'unavailable'],
    [503, 'unavailable'],
    [302, 'unavailable'],
  ] as const) {
    assert.deepEqual(
      await createSsoUsageExportClient(async () => new Response('private', { status })).read(),
      { state },
    );
  }
});
test('malformed filters never reach transport', async () => {
  let calls = 0;
  const client = createSsoUsageExportClient(async () => {
    calls++;
    return csv();
  });
  for (const filters of [
    { principalId: '' },
    { principalId: 'x\n' },
    { model: '' },
    { model: 'x\u0085' },
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { fromMs: -1 },
    { fromMs: 3, toMs: 3 },
    { cursor: 'abc?' },
    { cursor: btoa('[0,""]') },
    { cursor: btoa('[0,"x"]').replace(/=+$/u, '') + 'A' },
  ]) {
    assert.deepEqual(await client.read(filters), { state: 'invalid_query' });
  }
  assert.equal(calls, 0);
});
test('inconsistent pagination or media type fails closed', async () => {
  for (const headers of [
    {},
    { 'content-type': 'text/html', 'x-has-more': 'false' },
    { 'content-type': 'text/csv', 'x-has-more': 'yes' },
    { 'content-type': 'text/csv', 'x-has-more': 'true' },
    { 'content-type': 'text/csv', 'x-has-more': 'false', 'x-next-cursor': cursor },
    { 'content-type': 'text/csv', 'x-has-more': 'true', 'x-next-cursor': 'abc?' },
  ]) {
    assert.deepEqual(
      await createSsoUsageExportClient(async () => new Response('private', { headers })).read(),
      { state: 'unavailable' },
    );
  }
});
test('oversized and malformed UTF8 streams fail closed', async () => {
  for (const body of [new Uint8Array(2 * 1024 * 1024 + 1), new Uint8Array([0xff])]) {
    assert.deepEqual(
      await createSsoUsageExportClient(
        async () =>
          new Response(body, { headers: { 'content-type': 'text/csv', 'x-has-more': 'false' } }),
      ).read(),
      { state: 'unavailable' },
    );
  }
});
test('invalidate resolves even when transport ignores AbortSignal and cancels late body', async () => {
  let resolve!: (response: Response) => void;
  let cancelled = false;
  const client = createSsoUsageExportClient(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  const pending = client.read();
  client.invalidate();
  assert.deepEqual(await pending, { state: 'cancelled' });
  resolve(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
    ),
  );
  await new Promise((done) => setImmediate(done));
  assert.equal(cancelled, true);
});
test('newer read supersedes old one and stalled body invalidation cancels it', async () => {
  let cancelled = false;
  let calls = 0;
  const client = createSsoUsageExportClient(async () =>
    ++calls === 1
      ? new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { 'content-type': 'text/csv', 'x-has-more': 'false' } },
        )
      : csv(),
  );
  const old = client.read();
  await new Promise((done) => setImmediate(done));
  assert.equal((await client.read()).state, 'ready');
  assert.deepEqual(await old, { state: 'cancelled' });
  assert.equal(cancelled, true);
});

test('deadline resolves unavailable when request never settles', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = createSsoUsageExportClient(() => new Promise<Response>(() => undefined));
  const result = client.read();
  t.mock.timers.tick(15_000);
  assert.deepEqual(await result, { state: 'unavailable' });
});
test('oversized declared body cancels before consuming and ignores cancellation rejection', async () => {
  let cancelled = false;
  const client = createSsoUsageExportClient(
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
            return Promise.reject(new Error('private'));
          },
        }),
        {
          headers: {
            'content-type': 'text/csv',
            'x-has-more': 'false',
            'content-length': '2097153',
          },
        },
      ),
  );
  assert.deepEqual(await client.read(), { state: 'unavailable' });
  assert.equal(cancelled, true);
});
test('UTF8 split across chunks is preserved; body limit is inclusive', async () => {
  const bytes = new TextEncoder().encode('模型');
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 1));
        controller.enqueue(bytes.subarray(1));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/csv', 'x-has-more': 'false' } },
  );
  assert.deepEqual(await createSsoUsageExportClient(async () => response).read(), {
    state: 'ready',
    csv: '模型',
    hasMore: false,
    nextCursor: null,
  });
  assert.equal(
    (await createSsoUsageExportClient(async () => csv('x'.repeat(2 * 1024 * 1024))).read()).state,
    'ready',
  );
});
test('invalid new filter supersedes an existing valid export and transport failure stays private', async () => {
  const client = createSsoUsageExportClient(() => new Promise<Response>(() => undefined));
  const old = client.read();
  assert.deepEqual(await client.read({ limit: 0 }), { state: 'invalid_query' });
  assert.deepEqual(await old, { state: 'cancelled' });
  assert.deepEqual(
    await createSsoUsageExportClient(async () => {
      throw new Error('private');
    }).read(),
    { state: 'unavailable' },
  );
});

test('CSV transport reads signed-SSO SQL history and observes fresh Deny', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { createSsoAccessTokenFixture } = await import('./sso-access-token-fixture.ts');
  const { loadPostgresMigrationSources } = await import(
    '../src/storage/postgres-migration-sources.ts'
  );
  const { createPostgresSsoUsageHistory } = await import(
    '../src/gateway/postgres-sso-usage-history.ts'
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
    const events: import('../src/gateway/postgres-sso-usage-history.ts').SsoUsageAuditEvent[] = [];
    const handler = createSsoUsageHistoryHandler({
      newRequestId: () => 'export',
      history: createPostgresSsoUsageHistory({
        ...jwt.config,
        client: sql,
        writeAudit: async (event) => {
          events.push(event);
        },
      }),
    });
    const client = createSsoUsageExportClient((path, init) =>
      handler(
        new Request(`https://local.invalid${path}`, {
          ...init,
          headers: { authorization: `Bearer ${token}` },
        }),
      ),
    );
    const result = await client.read({ model: 'chat', fromMs: 0, toMs: 11 });
    assert.equal(result.state, 'ready');
    if (result.state !== 'ready') throw new Error('Expected CSV');
    assert.match(result.csv, /usage_status/u);
    assert.match(result.csv, /missing/u);
    assert.equal(result.nextCursor, null);
    assert.equal(events.at(-1)?.count, 1);
    assert.equal(events.at(-1)?.principalId, 'human');
    await db.exec("UPDATE iam_principals SET active=false WHERE principal_id='human'");
    assert.deepEqual(await client.read(), { state: 'unauthenticated' });
    assert.equal(events.at(-1)?.outcome, 'unauthenticated');
  } finally {
    await db.close();
  }
});

test('export preserves a supplied UTF-8 BOM across byte chunks without inserting one', async () => {
  const text = '\uFEFFmodel,cost\r\n한국어,\uFEFFunknown\r\n';
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const response = new Response(stream, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'x-has-more': 'false',
    },
  });
  const result = await createSsoUsageExportClient(async () => response).read();
  assert.equal(result.state, 'ready');
  if (result.state !== 'ready') throw new Error('Expected CSV');
  assert.equal(result.csv, text);
  assert.deepEqual(new TextEncoder().encode(result.csv), bytes);
  const ordinary = 'model,cost\r\n한국어,unknown\r\n';
  const plain = await createSsoUsageExportClient(async () => csv(ordinary)).read();
  assert.deepEqual(plain, { state: 'ready', csv: ordinary, hasMore: false, nextCursor: null });
});

test('BOM preservation retains strict rejection of a truncated UTF-8 sequence', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.of(0xef, 0xbb, 0xbf, 0xe2));
      controller.close();
    },
  });
  const result = await createSsoUsageExportClient(
    async () =>
      new Response(body, {
        headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
      }),
  ).read();
  assert.deepEqual(result, { state: 'unavailable' });
  assert.equal(JSON.stringify(result).includes('\uFEFF'), false);
});
