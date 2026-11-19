import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InvalidUsageQuery,
  parseUsageHistoryQuery,
  validUsageHistoryFilters,
} from '../src/usage/history.ts';
import { UsageLedgerUnavailable } from '../src/usage/postgres-ledger.ts';
import { createPostgresUsageReader } from '../src/usage/postgres-reader.ts';

test('request identifiers preserve the existing ASCII contract and boundary lengths', () => {
  for (const requestId of ['r/attempt+v1:@._-', 'x'.repeat(256), 'Case-Sensitive']) {
    const url = new URL('https://history.test/');
    url.searchParams.set('request_id', requestId);
    assert.equal(parseUsageHistoryQuery(url).requestId, requestId);
  }
  assert.equal(parseUsageHistoryQuery(new URL('https://history.test/')).requestId, undefined);
});

test('malformed request identifiers are rejected at query and trusted storage boundaries', async () => {
  let calls = 0;
  const read = createPostgresUsageReader({
    query: async () => {
      calls++;
      return { rows: [] };
    },
  });
  for (const requestId of [
    '',
    '  ',
    '\n',
    '\u0085',
    'x'.repeat(257),
    '会社😀',
    ' padded ',
    'a OR true --',
  ]) {
    const url = new URL('https://history.test/');
    url.searchParams.set('request_id', requestId);
    assert.throws(() => parseUsageHistoryQuery(url), InvalidUsageQuery);
    assert.equal(validUsageHistoryFilters({ requestId }), false);
    await assert.rejects(
      read({ principalId: 'human', limit: 1, cursor: null, requestId }),
      UsageLedgerUnavailable,
    );
  }
  assert.equal(calls, 0);
  assert.throws(
    () => parseUsageHistoryQuery(new URL('https://history.test/?request_id=a&request_id=a')),
    InvalidUsageQuery,
  );
});
