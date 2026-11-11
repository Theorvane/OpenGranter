import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createAuditHistoryClient } from '../src/management/audit-client.ts';
import { createAuditPageExportClient } from '../src/management/audit-export-client.ts';

const target = 'Trace+run:/@-1';
const filters = { principalId: 'human', requestId: target, fromMs: 100, toMs: 101, limit: 1 };
const event = (requestId = target) => ({
  eventId: '8',
  occurredAt: 100,
  kind: 'models-listed',
  requestId,
  principalId: 'human',
  credentialId: 'cred',
  policyVersions: [],
  details: { count: 1 },
});
const page = (requestId = target) =>
  Response.json({ object: 'list', data: [event(requestId)], has_more: false, next_cursor: null });
for (const [name, create] of [
  ['json', createAuditHistoryClient],
  ['csv', createAuditPageExportClient],
] as const) {
  test(`${name} sends exact encoded request filter and rejects foreign rows`, async () => {
    const paths: string[] = [];
    const client = create(async (path) => {
      paths.push(path);
      return page();
    });
    assert.equal((await client.read(filters)).state, 'ready');
    assert.ok(paths[0]);
    const url = new URL(paths[0], 'https://local');
    assert.equal(url.searchParams.get('request_id'), target);
    assert.equal(url.searchParams.get('principal_id'), 'human');
    for (const wrong of ['other', target.toLowerCase()]) {
      assert.deepEqual(await create(async () => page(wrong)).read(filters), {
        state: 'unavailable',
      });
    }
  });
  test(`${name} rejects invalid request identifiers before transport`, async () => {
    let calls = 0;
    const client = create(async () => {
      calls++;
      return page();
    });
    for (const requestId of ['', 'a b', 'é', '\n', 'a'.repeat(257), 4, null]) {
      assert.deepEqual(await client.read({ ...filters, requestId } as never), {
        state: 'invalid_query',
      });
    }
    assert.equal(calls, 0);
  });
  test(`${name} binds validation to original pending scalar filters`, async () => {
    let release!: (value: Response) => void;
    const input = { ...filters };
    const client = create(
      async () =>
        new Promise<Response>((r) => {
          release = r;
        }),
    );
    const pending = client.read(input);
    input.requestId = 'mutated';
    release(page());
    assert.equal((await pending).state, 'ready');
    const pendingWrong = client.read({ ...filters });
    release(page('mutated'));
    assert.deepEqual(await pendingWrong, { state: 'unavailable' });
  });
  test(`${name} reads request accessor exactly once`, async () => {
    let reads = 0;
    const input = {
      ...filters,
      get requestId() {
        reads++;
        return reads === 1 ? target : 'mutated';
      },
    };
    const result = await create(async () => page()).read(input);
    assert.equal(result.state, 'ready');
    assert.equal(reads, 1);
  });
}

test('exact request CSV exports intersect real SQL/HTTP scope and continuation', async () => {
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
      ['human', target],
      ['human', 'other-request'],
      ['human', target],
      ['other', target],
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
        id: 'human',
        active: true,
        credentialId: 'credential-1',
        policyVersions: [],
        statements: allowed
          ? [{ effect: 'Allow', actions: ['audit:Read'], resources: ['principal:human'] }]
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
    const first = await client.read({ ...filters, fromMs: 0, toMs: 1500, limit: 1 });
    assert.equal(first.state, 'ready');
    if (first.state !== 'ready' || !first.nextCursor) throw new Error('Missing first page');
    assert.ok(first.csv.includes(target));
    assert.ok(!first.csv.includes('other-request'));
    assert.ok(!first.csv.includes('hidden'));
    const next = await client.read({
      ...filters,
      fromMs: 0,
      toMs: 1500,
      limit: 1,
      cursor: first.nextCursor,
    });
    assert.equal(next.state, 'ready');
    if (next.state === 'ready') {
      assert.ok(next.csv.includes(target));
      assert.ok(!next.csv.includes('other-request'));
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
