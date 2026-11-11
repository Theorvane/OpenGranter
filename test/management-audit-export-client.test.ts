import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeAuditCsv } from '../src/audit/csv.ts';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createAuditPageExportClient } from '../src/management/audit-export-client.ts';

const event = (eventId = '9007199254740993') => ({
  eventId,
  occurredAt: 1000,
  kind: 'models-listed',
  requestId: 'request-1',
  principalId: 'person-1',
  credentialId: 'credential-1',
  policyVersions: [],
  details: { count: 1 },
});
const filters = { principalId: 'person-1', limit: 1 };
const page = (data: unknown[] = [event()], next: string | null = null) =>
  Response.json({ object: 'list', data, has_more: next !== null, next_cursor: next });

test('one authorized metadata page projects safe CSV with exact decimal continuation', async () => {
  const paths: string[] = [];
  const client = createAuditPageExportClient(async (path) => {
    paths.push(path);
    return page(
      [{ ...event(), prompt: 'PRIVATE', details: { count: 1, token: 'PRIVATE' } }],
      event().eventId,
    );
  });
  const result = await client.read(filters);
  assert.equal(result.state, 'ready');
  if (result.state !== 'ready') throw new Error('Missing export');
  assert.equal(
    result.csv,
    serializeAuditCsv({ events: [event()], nextCursor: event().eventId }, 'person-1', {
      limit: 1,
      cursor: null,
    }),
  );
  assert.equal(result.contentType, 'text/csv; charset=utf-8');
  assert.equal(result.nextCursor, event().eventId);
  assert.equal(result.hasMore, true);
  assert.ok(result.csv.includes('request-1'));
  assert.ok(!result.csv.includes('PRIVATE'));
  assert.deepEqual(paths, ['/v1/audit?format=json&principal_id=person-1&limit=1']);
});

test('empty page is a header only, no invented rows', async () => {
  const result = await createAuditPageExportClient(async () => page([])).read(filters);
  assert.equal(result.state, 'ready');
  if (result.state === 'ready') {
    assert.equal(result.csv.split('\r\n').length, 2);
    assert.equal(result.hasMore, false);
    assert.equal(result.nextCursor, null);
  }
});

test('snapshots all filters and preserves exact continuation across await', async () => {
  let complete: ((response: Response) => void) | undefined;
  let path = '';
  const client = createAuditPageExportClient((url) => {
    path = url;
    return new Promise<Response>((resolve) => {
      complete = resolve;
    });
  });
  const query = { ...filters, fromMs: 0, toMs: 1001, cursor: '9007199254740994' };
  const pending = client.read(query);
  query.principalId = 'other';
  query.fromMs = 1001;
  query.cursor = '1';
  query.limit = 100;
  complete?.(page());
  const result = await pending;
  assert.equal(result.state, 'ready');
  assert.ok(path.includes('cursor=9007199254740994'));
  assert.ok(path.includes('principal_id=person-1'));
  if (result.state === 'ready') assert.ok(result.csv.includes('person-1'));
});

test('invalid filters, denied and failures never return CSV or private bodies', async () => {
  let calls = 0;
  const invalid = createAuditPageExportClient(async () => {
    calls++;
    return page();
  });
  assert.deepEqual(await invalid.read({ principalId: '' }), { state: 'invalid_query' });
  assert.equal(calls, 0);
  for (const [status, state] of [
    [400, 'invalid_query'],
    [401, 'unauthenticated'],
    [403, 'denied'],
    [500, 'unavailable'],
  ] as const) {
    assert.deepEqual(
      await createAuditPageExportClient(async () => new Response('PRIVATE', { status })).read(
        filters,
      ),
      { state },
    );
  }
  assert.deepEqual(
    await createAuditPageExportClient(async () =>
      page([{ ...event(), principalId: 'other' }]),
    ).read(filters),
    { state: 'unavailable' },
  );
});

test('invalidate and supersession settle without a late CSV result', async () => {
  let finish: ((response: Response) => void) | undefined;
  let first = true;
  const client = createAuditPageExportClient(() => {
    if (!first) return Promise.resolve(page([]));
    first = false;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  const old = client.read(filters);
  const current = client.read(filters);
  assert.deepEqual(await old, { state: 'cancelled' });
  assert.equal((await current).state, 'ready');
  finish?.(page());
  const hanging = createAuditPageExportClient(() => new Promise<Response>(() => {}));
  const pending = hanging.read(filters);
  hanging.invalidate();
  assert.deepEqual(await pending, { state: 'cancelled' });
});

test('gateway enforces read policy and mandatory read audit before local export', async () => {
  for (const mode of ['allow', 'deny', 'audit-failure'] as const) {
    let reads = 0;
    let audits = 0;
    const unexpected = async (): Promise<never> => {
      throw new Error('Unexpected inference');
    };
    const handler = createChatHandler({
      newRequestId: () => 'export-read',
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
      listAudit: async () => {
        reads++;
        return { events: [event()], nextCursor: null };
      },
      writeAudit: async () => {
        audits++;
        if (mode === 'audit-failure') throw new Error('PRIVATE');
      },
    });
    const client = createAuditPageExportClient((path, init) =>
      handler(
        new Request(`http://localhost${path}`, {
          ...init,
          headers: { ...init.headers, authorization: 'Bearer test-only' },
        }),
      ),
    );
    const result = await client.read(filters);
    assert.equal(
      result.state,
      mode === 'allow' ? 'ready' : mode === 'deny' ? 'denied' : 'unavailable',
    );
    assert.equal(reads, mode === 'deny' ? 0 : 1);
    assert.equal(audits, 1);
  }
});

test('invalid formula-like identifiers are denied by the existing metadata projector', async () => {
  assert.deepEqual(
    await createAuditPageExportClient(async () =>
      page([{ ...event(), requestId: '=formula' }]),
    ).read(filters),
    { state: 'unavailable' },
  );
});

test('migrated SQL audit metadata exports through HTTP with scoped continuation and fresh revocation', async () => {
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
    const client = createAuditPageExportClient((path, init) =>
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
    assert.ok(first.csv.includes('second'));
    assert.ok(!first.csv.includes('hidden'));
    const next = await client.read({ ...filters, toMs: 1500, limit: 1, cursor: first.nextCursor });
    assert.equal(next.state, 'ready');
    if (next.state === 'ready') {
      assert.ok(next.csv.includes('first'));
      assert.ok(!next.csv.includes('hidden'));
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
