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

test('request filter parser is strict and exact', async () => {
  const { parseUsageHistoryQuery } = await import('../src/usage/history.ts');
  assert.equal(
    parseUsageHistoryQuery(new URL('http://local/v1/usage?request_id=req%2B1')).requestId,
    'req+1',
  );
  for (const query of [
    'request_id=',
    'request_id=a&request_id=a',
    'request_id=req+bad',
    'request_id=%00',
    'request_id=%27OR',
    'request_id=' + 'a'.repeat(257),
  ])
    assert.throws(() => parseUsageHistoryQuery(new URL('http://local/v1/usage?' + query)));
});
test('request SQL exact intersection, pagination and foreign isolation', async () => {
  const { db, writeUsage, readUsage } = await fixture();
  try {
    await writeUsage({ ...record('person-1', 'a'), requestId: 'target' });
    await writeUsage({ ...record('person-1', 'b'), requestId: 'target' });
    await writeUsage({ ...record('person-1', 'c'), requestId: 'other' });
    await writeUsage({ ...record('person-2', 'foreign', 200), requestId: 'target' });
    const scope = {
      principalId: 'person-1',
      requestId: 'target',
      modelAlias: 'chat',
      fromMs: 100,
      toMs: 101,
      limit: 1,
    };
    const first = await readUsage({ ...scope, cursor: null });
    assert.deepEqual(
      first.records.map((r) => r.attemptId),
      ['b'],
    );
    assert.equal(first.hasMore, true);
    const second = await readUsage({ ...scope, cursor: { occurredAt: 100, attemptId: 'b' } });
    assert.deepEqual(
      second.records.map((r) => r.attemptId),
      ['a'],
    );
    assert.equal(second.hasMore, false);
    assert.deepEqual(
      (await readUsage({ ...scope, requestId: 'Target', cursor: null })).records,
      [],
    );
  } finally {
    await db.close();
  }
});
test('hidden off-request SQL lookahead fails closed', async () => {
  const rows = [record('person-1', 'z'), record('person-1', 'a')].map((r, i) => ({
    attempt_id: r.attemptId,
    principal_id: r.principalId,
    occurred_at_ms: String(r.occurredAt),
    record: { ...r, requestId: i ? 'other' : 'target' },
  }));
  const read = createPostgresUsageReader({ query: async () => ({ rows }) });
  await assert.rejects(
    read({ principalId: 'person-1', requestId: 'target', limit: 1, cursor: null }),
    UsageLedgerUnavailable,
  );
});
