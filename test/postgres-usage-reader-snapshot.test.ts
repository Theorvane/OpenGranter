import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresUsageLedger, UsageLedgerUnavailable } from '../src/usage/postgres-ledger.ts';
import { createPostgresUsageReader } from '../src/usage/postgres-reader.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

function record(principalId = 'person-1', attemptId = 'b') {
  return buildUsageRecord({
    principalId,
    credentialId: 'credential-1',
    policyVersions: [],
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
    providerUsage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
  });
}
function query() {
  return {
    principalId: 'person-1',
    limit: 1,
    cursor: { occurredAt: 100, attemptId: 'c' },
    modelAlias: 'chat',
    requestId: 'request-1',
    fromMs: 100,
    toMs: 101,
  };
}
function row(principalId = 'person-1', attemptId = 'b') {
  const value = record(principalId, attemptId);
  return { principal_id: principalId, attempt_id: attemptId, occurred_at_ms: '100', record: value };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const field of [
  'principalId',
  'modelAlias',
  'requestId',
  'fromMs',
  'toMs',
  'cursor',
] as const) {
  test('reader owns the original ' + field + ' while SQL is pending', async () => {
    const pending = deferred<{ rows: ReturnType<typeof row>[] }>();
    let parameters: readonly unknown[] = [];
    const reader = createPostgresUsageReader({
      query: async (_sql, params) => {
        parameters = params;
        return pending.promise;
      },
    });
    const input = query();
    const result = reader(input);
    if (field === 'fromMs') input.fromMs = 101;
    else if (field === 'toMs') input.toMs = 100;
    else if (field === 'cursor') input.cursor.attemptId = 'a';
    else input[field] = 'changed';
    pending.resolve({ rows: [row()] });
    assert.deepEqual(
      (await result).records.map((value) => value.attemptId),
      ['b'],
    );
    assert.deepEqual(parameters, ['person-1', 100, 'c', 2, 'chat', 100, 101, 'request-1']);
  });
}

test('reader preserves original page limit and hidden lookahead', async () => {
  const pending = deferred<{ rows: ReturnType<typeof row>[] }>();
  const reader = createPostgresUsageReader({ query: async () => pending.promise });
  const input = query();
  const result = reader(input);
  input.limit = 100;
  pending.resolve({ rows: [row(), row('person-1', 'a')] });
  const page = await result;
  assert.equal(page.hasMore, true);
  assert.deepEqual(
    page.records.map((value) => value.attemptId),
    ['b'],
  );
});

test('changing caller principal cannot authorize a substituted SQL row', async () => {
  const pending = deferred<{ rows: ReturnType<typeof row>[] }>();
  const reader = createPostgresUsageReader({ query: async () => pending.promise });
  const input = query();
  const result = reader(input);
  input.principalId = 'person-2';
  pending.resolve({ rows: [row('person-2')] });
  await assert.rejects(result, UsageLedgerUnavailable);
});

test('mutating caller cursor cannot admit rows newer than the original key', async () => {
  const pending = deferred<{ rows: ReturnType<typeof row>[] }>();
  const reader = createPostgresUsageReader({ query: async () => pending.promise });
  const input = query();
  const result = reader(input);
  input.cursor.attemptId = 'z';
  pending.resolve({ rows: [row('person-1', 'd')] });
  await assert.rejects(result, UsageLedgerUnavailable);
});

test('real SQL maintains separate owned scopes while two requests are pending', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL('../migrations/001_usage_records.sql', import.meta.url), 'utf8'),
    );
    const sql = {
      query: (statement: string, params: readonly unknown[]) => db.query(statement, [...params]),
    };
    const write = createPostgresUsageLedger(sql);
    await write(record());
    await write(record('person-2', 'a'));
    const gate = deferred<void>();
    const reader = createPostgresUsageReader({
      query: async (statement, params) => {
        await gate.promise;
        return sql.query(statement, params);
      },
    });
    const first = query();
    const second = { ...query(), principalId: 'person-2' };
    const results = Promise.all([reader(first), reader(second)]);
    first.principalId = 'changed';
    second.modelAlias = 'changed';
    first.cursor.attemptId = 'a';
    gate.resolve();
    const pages = await results;
    assert.deepEqual(
      pages.map((page) => page.records.map((value) => value.principalId)),
      [['person-1'], ['person-2']],
    );
  } finally {
    await db.close();
  }
});
