import assert from 'node:assert/strict';
import test from 'node:test';
import { createSsoAuditClient } from '../src/management/audit-client.ts';

const event = (eventId = '9007199254740993', principalId = 'human') => ({
  eventId,
  occurredAt: 100,
  kind: 'models-listed',
  requestId: 'request-1',
  principalId,
  credentialId: 'historical',
  policyVersions: [],
  details: { count: 1 },
});
function page(data: unknown[] = [event()], has_more = false, next_cursor: string | null = null) {
  return Response.json({ object: 'list', data, has_more, next_cursor });
}

test('audit browser port serializes filters and reprojects private metadata', async () => {
  let path = '';
  const client = createSsoAuditClient(async (url, init) => {
    path = url;
    assert.equal(init.method, 'GET');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(init.headers, { accept: 'application/json' });
    return page([{ ...event(), secret: 'PRIVATE', details: { count: 1, prompt: 'PRIVATE' } }]);
  });
  assert.deepEqual(
    await client.read({
      principalId: 'human',
      requestId: 'request-1',
      fromMs: 0,
      toMs: 101,
      limit: 1,
    }),
    {
      state: 'ready',
      data: [event()],
      hasMore: false,
      nextCursor: null,
    },
  );
  assert.equal(
    path,
    '/management/v1/audit?format=json&principal_id=human&request_id=request-1&from_ms=0&to_ms=101&limit=1',
  );
});
test('audit empty and exact bigint continuation are preserved', async () => {
  assert.deepEqual(await createSsoAuditClient(async () => page([])).read(), {
    state: 'ready',
    data: [],
    hasMore: false,
    nextCursor: null,
  });
  assert.deepEqual(
    await createSsoAuditClient(async () => page([event()], true, '9007199254740993')).read({
      cursor: '9007199254740994',
      limit: 1,
    }),
    {
      state: 'ready',
      data: [event()],
      hasMore: true,
      nextCursor: '9007199254740993',
    },
  );
});
test('audit filters and order reject every malformed page without partial data', async () => {
  const cases = [
    { data: [event('1', 'other')] },
    { data: [event(), event()] },
    { data: [event('1'), event('2')] },
    { data: [event('0')] },
    { data: [event('9223372036854775808')] },
    { data: [event()], has_more: true, next_cursor: '2' },
    { data: [], has_more: true, next_cursor: '1' },
    { data: [event()], next_cursor: '9007199254740993' },
    { data: [{ ...event(), occurredAt: 200 }] },
    { data: [{ ...event(), requestId: 'wrong' }] },
    { data: [{ ...event(), kind: 'invented' }] },
    { data: [event(), event('1')], has_more: true, next_cursor: '1' },
  ];
  for (const bad of cases) {
    const result = await createSsoAuditClient(async () =>
      Response.json({ object: 'list', has_more: false, next_cursor: null, ...bad }),
    ).read({ principalId: 'human', requestId: 'request-1', fromMs: 0, toMs: 101, limit: 1 });
    assert.deepEqual(result, { state: 'unavailable' }, JSON.stringify(bad));
  }
  assert.equal(
    (await createSsoAuditClient(async () => page([event(), event('1', 'other')])).read()).state,
    'unavailable',
  );
  assert.equal(
    (await createSsoAuditClient(async () => page()).read({ cursor: '9007199254740993' })).state,
    'unavailable',
  );
  assert.equal(
    (await createSsoAuditClient(async () => page()).read({ model: 'absent' })).state,
    'unavailable',
  );
});
test('invalid audit query never calls request and accessor errors fail safely', async () => {
  let calls = 0;
  const client = createSsoAuditClient(async () => {
    calls++;
    return page();
  });
  for (const query of [
    { limit: 0 },
    { limit: 101 },
    { cursor: '01' },
    { cursor: '9223372036854775808' },
    { principalId: 'bad space' },
    { requestId: 'bad space' },
    { model: '\n' },
    { fromMs: 2, toMs: 1 },
    { fromMs: NaN },
  ]) {
    assert.deepEqual(await client.read(query), { state: 'invalid_query' });
  }
  assert.deepEqual(
    await client.read({
      get principalId(): string {
        throw Error('PRIVATE');
      },
    }),
    { state: 'invalid_query' },
  );
  assert.equal(calls, 0);
});
test('caller mutation cannot widen pending audit scope', async () => {
  let respond!: (response: Response) => void;
  const query = { principalId: 'human', requestId: 'request-1', limit: 1 };
  const client = createSsoAuditClient(
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  const result = client.read(query);
  query.principalId = 'other';
  query.requestId = 'other';
  query.limit = 100;
  respond(page());
  assert.equal((await result).state, 'ready');
  const rejected = client.read({ principalId: 'human' });
  respond(page([event('1', 'other')]));
  assert.deepEqual(await rejected, { state: 'unavailable' });
});
test('audit status-only failures cancel unread bodies and discard private causes', async () => {
  for (const [status, state] of [
    [400, 'invalid_query'],
    [401, 'unauthenticated'],
    [403, 'denied'],
    [500, 'unavailable'],
  ] as const) {
    let cancelled = false;
    const result = await createSsoAuditClient(
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
  assert.deepEqual(
    await createSsoAuditClient(async () => {
      throw Error('PRIVATE');
    }).read(),
    { state: 'unavailable' },
  );
});
test('audit JSON validates media, UTF8, decoded bounds and identity byte length', async () => {
  const text = JSON.stringify({ object: 'list', data: [], has_more: false, next_cursor: null });
  for (const response of [
    new Response(text, { headers: { 'content-type': 'text/html' } }),
    new Response(Uint8Array.of(255), { headers: { 'content-type': 'application/json' } }),
    new Response('x'.repeat(2 * 1024 * 1024 + 1), {
      headers: { 'content-type': 'application/json' },
    }),
    new Response(text, { headers: { 'content-type': 'application/json', 'content-length': '0' } }),
    new Response(text, {
      headers: { 'content-type': 'application/json', 'content-length': String(text.length + 1) },
    }),
  ])
    assert.deepEqual(await createSsoAuditClient(async () => response).read(), {
      state: 'unavailable',
    });
  assert.equal(
    (
      await createSsoAuditClient(
        async () =>
          new Response(text, {
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'content-encoding': 'gzip',
              'content-length': '10',
            },
          }),
      ).read()
    ).state,
    'ready',
  );
});
async function promptly<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error('cancellation did not settle')), 500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
test('audit invalidation, supersession and invalid queries cancel uncooperative work', async () => {
  const client = createSsoAuditClient(() => new Promise<Response>(() => {}));
  const pending = client.read();
  client.invalidate();
  assert.deepEqual(await promptly(pending), { state: 'cancelled' });
  const old = client.read();
  assert.deepEqual(await client.read({ limit: 0 }), { state: 'invalid_query' });
  assert.deepEqual(await promptly(old), { state: 'cancelled' });
  let respond!: (response: Response) => void;
  const late = createSsoAuditClient(
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  const result = late.read();
  late.invalidate();
  let discarded = false;
  respond(
    new Response(
      new ReadableStream({
        cancel() {
          discarded = true;
        },
      }),
    ),
  );
  assert.deepEqual(await promptly(result), { state: 'cancelled' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(discarded, true);
});

import { PGlite } from '@electric-sql/pglite';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import { createPostgresSsoAuditHistoryHandler } from '../src/gateway/postgres-sso-audit-history-http.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

test('audit client traverses signed SSO Fetch, migrated SQL, scope denial and mandatory durable audit', async () => {
  const jwt = await createSsoAccessTokenFixture();
  const token = await jwt.token();
  const db = new PGlite();
  try {
    for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
    await db.exec(`INSERT INTO iam_principals VALUES ('human', 'human', true);
      INSERT INTO iam_policies VALUES ('reader', 'v1', '[{"effect":"Allow","actions":["audit:Read"],"resources":["principal:human"]}]');
      INSERT INTO iam_principal_policies VALUES ('human', 'reader');`);
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1, $2, $3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    const queries: string[] = [];
    const sql = {
      query: (query: string, params: readonly unknown[]) => {
        queries.push(query);
        return db.query(query, [...params]);
      },
    };
    const writer = createPostgresGatewayAuditStore(sql, () => 100);
    for (const [principalId, requestId] of [
      ['human', 'first'],
      ['human', 'second'],
      ['other', 'foreign'],
    ] as const) {
      await writer.append({
        kind: 'models-listed',
        principalId,
        requestId,
        credentialId: 'historical',
        policyVersions: [],
        count: 1,
      });
    }
    const handler = createPostgresSsoAuditHistoryHandler({
      ...jwt.config,
      client: sql,
      newRequestId: () => 'browser-audit',
    });
    let credential = token;
    const client = createSsoAuditClient((path, init) =>
      handler(
        new Request(`https://management.test${path}`, {
          ...init,
          headers: { ...init.headers, authorization: `Bearer ${credential}` },
        }),
      ),
    );
    const first = await client.read({ limit: 1 });
    assert.equal(first.state, 'ready');
    if (first.state !== 'ready') throw Error('Missing first page');
    assert.equal(first.data[0]?.requestId, 'second');
    assert.equal(first.hasMore, true);
    assert.equal(first.nextCursor, '2');
    const next = await client.read({ cursor: first.nextCursor ?? undefined, limit: 1 });
    assert.equal(next.state, 'ready');
    if (next.state === 'ready') {
      assert.equal(next.data[0]?.requestId, 'first');
      assert.equal(next.hasMore, false);
    }
    const exact = await client.read({
      principalId: 'human',
      requestId: 'second',
      fromMs: 100,
      toMs: 101,
    });
    assert.equal(exact.state, 'ready');
    if (exact.state === 'ready') assert.equal(exact.data.length, 1);
    const empty = await client.read({ model: 'absent' });
    assert.equal(empty.state, 'ready');
    if (empty.state === 'ready') assert.deepEqual(empty.data, []);
    queries.length = 0;
    assert.deepEqual(await client.read({ principalId: 'other' }), { state: 'denied' });
    assert.ok(!queries.some((query) => query.includes('FROM gateway_audit_events')));
    credential = 'invalid-fixture';
    queries.length = 0;
    assert.deepEqual(await client.read(), { state: 'unauthenticated' });
    assert.ok(!queries.some((query) => query.includes('FROM gateway_audit_events')));
    credential = token;
    const audits = await db.query('SELECT * FROM sso_audit_history_access_events');
    assert.equal(audits.rows.length, 6);
    await db.exec('DROP TABLE sso_audit_history_access_events');
    assert.deepEqual(await client.read(), { state: 'unavailable' });
  } finally {
    await db.close();
  }
});

test('audit deadline is unavailable rather than user cancellation', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const client = createSsoAuditClient(() => new Promise<Response>(() => {}));
  const pending = client.read();
  context.mock.timers.tick(15_000);
  assert.deepEqual(await pending, { state: 'unavailable' });
  context.mock.timers.reset();
});

test('audit cancellation settles while a JSON stream and its cancel hook never finish', async () => {
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  let cancelled = false;
  const client = createSsoAuditClient(
    async () =>
      new Response(
        new ReadableStream({
          pull() {
            started();
            return new Promise<void>(() => {});
          },
          cancel() {
            cancelled = true;
            return new Promise<void>(() => {});
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  const result = client.read();
  await reading;
  client.invalidate();
  assert.deepEqual(await promptly(result), { state: 'cancelled' });
  assert.equal(cancelled, true);
});

test('audit request filter accessors are captured once before asynchronous response validation', async () => {
  let accesses = 0;
  let path = '';
  const result = await createSsoAuditClient(async (url) => {
    path = url;
    return page();
  }).read({
    get principalId() {
      accesses++;
      return accesses === 1 ? 'human' : 'other';
    },
  });
  assert.equal(accesses, 1);
  assert.match(path, /principal_id=human/u);
  assert.equal(result.state, 'ready');
});
