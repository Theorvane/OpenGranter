import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  createPostgresUsageLedger,
  UsageLedgerConflict,
  UsageLedgerUnavailable,
} from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord, type UsageRecord } from '../src/usage/record-usage.ts';

const migration = await readFile(
  new URL('../migrations/001_usage_records.sql', import.meta.url),
  'utf8',
);

function record(attemptId = 'request-1/managed/1', total = 7): UsageRecord {
  return buildUsageRecord({
    principalId: 'person-1',
    credentialId: 'credential-1',
    policyVersions: [{ id: 'policy-1', version: 'v1' }],
    requestId: 'request-1',
    attemptId,
    modelAlias: 'chat',
    routeKind: 'managed',
    upstreamModelId: 'gpt',
    selectedCandidateId: 'candidate-1',
    actualInferenceProviderId: 'openai',
    occurredAt: 100,
    latencyMs: 5,
    outcome: 'succeeded',
    possiblyBilled: true,
    possibleDuplicate: false,
    providerUsage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: total },
  });
}

async function fixture() {
  const db = new PGlite();
  await db.exec(migration);
  const writeUsage = createPostgresUsageLedger({
    query: (sql, params) => db.query(sql, [...params]),
  });
  return { db, writeUsage };
}

test('PostgreSQL ledger inserts once and treats exact replay as a no-op', async () => {
  const { db, writeUsage } = await fixture();
  try {
    await writeUsage(record());
    await writeUsage(record());
    const rows = await db.query<{ attempt_id: string; record: UsageRecord }>(
      'SELECT attempt_id, record FROM usage_records',
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0]?.record.usage.totalTokens, 7);
  } finally {
    await db.close();
  }
});

test('conflicting replay cannot overwrite the original attempt', async () => {
  const { db, writeUsage } = await fixture();
  try {
    await writeUsage(record());
    await assert.rejects(writeUsage(record('request-1/managed/1', 8)), UsageLedgerConflict);
    const rows = await db.query<{ record: UsageRecord }>('SELECT record FROM usage_records');
    assert.equal(rows.rows[0]?.record.usage.totalTokens, 7);
  } finally {
    await db.close();
  }
});

test('concurrent duplicate appends leave one immutable row', async () => {
  const { db, writeUsage } = await fixture();
  try {
    await Promise.all(Array.from({ length: 8 }, () => writeUsage(record())));
    const rows = await db.query<{ count: string }>('SELECT count(*) AS count FROM usage_records');
    assert.equal(Number(rows.rows[0]?.count), 1);
  } finally {
    await db.close();
  }
});

test('retry after an ambiguous committed write does not duplicate accounting', async () => {
  const db = new PGlite();
  await db.exec(migration);
  let failAfterCommit = true;
  const writeUsage = createPostgresUsageLedger({
    query: async (sql, params) => {
      const result = await db.query(sql, [...params]);
      if (failAfterCommit && sql.startsWith('INSERT INTO usage_records')) {
        failAfterCommit = false;
        throw new Error('connection lost after commit');
      }
      return result;
    },
  });
  try {
    await assert.rejects(writeUsage(record()), UsageLedgerUnavailable);
    await writeUsage(record());
    const rows = await db.query<{ count: string }>('SELECT count(*) AS count FROM usage_records');
    assert.equal(Number(rows.rows[0]?.count), 1);
  } finally {
    await db.close();
  }
});

test('SQL parameters and allowlisted serialization exclude injected content and keys', async () => {
  const { db, writeUsage } = await fixture();
  try {
    const value = Object.assign(record("request-'1/managed/1"), {
      prompt: 'private prompt',
      providerKey: 'private key',
      response: 'private response',
    });
    await writeUsage(value);
    const rows = await db.query<{ record: unknown }>('SELECT record FROM usage_records');
    assert.equal(JSON.stringify(rows.rows).includes('private'), false);
    const stored = rows.rows[0];
    assert.ok(stored);
    assert.equal((stored.record as UsageRecord).attemptId, "request-'1/managed/1");
    const indexes = await db.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'usage_records'",
    );
    assert.equal(
      indexes.rows.some((row) => row.indexname === 'usage_records_principal_time_idx'),
      true,
    );
  } finally {
    await db.close();
  }
});

test('database failure exposes only a safe availability error', async () => {
  const { db, writeUsage } = await fixture();
  await db.close();
  await assert.rejects(writeUsage(record()), UsageLedgerUnavailable);
});
