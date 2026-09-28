import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresUsageLedger, UsageLedgerUnavailable } from '../src/usage/postgres-ledger.ts';
import { createPostgresUsageReader } from '../src/usage/postgres-reader.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

const migration = await readFile(
  new URL('../migrations/001_usage_records.sql', import.meta.url),
  'utf8',
);

function record(principalId: string, attemptId: string, occurredAt = 100) {
  return buildUsageRecord({
    principalId,
    credentialId: 'credential-1',
    policyVersions: [{ id: 'policy-1', version: 'v1' }],
    requestId: 'chat-1',
    attemptId,
    modelAlias: 'chat',
    routeKind: 'managed',
    upstreamModelId: 'gpt',
    selectedCandidateId: 'candidate-1',
    actualInferenceProviderId: 'openai',
    occurredAt,
    latencyMs: 5,
    outcome: 'succeeded',
    possiblyBilled: true,
    possibleDuplicate: false,
    providerUsage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
  });
}

async function fixture() {
  const db = new PGlite();
  await db.exec(migration);
  const client = { query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]) };
  return {
    db,
    writeUsage: createPostgresUsageLedger(client),
    readUsage: createPostgresUsageReader(client),
  };
}

test('PostgreSQL reader scopes to one principal and paginates equal timestamps without gaps', async () => {
  const { db, writeUsage, readUsage } = await fixture();
  try {
    await writeUsage(record('person-1', 'attempt-a'));
    await writeUsage(record('person-1', 'attempt-b'));
    await writeUsage(record('person-1', 'attempt-c'));
    await writeUsage(record('person-2', 'foreign-attempt', 101));
    const first = await readUsage({ principalId: 'person-1', limit: 2, cursor: null });
    assert.deepEqual(
      first.records.map((item) => item.attemptId),
      ['attempt-c', 'attempt-b'],
    );
    assert.equal(first.hasMore, true);
    const second = await readUsage({
      principalId: 'person-1',
      limit: 2,
      cursor: {
        occurredAt: first.records[1]?.occurredAt ?? -1,
        attemptId: first.records[1]?.attemptId ?? '',
      },
    });
    assert.deepEqual(
      second.records.map((item) => item.attemptId),
      ['attempt-a'],
    );
    assert.equal(second.hasMore, false);
  } finally {
    await db.close();
  }
});

test('forged cursor cannot remove the SQL principal filter', async () => {
  const { db, writeUsage, readUsage } = await fixture();
  try {
    await writeUsage(record('person-1', 'self-attempt', 100));
    await writeUsage(record('person-2', 'foreign-attempt', 99));
    const page = await readUsage({
      principalId: 'person-1',
      limit: 10,
      cursor: { occurredAt: 101, attemptId: 'foreign-attempt' },
    });
    assert.deepEqual(
      page.records.map((item) => item.principalId),
      ['person-1'],
    );
  } finally {
    await db.close();
  }
});

test('reader accepts PostgreSQL bigint timestamps returned as decimal strings', async () => {
  const { db, writeUsage } = await fixture();
  try {
    await writeUsage(record('person-1', 'attempt-a'));
    const readUsage = createPostgresUsageReader({
      query: async (sql, params) => {
        const result = await db.query<Record<string, unknown>>(sql, [...params]);
        return {
          rows: result.rows.map((row) => ({
            ...row,
            occurred_at_ms: String(row.occurred_at_ms),
          })),
        };
      },
    });
    const page = await readUsage({ principalId: 'person-1', limit: 10, cursor: null });
    assert.equal(page.records[0]?.attemptId, 'attempt-a');
  } finally {
    await db.close();
  }
});

test('reader drops unexpected JSONB fields and rejects mismatched principal rows', async () => {
  const { db, writeUsage, readUsage } = await fixture();
  try {
    await writeUsage(record('person-1', 'attempt-a'));
    await db.query(
      `UPDATE usage_records SET record = record || '{"prompt":"private prompt"}'::jsonb`,
    );
    const safe = await readUsage({ principalId: 'person-1', limit: 10, cursor: null });
    assert.equal(JSON.stringify(safe).includes('private prompt'), false);
    await db.query(
      `UPDATE usage_records SET record = jsonb_set(record, '{principalId}', '"person-2"'::jsonb)`,
    );
    await assert.rejects(
      readUsage({ principalId: 'person-1', limit: 10, cursor: null }),
      UsageLedgerUnavailable,
    );
  } finally {
    await db.close();
  }
});

test('reader maps database failure to a safe availability error', async () => {
  const { db, readUsage } = await fixture();
  await db.close();
  await assert.rejects(
    readUsage({ principalId: 'person-1', limit: 10, cursor: null }),
    UsageLedgerUnavailable,
  );
});

test('model/time filters preserve principal scope and keyset pagination', async () => {
  const { db, writeUsage, readUsage } = await fixture();
  try {
    for (const [id, time] of [
      ['a', 99],
      ['b', 100],
      ['c', 100],
      ['d', 101],
    ] as const) {
      await writeUsage(record('person-1', id, time));
    }
    await writeUsage({ ...record('person-1', 'other-model', 100), modelAlias: 'other' });
    await writeUsage(record('person-2', 'foreign', 100));
    const query = { principalId: 'person-1', limit: 1, modelAlias: 'chat', fromMs: 100, toMs: 101 };
    const first = await readUsage({ ...query, cursor: null });
    assert.deepEqual(
      first.records.map((row) => row.attemptId),
      ['c'],
    );
    assert.equal(first.hasMore, true);
    const second = await readUsage({ ...query, cursor: { occurredAt: 100, attemptId: 'c' } });
    assert.deepEqual(
      second.records.map((row) => row.attemptId),
      ['b'],
    );
    assert.equal(second.hasMore, false);
    assert.deepEqual(
      (await readUsage({ ...query, cursor: null, modelAlias: "chat' OR true --" })).records,
      [],
    );
  } finally {
    await db.close();
  }
});

test('reader rejects malformed filter ports before SQL', async () => {
  let queries = 0;
  const reader = createPostgresUsageReader({
    query: async () => {
      queries += 1;
      return { rows: [] };
    },
  });
  for (const filter of [{ fromMs: -1 }, { fromMs: 10, toMs: 10 }, { modelAlias: '' }]) {
    await assert.rejects(
      reader({ principalId: 'person-1', limit: 10, cursor: null, ...filter }),
      UsageLedgerUnavailable,
    );
  }
  assert.equal(queries, 0);
});

test('reader rejects out-of-filter data even if SQL returns it', async () => {
  const stored = record('person-1', 'attempt', 100);
  const reader = createPostgresUsageReader({
    query: async () => ({
      rows: [
        {
          principal_id: stored.principalId,
          attempt_id: stored.attemptId,
          occurred_at_ms: String(stored.occurredAt),
          record: stored,
        },
      ],
    }),
  });
  for (const filter of [{ modelAlias: 'other' }, { fromMs: 101 }, { toMs: 100 }]) {
    await assert.rejects(
      reader({ principalId: 'person-1', limit: 10, cursor: null, ...filter }),
      UsageLedgerUnavailable,
    );
  }
});

test('SQL reader rejects duplicate, ascending, and cursor-equal/newer rows including lookahead', async () => {
  const row = (id: string, time: number) => ({
    principal_id: 'person-1',
    attempt_id: id,
    occurred_at_ms: String(time),
    record: record('person-1', id, time),
  });
  for (const rows of [
    [row('b', 100), row('b', 100)],
    [row('b', 100), row('c', 100)],
    [row('b', 100), row('a', 101)],
  ]) {
    const reader = createPostgresUsageReader({ query: async () => ({ rows }) });
    await assert.rejects(
      reader({ principalId: 'person-1', limit: 1, cursor: null }),
      UsageLedgerUnavailable,
    );
  }
  for (const candidate of [row('b', 100), row('c', 100), row('a', 101), row('b', 99)]) {
    const reader = createPostgresUsageReader({ query: async () => ({ rows: [candidate] }) });
    await assert.rejects(
      reader({ principalId: 'person-1', limit: 1, cursor: { occurredAt: 100, attemptId: 'b' } }),
      UsageLedgerUnavailable,
    );
  }
});

test('malformed internal usage cursor objects reject before SQL', async () => {
  let calls = 0;
  const reader = createPostgresUsageReader({
    query: async () => {
      calls++;
      return { rows: [] };
    },
  });
  for (const cursor of [
    { occurredAt: -1, attemptId: 'a' },
    { occurredAt: 1.5, attemptId: 'a' },
    { occurredAt: Number.MAX_SAFE_INTEGER + 1, attemptId: 'a' },
    { occurredAt: 100, attemptId: '' },
    { occurredAt: 100, attemptId: 'a'.repeat(513) },
  ])
    await assert.rejects(
      reader({ principalId: 'person-1', limit: 1, cursor }),
      UsageLedgerUnavailable,
    );
  assert.equal(calls, 0);
});

test('real PostgreSQL equal-time pages follow UTF-8 order with punctuation and non-BMP IDs', async () => {
  const { db, writeUsage, readUsage } = await fixture();
  try {
    for (const id of ['a', 'Z', '_', '\uE000', '😀']) await writeUsage(record('person-1', id, 100));
    const ids: string[] = [];
    let cursor: { occurredAt: number; attemptId: string } | null = null;
    for (let index = 0; index < 5; index++) {
      const page = await readUsage({ principalId: 'person-1', limit: 1, cursor });
      const item = page.records[0];
      assert.ok(item);
      ids.push(item.attemptId);
      cursor = { occurredAt: item.occurredAt, attemptId: item.attemptId };
      assert.equal(page.hasMore, index < 4);
    }
    assert.deepEqual(ids, ['😀', '\uE000', 'a', '_', 'Z']);
  } finally {
    await db.close();
  }
});
