import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUsageHistoryQuery } from '../src/usage/history.ts';

function query(principal: string) {
  const url = new URL('https://management.invalid/management/v1/usage');
  url.searchParams.set('principal_id', principal);
  return url;
}

test('explicit principal filters reject every C0, DEL and C1 control before storage', () => {
  for (let code = 0; code <= 0x9f; code++) {
    if (code > 0x1f && code < 0x7f) continue;
    assert.throws(
      () => parseUsageHistoryQuery(query(`human${String.fromCharCode(code)}other`)),
      { name: 'InvalidUsageQuery' },
      `code point ${code}`,
    );
  }
});

test('ordinary Unicode principal IDs remain exact, not normalized or widened', () => {
  for (const principal of ['사용자', 'é', 'e\u0301', 'human/team']) {
    assert.equal(parseUsageHistoryQuery(query(principal)).requestedPrincipalId, principal);
  }
});
