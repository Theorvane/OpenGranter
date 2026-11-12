import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareUsageCosts } from '../src/usage/cost-comparison.ts';
import { serializeUsageCsv } from '../src/usage/csv.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

const base = buildUsageRecord({
  principalId: 'human',
  credentialId: 'key',
  policyVersions: [],
  requestId: 'request',
  attemptId: 'attempt',
  modelAlias: 'chat',
  routeKind: 'delegated',
  upstreamModelId: 'upstream',
  selectedCandidateId: null,
  occurredAt: 0,
  latencyMs: 1,
  outcome: 'succeeded',
  possiblyBilled: true,
  possibleDuplicate: true,
});
function row(estimate: string | null, reported: string | null, currency = 'USD') {
  return {
    ...base,
    estimatedCost:
      estimate === null ? null : { amountDecimal: estimate, currency: 'USD', priceVersion: 'v1' },
    upstreamBilledCost:
      reported === null ? null : { amountDecimal: reported, currency, source: 'openrouter' },
  };
}

test('unknown costs are not zero or reconciled and currencies are never converted', () => {
  for (const [estimate, reported, currency, status] of [
    [null, null, 'USD', 'unknown'],
    ['1', null, 'USD', 'estimate_only'],
    [null, '1', 'USD', 'reported_only'],
    ['1', '1', 'EUR', 'currency_mismatch'],
  ] as const) {
    assert.deepEqual(compareUsageCosts(row(estimate, reported, currency)), {
      status,
      reportedMinusEstimated: null,
      currency: null,
    });
  }
});
test('exact decimal comparison never rounds through Number', () => {
  for (const [estimate, reported, status, delta] of [
    ['0.10', '0.300', 'reported_above_estimate', '0.2'],
    ['0.010', '0.007', 'reported_below_estimate', '-0.003'],
    ['0.000', '0', 'equal', '0'],
    ['1.000', '1', 'equal', '0'],
    [
      '9007199254740993.000000000000000001',
      '9007199254740993.000000000000000002',
      'reported_above_estimate',
      '0.000000000000000001',
    ],
    ['100', '1', 'reported_below_estimate', '-99'],
    ['0', '1', 'reported_above_estimate', '1'],
  ] as const) {
    assert.deepEqual(compareUsageCosts(row(estimate, reported)), {
      status,
      reportedMinusEstimated: delta,
      currency: 'USD',
    });
  }
});
test('bounded 128-character decimals retain their final digit', () => {
  const amount = '0.' + '0'.repeat(125) + '1';
  assert.equal(amount.length, 128);
  assert.equal(compareUsageCosts(row('0', amount)).reportedMinusEstimated, amount);
});
test('reject malformed costs and discard extra untrusted fields', () => {
  for (const amount of ['NaN', '-1', '1e5', '0.' + '1'.repeat(127)])
    assert.throws(() => compareUsageCosts(row(amount, '1')));
  assert.deepEqual(
    compareUsageCosts({ ...row('1', '1'), token: 'private', cost_comparison: 'reconciled' }),
    { status: 'equal', reportedMinusEstimated: '0', currency: 'USD' },
  );
});
test('actual CSV appends comparison without suppressing unknown usage or duplicate flags', () => {
  const csv = serializeUsageCsv([row('0.010', '0.007')]);
  assert.ok(
    csv
      .split('\r\n')[0]
      ?.endsWith('"cost_comparison","reported_minus_estimated","comparison_currency"'),
  );
  assert.ok(csv.includes(`"reported_below_estimate","'-0.003","USD"`));
  assert.ok(csv.includes('"missing"'));
  assert.ok(csv.includes('"succeeded","true","true"'));
  assert.ok(serializeUsageCsv([row(null, null)]).includes('"unknown","",""'));
  assert.throws(() => serializeUsageCsv([row('1', '1'), row('NaN', '1')]));
});
