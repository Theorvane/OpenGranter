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
