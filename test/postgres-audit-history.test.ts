import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresAuditHistoryReader } from '../src/audit/postgres-audit-history.ts';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';

const migration = await readFile(
  new URL('../migrations/003_gateway_audit.sql', import.meta.url),
  'utf8',
);

async function fixture() {
  const db = new PGlite();
  await db.exec(migration);
  const client = { query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]) };
  const writer = createPostgresGatewayAuditStore(client, () => 1_000);
  const reader = createPostgresAuditHistoryReader(client);
  return { db, writer, reader };
}

function event(principalId: string, requestId: string, count: number) {
  return {
    kind: 'models-listed' as const,
    principalId,
    credentialId: 'credential-1',
    policyVersions: [{ id: 'allow', version: 'v1' }],
    requestId,
    count,
  };
}

test('principal-scoped keyset pages retain equal timestamps without other principals', async () => {
  const { db, writer, reader } = await fixture();
  try {
    await writer.append(event('service-1', 'request-1', 1));
    await writer.append(event('service-1', 'request-2', 2));
    await writer.append(event('service-2', 'request-3', 3));
    await writer.append(event('service-1', 'request-4', 4));
    const first = await reader({ principalId: 'service-1', limit: 2 });
    assert.deepEqual(
      first.events.map((row) => row.requestId),
      ['request-4', 'request-2'],
    );
    assert.equal(first.nextCursor, '2');
    const second = await reader({ principalId: 'service-1', limit: 2, cursor: first.nextCursor });
    assert.deepEqual(
      second.events.map((row) => row.requestId),
      ['request-1'],
    );
    assert.equal(second.nextCursor, null);
    assert.equal(
      first.events.every((row) => row.principalId === 'service-1'),
      true,
    );
    assert.equal(
      first.events.every((row) => row.occurredAt === 1_000),
      true,
    );
  } finally {
    await db.close();
  }
});

test('forged cursors and invalid page sizes fail before storage access', async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const reader = createPostgresAuditHistoryReader({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  });
  for (const query of [
    { principalId: 'service-1', limit: 1, cursor: '1 OR true' },
    { principalId: 'service-1', limit: 1, cursor: '0' },
    { principalId: 'service-1', limit: 1, cursor: '9'.repeat(10_000) },
    { principalId: 'service-1', limit: 101 },
    { principalId: '', limit: 1 },
  ]) {
    await assert.rejects(reader(query), {
      name: 'AuditHistoryUnavailable',
      message: 'Audit history unavailable',
    });
  }
  assert.equal(calls.length, 0);
  await reader({ principalId: 'service-1', limit: 2, cursor: '9' });
  assert.match(calls[0]?.sql ?? '', /WHERE principal_id = \$1/u);
  assert.deepEqual(calls[0]?.params, ['service-1', '9', 3, null, null, null]);
});

test('mixed-principal and malformed stored rows fail as a whole', async () => {
  const base = {
    event_id: '8',
    occurred_at_ms: '1000',
    kind: 'models-listed',
    request_id: 'request-7',
    principal_id: 'service-1',
    credential_id: 'credential-1',
    policy_versions: [{ id: 'allow', version: 'v1' }],
    details: { count: 2 },
  };
  for (const wrong of [
    { ...base, event_id: '7', principal_id: 'service-2' },
    { ...base, event_id: '7', kind: 'auth-denied' },
    { ...base, event_id: '7', details: { count: -1 } },
    { ...base, event_id: 'not-a-number' },
    { ...base, event_id: '7', occurred_at_ms: '9007199254740992' },
  ]) {
    const reader = createPostgresAuditHistoryReader({
      query: async () => ({ rows: [base, wrong] }),
    });
    await assert.rejects(reader({ principalId: 'service-1', limit: 2 }), {
      name: 'AuditHistoryUnavailable',
      message: 'Audit history unavailable',
    });
  }
});

test('reader reprojects stored details and excludes unexpected content', async () => {
  const reader = createPostgresAuditHistoryReader({
    query: async () => ({
      rows: [
        {
          event_id: '1',
          occurred_at_ms: '1000',
          kind: 'models-listed',
          request_id: 'request-1',
          principal_id: 'service-1',
          credential_id: 'credential-1',
          policy_versions: [{ id: 'allow', version: 'v1', secret: 'private value' }],
          details: {
            count: 2,
            prompt: 'private input',
            providerKey: 'private key',
            principalId: 'service-2',
          },
        },
      ],
    }),
  });
  const page = await reader({ principalId: 'service-1', limit: 1 });
  assert.deepEqual(page.events[0]?.details, { count: 2 });
  assert.equal(JSON.stringify(page).includes('private'), false);
  assert.equal(page.events[0]?.principalId, 'service-1');
});

test('database failures return a fixed safe error', async () => {
  const reader = createPostgresAuditHistoryReader({
    query: async () => {
      throw new Error('private SQL detail');
    },
  });
  await assert.rejects(reader({ principalId: 'service-1', limit: 1 }), {
    name: 'AuditHistoryUnavailable',
    message: 'Audit history unavailable',
  });
});

test('audit time filters retain event-ID pagination and principal scope', async () => {
  const { db, writer, reader } = await fixture();
  try {
    for (const [id, time] of [
      ['before', 999],
      ['one', 1000],
      ['two', 1000],
      ['after', 1001],
    ] as const) {
      await writer.append(event('service-1', id, 1));
      await db.query('UPDATE gateway_audit_events SET occurred_at_ms = $1 WHERE request_id = $2', [
        time,
        id,
      ]);
    }
    await writer.append(event('service-2', 'foreign', 1));
    const filter = { principalId: 'service-1', limit: 1, fromMs: 1000, toMs: 1001 };
    const first = await reader(filter);
    assert.deepEqual(
      first.events.map((row) => row.requestId),
      ['two'],
    );
    assert.ok(first.nextCursor);
    const second = await reader({ ...filter, cursor: first.nextCursor });
    assert.deepEqual(
      second.events.map((row) => row.requestId),
      ['one'],
    );
    assert.equal(second.nextCursor, null);
  } finally {
    await db.close();
  }
});

test('malformed audit time filters fail before SQL', async () => {
  let calls = 0;
  const reader = createPostgresAuditHistoryReader({
    query: async () => {
      calls++;
      return { rows: [] };
    },
  });
  for (const filter of [{ fromMs: -1 }, { toMs: 1.5 }, { fromMs: 1000, toMs: 1000 }]) {
    await assert.rejects(reader({ principalId: 'service-1', limit: 1, ...filter }), {
      name: 'AuditHistoryUnavailable',
    });
  }
  assert.equal(calls, 0);
});

test('out-of-range SQL results reject the entire audit page', async () => {
  const reader = createPostgresAuditHistoryReader({
    query: async () => ({
      rows: [
        {
          event_id: '1',
          occurred_at_ms: '1000',
          kind: 'models-listed',
          request_id: 'request-1',
          principal_id: 'service-1',
          credential_id: 'credential-1',
          policy_versions: [{ id: 'allow', version: 'v1' }],
          details: { count: 1 },
        },
      ],
    }),
  });
  for (const filter of [{ fromMs: 1001 }, { toMs: 1000 }]) {
    await assert.rejects(reader({ principalId: 'service-1', limit: 1, ...filter }), {
      name: 'AuditHistoryUnavailable',
    });
  }
});

test('model/time/cursor filters exclude other principals and events without a known model', async () => {
  const { db, writer, reader } = await fixture();
  try {
    for (const [principal, requestId, modelAlias] of [
      ['service-1', 'one', 'chat'],
      ['service-1', 'other-model', 'other'],
      ['service-2', 'foreign', 'chat'],
      ['service-1', 'two', 'chat'],
    ] as const)
      await writer.append({
        kind: 'route-unavailable',
        principalId: principal,
        requestId,
        modelAlias,
        credentialId: 'credential-1',
        policyVersions: [],
      });
    await writer.append(event('service-1', 'without-model', 1));
    const filter = {
      principalId: 'service-1',
      limit: 1,
      modelAlias: 'chat',
      fromMs: 1000,
      toMs: 1001,
    };
    const first = await reader(filter);
    assert.deepEqual(
      first.events.map((row) => row.requestId),
      ['two'],
    );
    assert.ok(first.nextCursor);
    const second = await reader({ ...filter, cursor: first.nextCursor });
    assert.deepEqual(
      second.events.map((row) => row.requestId),
      ['one'],
    );
    assert.equal(second.nextCursor, null);
    assert.deepEqual((await reader({ ...filter, modelAlias: "chat' OR 1=1 --" })).events, []);
  } finally {
    await db.close();
  }
});

test('malformed model filters reject before SQL', async () => {
  let calls = 0;
  const reader = createPostgresAuditHistoryReader({
    query: async () => {
      calls++;
      return { rows: [] };
    },
  });
  for (const modelAlias of ['', ' ', '\0', 'a'.repeat(257)]) {
    await assert.rejects(reader({ principalId: 'service-1', limit: 1, modelAlias }), {
      name: 'AuditHistoryUnavailable',
    });
  }
  assert.equal(calls, 0);
});

test('out-of-model or spoofed lookahead rows reject the entire SQL page', async () => {
  const row = {
    event_id: '8',
    occurred_at_ms: '1000',
    kind: 'route-unavailable',
    request_id: 'request-1',
    principal_id: 'service-1',
    credential_id: 'credential-1',
    policy_versions: [],
    details: { modelAlias: 'chat' },
  };
  for (const extra of [
    { ...row, event_id: '7', details: { modelAlias: 'other' } },
    { ...row, event_id: '7', kind: 'models-listed', details: { count: 1, modelAlias: 'chat' } },
  ]) {
    const reader = createPostgresAuditHistoryReader({
      query: async () => ({ rows: [row, extra] }),
    });
    await assert.rejects(reader({ principalId: 'service-1', limit: 1, modelAlias: 'chat' }), {
      name: 'AuditHistoryUnavailable',
    });
  }
});
