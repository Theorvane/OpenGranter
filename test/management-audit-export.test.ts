import assert from 'node:assert/strict';
import test from 'node:test';
import { createSsoAuditExportClient } from '../src/management/audit-client.ts';

function csv(text = 'event_id,details\r\n1,safe\r\n', headers: Record<string, string> = {}) {
  return new Response(text, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'x-has-more': 'false', ...headers },
  });
}

test('audit CSV public port preserves server bytes and exact serialized filters', async () => {
  let path = '';
  const client = createSsoAuditExportClient(async (url, init) => {
    path = url;
    assert.equal(init.method, 'GET');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(init.headers, { accept: 'text/csv' });
    return csv('event_id,details\r\n9007199254740993,safe\r\n', {
      'x-has-more': 'true',
      'x-next-cursor': '9007199254740993',
    });
  });
  assert.deepEqual(
    await client.read({
      principalId: 'human',
      requestId: 'req',
      model: 'model/a',
      fromMs: 0,
      toMs: 100,
      limit: 1,
      cursor: '9007199254740994',
    }),
    {
      state: 'ready',
      csv: 'event_id,details\r\n9007199254740993,safe\r\n',
      hasMore: true,
      nextCursor: '9007199254740993',
    },
  );
  assert.equal(
    path,
    '/management/v1/audit?format=csv&principal_id=human&request_id=req&model=model%2Fa&cursor=9007199254740994&from_ms=0&to_ms=100&limit=1',
  );
});

test('terminal header-only empty export stays ready', async () => {
  assert.deepEqual(
    await createSsoAuditExportClient(async () => csv('event_id,details\r\n')).read(),
    {
      state: 'ready',
      csv: 'event_id,details\r\n',
      hasMore: false,
      nextCursor: null,
    },
  );
});

test('CSV rejects malformed or nonprogressing exact bigint headers', async () => {
  const invalid = [
    { 'x-has-more': '' },
    { 'x-has-more': 'TRUE' },
    { 'x-has-more': 'false', 'x-next-cursor': '1' },
    ...[
      '',
      '0',
      '-1',
      '01',
      '1e3',
      '9223372036854775808',
      '9007199254740994',
      '9007199254740995',
    ].map((next) => ({ 'x-has-more': 'true', 'x-next-cursor': next })),
    { 'x-has-more': 'true' },
    { 'content-type': 'application/json' },
  ];
  for (const headers of invalid) {
    assert.deepEqual(
      await createSsoAuditExportClient(async () => csv('safe', headers)).read({
        cursor: '9007199254740994',
      }),
      { state: 'unavailable' },
      JSON.stringify(headers),
    );
  }
  const max = await createSsoAuditExportClient(async () =>
    csv('safe', { 'x-has-more': 'true', 'x-next-cursor': '9223372036854775807' }),
  ).read();
  assert.equal(max.state, 'ready');
});

test('CSV query validation performs no request and maps safe HTTP failures', async () => {
  let calls = 0;
  const client = createSsoAuditExportClient(async () => {
    calls++;
    return csv();
  });
  for (const filters of [
    { principalId: ' ' },
    { requestId: '' },
    { model: '' },
    { limit: 0 },
    { fromMs: -1 },
    { fromMs: 2, toMs: 1 },
    { cursor: '0' },
    { cursor: '9223372036854775808' },
  ]) {
    assert.deepEqual(await client.read(filters), { state: 'invalid_query' });
  }
  assert.equal(calls, 0);
  for (const [status, state] of [
    [400, 'invalid_query'],
    [401, 'unauthenticated'],
    [403, 'denied'],
    [404, 'unavailable'],
    [500, 'unavailable'],
  ] as const) {
    assert.deepEqual(
      await createSsoAuditExportClient(async () => new Response('PRIVATE', { status })).read(),
      { state },
    );
  }
  assert.deepEqual(
    await createSsoAuditExportClient(async () => {
      throw Error('PRIVATE');
    }).read(),
    { state: 'unavailable' },
  );
});

test('CSV filter snapshot captures accessors once and resists in-flight mutation', async () => {
  let reads = 0;
  let path = '';
  const filters = {
    get principalId() {
      reads++;
      return reads === 1 ? 'human' : 'other';
    },
    cursor: '9007199254740994',
  };
  const result = await createSsoAuditExportClient(async (url) => {
    path = url;
    filters.cursor = '1';
    return csv('safe', { 'x-has-more': 'true', 'x-next-cursor': '9007199254740993' });
  }).read(filters);
  assert.equal(result.state, 'ready');
  assert.equal(reads, 1);
  assert.match(path, /principal_id=human/u);
  assert.match(path, /cursor=9007199254740994/u);
});

test('CSV bounded UTF-8 rejects malformed, oversized and truncated responses', async () => {
  const response = (body: string | Uint8Array, headers: Record<string, string> = {}) =>
    new Response(body, {
      headers: { 'content-type': 'text/csv', 'x-has-more': 'false', ...headers },
    });
  for (const make of [
    () => response('safe', { 'content-length': '5' }),
    () => response('safe', { 'content-length': '3' }),
    () => response('safe', { 'content-length': '-1' }),
    () => response('safe', { 'content-length': '2097153' }),
    () => response(new Uint8Array([0xc3, 0x28])),
    () => response(new Uint8Array([0xc3])),
    () => response('é'.repeat(1048577)),
  ]) {
    assert.deepEqual(await createSsoAuditExportClient(async () => make()).read(), {
      state: 'unavailable',
    });
  }
  const compressed = await createSsoAuditExportClient(async () =>
    response('é', { 'content-encoding': 'gzip', 'content-length': '99' }),
  ).read();
  assert.equal(compressed.state, 'ready');
  const split = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array([0xc3]));
      c.enqueue(new Uint8Array([0xa9]));
      c.close();
    },
  });
  const result = await createSsoAuditExportClient(
    async () =>
      new Response(split, {
        headers: { 'content-type': 'text/csv', 'x-has-more': 'false', 'content-length': '2' },
      }),
  ).read();
  assert.deepEqual(result, { state: 'ready', csv: 'é', hasMore: false, nextCursor: null });
});

async function promptly<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(Error('Did not settle')), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test('CSV invalidation and supersession settle an uncooperative request', async () => {
  let calls = 0;
  const client = createSsoAuditExportClient(() =>
    ++calls === 1 ? new Promise<Response>(() => {}) : Promise.resolve(csv()),
  );
  const old = client.read();
  const current = client.read();
  assert.deepEqual(await promptly(old), { state: 'cancelled' });
  assert.equal((await current).state, 'ready');
  const stuck = createSsoAuditExportClient(() => new Promise<Response>(() => {}));
  const pending = stuck.read();
  stuck.invalidate();
  assert.deepEqual(await promptly(pending), { state: 'cancelled' });
});

test('CSV deadline remains unavailable, and a stuck body cancel hook cannot block invalidation', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const client = createSsoAuditExportClient(() => new Promise<Response>(() => {}));
  const pending = client.read();
  context.mock.timers.tick(15000);
  assert.deepEqual(await pending, { state: 'unavailable' });
  context.mock.timers.reset();
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  let cancelled = false;
  const stuck = createSsoAuditExportClient(
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
        { headers: { 'content-type': 'text/csv', 'x-has-more': 'false' } },
      ),
  );
  const result = stuck.read();
  await reading;
  stuck.invalidate();
  assert.deepEqual(await promptly(result), { state: 'cancelled' });
  assert.equal(cancelled, true);
});

import { PGlite } from '@electric-sql/pglite';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import { createPostgresSsoAuditHistoryHandler } from '../src/gateway/postgres-sso-audit-history-http.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

test('CSV traverses real signed SSO Fetch, migrated SQL, redaction and mandatory durable access audit', async () => {
  const jwt = await createSsoAccessTokenFixture();
  const token = await jwt.token();
  const db = new PGlite();
  try {
    for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
    await db.exec(`INSERT INTO iam_principals VALUES ('human','human',true);
      INSERT INTO iam_policies VALUES ('reader','v1','[{"effect":"Allow","actions":["audit:Read"],"resources":["principal:human"]}]');
      INSERT INTO iam_principal_policies VALUES ('human','reader');`);
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
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
    await db.query('UPDATE gateway_audit_events SET details = $1::jsonb', [
      JSON.stringify({ count: 1, prompt: 'PRIVATE', upstreamKey: 'PRIVATE' }),
    ]);
    const handler = createPostgresSsoAuditHistoryHandler({
      ...jwt.config,
      client: sql,
      newRequestId: () => 'browser-csv',
    });
    let credential = token;
    const client = createSsoAuditExportClient((path, init) =>
      handler(
        new Request(`https://management.test${path}`, {
          ...init,
          headers: { ...init.headers, authorization: `Bearer ${credential}` },
        }),
      ),
    );
    const first = await client.read({ limit: 1 });
    assert.equal(first.state, 'ready');
    if (first.state !== 'ready') throw Error('Missing page');
    assert.match(first.csv, /second/u);
    assert.doesNotMatch(first.csv, /foreign|first|PRIVATE|prompt|upstreamKey/u);
    assert.equal(first.hasMore, true);
    assert.equal(first.nextCursor, '2');
    const next = await client.read({ limit: 1, cursor: first.nextCursor ?? undefined });
    assert.equal(next.state, 'ready');
    if (next.state === 'ready') {
      assert.match(next.csv, /first/u);
      assert.equal(next.hasMore, false);
    }
    const empty = await client.read({ model: 'absent' });
    assert.equal(empty.state, 'ready');
    if (empty.state === 'ready') assert.equal(empty.csv.split('\r\n').length, 2);
    const exact = await client.read({
      principalId: 'human',
      requestId: 'second',
      fromMs: 100,
      toMs: 101,
    });
    assert.equal(exact.state, 'ready');
    if (exact.state === 'ready') {
      assert.match(exact.csv, /second/u);
      assert.doesNotMatch(exact.csv, /FORMULA/u);
    }
    queries.length = 0;
    assert.deepEqual(await client.read({ principalId: 'other' }), { state: 'denied' });
    assert.ok(!queries.some((q) => q.includes('FROM gateway_audit_events')));
    credential = 'invalid-fixture';
    queries.length = 0;
    assert.deepEqual(await client.read(), { state: 'unauthenticated' });
    assert.ok(!queries.some((q) => q.includes('FROM gateway_audit_events')));
    const access = await db.query('SELECT * FROM sso_audit_history_access_events');
    assert.equal(access.rows.length, 6);
    credential = token;
    await db.exec('DROP TABLE sso_audit_history_access_events');
    assert.deepEqual(await client.read(), { state: 'unavailable' });
  } finally {
    await db.close();
  }
});
