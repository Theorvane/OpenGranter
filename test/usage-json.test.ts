import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectUsageJson } from '../src/usage/json.ts';
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

test('JSON preserves raw costs and flags but recomputes comparison and strips untrusted fields', () => {
  const input = row('0.010', '0.007');
  const output = projectUsageJson({
    ...input,
    secret: 'private',
    costComparison: { status: 'reconciled' },
  });
  assert.deepEqual(output.costComparison, {
    status: 'reported_below_estimate',
    reportedMinusEstimated: '-0.003',
    currency: 'USD',
  });
  assert.deepEqual(output.estimatedCost, input.estimatedCost);
  assert.deepEqual(output.upstreamBilledCost, input.upstreamBilledCost);
  assert.equal(output.possibleDuplicate, true);
  assert.equal(output.possiblyBilled, true);
  assert.equal(output.usage.status, 'missing');
  assert.ok(!JSON.stringify(output).includes('private'));
  assert.notEqual(output, input);
});
test('JSON unknown, partial and mismatch states do not fabricate delta', () => {
  for (const [estimate, reported, currency, status] of [
    [null, null, 'USD', 'unknown'],
    ['1', null, 'USD', 'estimate_only'],
    [null, '1', 'USD', 'reported_only'],
    ['1', '1', 'EUR', 'currency_mismatch'],
  ] as const)
    assert.deepEqual(projectUsageJson(row(estimate, reported, currency)).costComparison, {
      status,
      reportedMinusEstimated: null,
      currency: null,
    });
});
test('JSON exact string delta survives serialization and malformed metadata fails', () => {
  const output = JSON.parse(
    JSON.stringify(
      projectUsageJson(
        row('9007199254740993.000000000000000001', '9007199254740993.000000000000000002'),
      ),
    ),
  );
  assert.equal(output.costComparison.reportedMinusEstimated, '0.000000000000000001');
  assert.throws(() => projectUsageJson(row('NaN', '1')));
});
