import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUsageHistoryQuery } from '../src/usage/history.ts';
import { UsageLedgerUnavailable } from '../src/usage/postgres-ledger.ts';
import { createPostgresUsageReader } from '../src/usage/postgres-reader.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

for (const value of ['a', 'Trace:/A+1', 'x'.repeat(256)]) {
  test(`request trace parser accepts exact identifier length ${value.length}`, () => {
    const url = new URL('http://localhost/management/v1/usage');
    url.searchParams.set('request_id', value);
    assert.equal(parseUsageHistoryQuery(url).requestId, value);
  });
}
for (const value of ['', ' ', 'a b', '\n', 'x'.repeat(257), 'é', 'a=1', 'x\u0000']) {
  test(`request trace parser rejects ${JSON.stringify(value.slice(0, 8))}`, () => {
    const url = new URL('http://localhost/management/v1/usage');
    url.searchParams.set('request_id', value);
    assert.throws(() => parseUsageHistoryQuery(url));
  });
}
test('request trace validates off-request hidden SQL lookahead', async () => {
  function row(attemptId: string, requestId: string, occurredAt: number) {
    const record = buildUsageRecord({
      principalId: 'human',
      credentialId: 'credential',
      policyVersions: [],
      requestId,
      attemptId,
      occurredAt,
      modelAlias: 'chat',
      routeKind: 'managed',
      upstreamModelId: 'upstream',
      selectedCandidateId: null,
      latencyMs: 1,
      outcome: 'succeeded',
      possiblyBilled: false,
      possibleDuplicate: false,
    });
    return {
      principal_id: 'human',
      attempt_id: attemptId,
      occurred_at_ms: String(occurredAt),
      record,
    };
  }
  const reader = createPostgresUsageReader({
    query: async (_sql, params) => {
      assert.equal(params[7], 'wanted');
      return { rows: [row('b', 'wanted', 200), row('a', 'other', 100)] };
    },
  });
  await assert.rejects(
    reader({ principalId: 'human', requestId: 'wanted', limit: 1, cursor: null }),
    UsageLedgerUnavailable,
  );
});
