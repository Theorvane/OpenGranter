import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createAuditHistoryClient } from '../src/management/audit-client.ts';

const event = (eventId = '9007199254740993') => ({
  eventId,
  occurredAt: 1000,
  kind: 'models-listed',
  requestId: 'read-1',
  principalId: 'person-1',
  credentialId: 'credential-1',
  policyVersions: [{ id: 'policy-1', version: 'v1' }],
  details: { count: 1 },
});
const filters = { principalId: 'person-1' };
const page = (data: unknown[] = [event()], next_cursor: string | null = null) =>
  Response.json({ object: 'list', data, has_more: next_cursor !== null, next_cursor });

test('explicit principal, safe transport and lossless event IDs with allowlisted metadata', async () => {
  const client = createAuditHistoryClient(async (path, init) => {
    assert.equal(path, '/v1/audit?format=json&principal_id=person-1&from_ms=0&to_ms=2000&limit=1');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(init.headers, { accept: 'application/json' });
    return page(
      [{ ...event(), prompt: 'PRIVATE', details: { count: 1, prompt: 'PRIVATE' } }],
      event().eventId,
    );
  });
  assert.deepEqual(await client.read({ ...filters, fromMs: 0, toMs: 2000, limit: 1 }), {
    state: 'ready',
    data: [event()],
    hasMore: true,
    nextCursor: event().eventId,
  });
});
test('empty is ready and decimal cursor compares exactly above safe integer range', async () => {
  assert.equal((await createAuditHistoryClient(async () => page([])).read(filters)).state, 'ready');
  assert.equal(
    (
      await createAuditHistoryClient(async () => page([event('9007199254740992')])).read({
        ...filters,
        cursor: event().eventId,
      })
    ).state,
    'ready',
  );
  assert.equal(
    (
      await createAuditHistoryClient(async () => page()).read({
        ...filters,
        cursor: event().eventId,
      })
    ).state,
    'unavailable',
  );
});
test('invalid target/query is rejected before transport', async () => {
  let calls = 0;
  const client = createAuditHistoryClient(async () => {
    calls++;
    return page();
  });
  for (const bad of [
    { principalId: '' },
    { principalId: 'a b' },
    { ...filters, cursor: '01' },
    { ...filters, cursor: '9223372036854775808' },
    { ...filters, limit: 101 },
    { ...filters, fromMs: 3, toMs: 2 },
    { ...filters, model: '\n' },
  ])
    assert.equal((await client.read(bad)).state, 'invalid_query');
  assert.equal(calls, 0);
});
test('malformed, unordered, inconsistent and cross-principal pages fail closed', async () => {
  for (const body of [
    { object: 'wrong', data: [], has_more: false, next_cursor: null },
    { object: 'list', data: [], has_more: true, next_cursor: '1' },
    { object: 'list', data: [event()], has_more: false, next_cursor: '1' },
    { object: 'list', data: [event()], has_more: true, next_cursor: '1' },
    { object: 'list', data: [event(), event()], has_more: false, next_cursor: null },
    {
      object: 'list',
      data: [{ ...event(), principalId: 'other' }],
      has_more: false,
      next_cursor: null,
    },
    {
      object: 'list',
      data: [{ ...event(), details: { count: -1 } }],
      has_more: false,
      next_cursor: null,
    },
  ])
    assert.equal(
      (await createAuditHistoryClient(async () => Response.json(body)).read(filters)).state,
      'unavailable',
    );
  assert.equal(
    (await createAuditHistoryClient(async () => page()).read({ ...filters, model: 'chat' })).state,
    'unavailable',
  );
  assert.equal(
    (await createAuditHistoryClient(async () => page()).read({ ...filters, fromMs: 1001 })).state,
    'unavailable',
  );
});
test('HTTP failures never reveal private error bodies', async () => {
  for (const [status, state] of [
    [400, 'invalid_query'],
    [401, 'unauthenticated'],
    [403, 'denied'],
    [500, 'unavailable'],
  ] as const) {
    assert.deepEqual(
      await createAuditHistoryClient(async () => new Response('PRIVATE', { status })).read(filters),
      { state },
    );
  }
});
test('invalid media, length, UTF8 and streaming overflow fail closed', async () => {
  for (const response of [
    new Response('{}'),
    new Response('{}', {
      headers: { 'content-type': 'application/json', 'content-length': '2097153' },
    }),
    new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }),
    new Response('x'.repeat(2097153), { headers: { 'content-type': 'application/json' } }),
  ])
    assert.equal(
      (await createAuditHistoryClient(async () => response).read(filters)).state,
      'unavailable',
    );
});
test('invalidation resolves even an uncooperative transport and suppresses stale completion', async () => {
  let finish: (value: Response) => void = () => {};
  const client = createAuditHistoryClient(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = client.read(filters);
  client.invalidate();
  assert.deepEqual(await pending, { state: 'cancelled' });
  finish(page());
});
test('new read supersedes previous read and snapshots filters before await', async () => {
  let finish: (value: Response) => void = () => {};
  let calls = 0;
  const client = createAuditHistoryClient(async () =>
    ++calls === 1
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : page(),
  );
  const first = client.read(filters);
  const second = client.read(filters);
  assert.equal((await first).state, 'cancelled');
  assert.equal((await second).state, 'ready');
  finish(page());
  const mutable = { ...filters };
  const copyClient = createAuditHistoryClient(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = copyClient.read(mutable);
  mutable.principalId = 'other';
  finish(page());
  assert.equal((await pending).state, 'ready');
});
test('public Fetch handler enforces IAM and mandatory audit without inference', async () => {
  for (const mode of ['allow', 'deny', 'audit-failure'] as const) {
    let reads = 0;
    let audits = 0;
    const unexpected = async (): Promise<never> => {
      throw new Error('Unexpected inference');
    };
    const handler = createChatHandler({
      newRequestId: () => 'audit-read-1',
      authenticate: async () => ({
        id: 'person-1',
        active: true,
        credentialId: 'credential-1',
        policyVersions: [],
        statements:
          mode === 'deny'
            ? []
            : [{ effect: 'Allow', actions: ['audit:Read'], resources: ['principal:person-1'] }],
      }),
      resolveRoute: unexpected,
      checkLimit: unexpected,
      resolveSecret: unexpected,
      writeUsage: unexpected,
      invokeDirect: unexpected,
      writeAudit: async () => {
        audits++;
        if (mode === 'audit-failure') throw new Error('PRIVATE');
      },
      listAudit: async () => {
        reads++;
        return { events: [event()], nextCursor: null };
      },
    });
    const client = createAuditHistoryClient((path, init) =>
      handler(
        new Request(`http://localhost${path}`, {
          ...init,
          headers: { ...init.headers, authorization: 'Bearer test-only' },
        }),
      ),
    );
    assert.equal(
      (await client.read(filters)).state,
      mode === 'allow' ? 'ready' : mode === 'deny' ? 'denied' : 'unavailable',
    );
    assert.equal(reads, mode === 'deny' ? 0 : 1);
    assert.equal(audits, 1);
  }
});

test('timeout and hanging response body settle safely', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const client = createAuditHistoryClient(() => new Promise<Response>(() => {}));
  const pending = client.read(filters);
  context.mock.timers.tick(15_000);
  assert.deepEqual(await pending, { state: 'unavailable' });
  const bodyClient = createAuditHistoryClient(
    async () =>
      new Response(new ReadableStream(), { headers: { 'content-type': 'application/json' } }),
  );
  const bodyRead = bodyClient.read(filters);
  await Promise.resolve();
  bodyClient.invalidate();
  assert.deepEqual(await bodyRead, { state: 'cancelled' });
});

test('migrated SQL history flows through HTTP with scoped pagination and fresh revocation', async () => {
  const { readFile } = await import('node:fs/promises');
  const { PGlite } = await import('@electric-sql/pglite');
  const { createPostgresGatewayAuditStore } = await import(
    '../src/audit/postgres-gateway-audit.ts'
  );
  const { createPostgresAuditHistoryReader } = await import(
    '../src/audit/postgres-audit-history.ts'
  );
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL('../migrations/003_gateway_audit.sql', import.meta.url), 'utf8'),
    );
    const sql = {
      query: (text: string, params: readonly unknown[]) => db.query(text, [...params]),
    };
    const writer = createPostgresGatewayAuditStore(sql, () => 1000);
    for (const [principalId, requestId] of [
      ['person-1', 'first'],
      ['person-1', 'second'],
      ['other', 'hidden'],
    ] as const)
      await writer.append({
        kind: 'models-listed',
        principalId,
        requestId,
        credentialId: 'credential-1',
        policyVersions: [],
        count: 1,
      });
    const auditWriter = createPostgresGatewayAuditStore(sql, () => 2000);
    let allowed = true;
    let auditAvailable = true;
    const unexpected = async (): Promise<never> => {
      throw new Error('Unexpected inference');
    };
    const handler = createChatHandler({
      newRequestId: () => 'http-read',
      authenticate: async () => ({
        id: 'person-1',
        active: true,
        credentialId: 'credential-1',
        policyVersions: [],
        statements: allowed
          ? [{ effect: 'Allow', actions: ['audit:Read'], resources: ['principal:person-1'] }]
          : [],
      }),
      resolveRoute: unexpected,
      checkLimit: unexpected,
      resolveSecret: unexpected,
      writeUsage: unexpected,
      invokeDirect: unexpected,
      listAudit: createPostgresAuditHistoryReader(sql),
      writeAudit: async (input) => {
        if (!auditAvailable) throw new Error('PRIVATE');
        await auditWriter.append(input);
      },
    });
    const client = createAuditHistoryClient((path, init) =>
      handler(
        new Request(`http://localhost${path}`, {
          ...init,
          headers: { ...init.headers, authorization: 'Bearer test-only' },
        }),
      ),
    );
    const first = await client.read({ ...filters, toMs: 1500, limit: 1 });
    assert.equal(first.state, 'ready');
    if (first.state !== 'ready' || !first.nextCursor) throw new Error('Missing first page');
    assert.equal(first.data[0]?.requestId, 'second');
    const next = await client.read({ ...filters, toMs: 1500, limit: 1, cursor: first.nextCursor });
    assert.equal(next.state, 'ready');
    if (next.state === 'ready') {
      assert.equal(next.data[0]?.requestId, 'first');
      assert.equal(next.hasMore, false);
    }
    assert.equal((await client.read({ principalId: 'other' })).state, 'denied');
    allowed = false;
    assert.equal((await client.read(filters)).state, 'denied');
    allowed = true;
    auditAvailable = false;
    assert.equal((await client.read(filters)).state, 'unavailable');
    const stored = await db.query<{ kind: string }>(
      'SELECT kind FROM gateway_audit_events WHERE occurred_at_ms = 2000',
    );
    assert.equal(stored.rows.filter((r) => r.kind === 'audit-history-read').length, 2);
    assert.equal(stored.rows.filter((r) => r.kind === 'audit-history-read-denied').length, 2);
  } finally {
    await db.close();
  }
});
