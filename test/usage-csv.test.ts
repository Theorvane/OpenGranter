import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serializeUsageCsv } from '../src/usage/csv.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

const record = buildUsageRecord({
  principalId: 'person-1',
  credentialId: 'credential-1',
  policyVersions: [{ id: 'policy-1', version: 'v1' }],
  requestId: 'request-1',
  attemptId: 'attempt-1',
  modelAlias: 'chat',
  routeKind: 'delegated',
  upstreamModelId: 'model',
  selectedCandidateId: null,
  occurredAt: 100,
  latencyMs: 5,
  outcome: 'succeeded',
  possiblyBilled: true,
  possibleDuplicate: true,
  estimatedCost: { amountDecimal: '0.010', currency: 'USD', priceVersion: 'prices-v1' },
  upstreamBilledCost: { amountDecimal: '0.007', currency: 'USD', source: 'openrouter' },
});

test('CSV preserves unknown usage and separates estimated/billed costs without extra fields', () => {
  const csv = serializeUsageCsv([
    { ...record, prompt: 'private prompt', token: 'private token', providerKey: 'private key' },
  ]);
  assert.ok(csv.startsWith('"request_id","attempt_id","principal_id","credential_id"'));
  assert.ok(csv.includes('"missing","","",""'));
  assert.ok(csv.includes('"0.010","USD","prices-v1","0.007","USD","openrouter"'));
  assert.ok(csv.includes('"succeeded","true","true"'));
  assert.ok(!csv.includes('private'));
  assert.ok(csv.endsWith('\r\n'));
});

test('CSV correctly quotes commas, quotes, multiline text, and formula-looking cells', () => {
  assert.ok(
    serializeUsageCsv([{ ...record, modelAlias: 'chat,"quoted"\nline' }]).includes(
      '"chat,""quoted""\nline"',
    ),
  );
  for (const value of [
    '=SUM(1,2)',
    '+cmd',
    '-cmd',
    '@cmd',
    '  =cmd',
    '\tcmd',
    '\ncmd',
    '＝cmd',
    '＋cmd',
    '－cmd',
    '＠cmd',
  ]) {
    assert.ok(serializeUsageCsv([{ ...record, modelAlias: value }]).includes(`"'${value}"`));
  }
});

test('empty export contains only headers and malformed records reject rather than partially export', () => {
  assert.equal(serializeUsageCsv([]).split('\r\n').length, 2);
  assert.throws(() => serializeUsageCsv([record, { ...record, occurredAt: -1 }]));
});
