import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createSsoUsageClient } from '../src/management/usage-client.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

const base = buildUsageRecord({
  principalId: 'human',
  credentialId: 'historical',
  policyVersions: [],
  requestId: 'request',
  attemptId: 'attempt',
  modelAlias: 'chat',
  routeKind: 'managed',
  upstreamModelId: 'upstream',
  selectedCandidateId: 'candidate',
  occurredAt: 10,
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
function response(input: unknown) {
  return Response.json({ object: 'list', data: [input], has_more: false, next_cursor: null });
}
test('browser transport recomputes exact comparison and strips forged fields, preserving raw attribution', async () => {
  const input = {
    ...row('9007199254740993.000000000000000002', '9007199254740993.000000000000000001'),
    costComparison: {
      status: 'equal',
      reportedMinusEstimated: '0',
      currency: 'USD',
      secret: 'PRIVATE',
    },
    prompt: 'PRIVATE',
  };
  const result = await createSsoUsageClient(async () => response(input)).read();
  assert.equal(result.state, 'ready');
  if (result.state !== 'ready') return;
  assert.deepEqual(result.data[0]?.costComparison, {
    status: 'reported_below_estimate',
    reportedMinusEstimated: '-0.000000000000000001',
    currency: 'USD',
  });
  assert.deepEqual(result.data[0]?.estimatedCost, input.estimatedCost);
  assert.deepEqual(result.data[0]?.upstreamBilledCost, input.upstreamBilledCost);
  assert.equal(result.data[0]?.usage.status, 'missing');
  assert.equal(result.data[0]?.possiblyBilled, true);
  assert.equal(result.data[0]?.possibleDuplicate, true);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('legacy JSON without comparison supports all availability states without inventing money', async () => {
  for (const [estimate, reported, currency, status, delta] of [
    [null, null, 'USD', 'unknown', null],
    ['1', null, 'USD', 'estimate_only', null],
    [null, '1', 'USD', 'reported_only', null],
    ['1', '1', 'EUR', 'currency_mismatch', null],
    ['1.00', '1', 'USD', 'equal', '0'],
    ['0.10', '0.2', 'USD', 'reported_above_estimate', '0.1'],
  ] as const) {
    const result = await createSsoUsageClient(async () =>
      response(row(estimate, reported, currency)),
    ).read();
    assert.equal(result.state, 'ready');
    if (result.state !== 'ready') continue;
    assert.deepEqual(result.data[0]?.costComparison, {
      status,
      reportedMinusEstimated: delta,
      currency: delta === null ? null : 'USD',
    });
  }
});
test('invalid source metadata cannot be rescued by a forged valid comparison', async () => {
  const input = {
    ...row('1', '2'),
    estimatedCost: { amountDecimal: 'NaN', currency: 'USD', priceVersion: 'v1' },
    costComparison: { status: 'equal', reportedMinusEstimated: '0', currency: 'USD' },
  };
  assert.deepEqual(await createSsoUsageClient(async () => response(input)).read(), {
    state: 'unavailable',
  });
});
test('browser-platform bundled transport executes the same exact comparison without Node imports', async () => {
  const output = await build({
    entryPoints: ['src/management/usage-client.ts'],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    write: false,
    metafile: true,
  });
  assert.ok(Object.values(output.metafile.outputs).every((file) => file.imports.length === 0));
  const javascript = output.outputFiles[0]?.text;
  assert.ok(javascript);
  const module = await import(
    'data:text/javascript;base64,' + Buffer.from(javascript).toString('base64')
  );
  const result = await module
    .createSsoUsageClient(async () => response(row('0.009', '0.001')))
    .read();
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.data[0]?.costComparison, {
    status: 'reported_below_estimate',
    reportedMinusEstimated: '-0.008',
    currency: 'USD',
  });
});
