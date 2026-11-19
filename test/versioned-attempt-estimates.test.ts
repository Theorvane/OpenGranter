import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { type AttemptUsageInput, captureAttemptUsage } from '../src/usage/capture-attempt.ts';
import { serializeUsageCsv } from '../src/usage/csv.ts';
import {
  estimateUsageCost,
  type FlatTokenPriceSnapshot,
  InvalidUsagePrice,
} from '../src/usage/estimate-cost.ts';
import { projectUsageJson } from '../src/usage/json.ts';
import { createPostgresUsageLedger, UsageLedgerConflict } from '../src/usage/postgres-ledger.ts';
import { createPostgresUsageReader } from '../src/usage/postgres-reader.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

const price = {
  kind: 'flat-token' as const,
  priceVersion: 'price-v1',
  currency: 'USD',
  inputPerToken: '0.000000000000000001',
  outputPerToken: '0.25',
};
const input: AttemptUsageInput = {
  principalId: 'human-1',
  credentialId: 'credential-1',
  policyVersions: [],
  requestId: 'request-1',
  attemptNumber: 1,
  modelAlias: 'approved-model',
  routeKind: 'delegated',
  upstreamModelId: 'model-1',
  selectedCandidateId: null,
  startedAt: 1000,
  outcome: 'succeeded',
  possiblyBilled: false,
  possibleDuplicate: false,
  response: { usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
};

test('capture records exact versioned estimate, distinct from a provider bill', async () => {
  const records: UsageRecord[] = [];
  await captureAttemptUsage(
    { ...input, priceSnapshot: price },
    {
      now: () => 1010,
      writeUsage: async (record) => {
        records.push(record);
      },
    },
  );
  assert.deepEqual(records[0]?.estimatedCost, {
    amountDecimal: '0.500000000000000003',
    currency: 'USD',
    priceVersion: 'price-v1',
  });
  assert.equal(records[0]?.upstreamBilledCost, null);
});

test('true reported zero gets an estimate, not unknown cost', async () => {
  const records: UsageRecord[] = [];
  await captureAttemptUsage(
    {
      ...input,
      priceSnapshot: price,
      response: { usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } },
    },
    {
      writeUsage: async (record) => {
        records.push(record);
      },
    },
  );
  assert.deepEqual(records[0]?.estimatedCost, {
    amountDecimal: '0',
    currency: 'USD',
    priceVersion: 'price-v1',
  });
});

const usage = { status: 'reported' as const, promptTokens: 3, completionTokens: 2, totalTokens: 5 };

test('unknown, partial and invalid counters are never estimated as zero', async () => {
  for (const providerUsage of [
    undefined,
    null,
    {},
    { prompt_tokens: 3 },
    { prompt_tokens: 3, completion_tokens: 2 },
    { prompt_tokens: -1, completion_tokens: 2, total_tokens: 1 },
    { prompt_tokens: null, completion_tokens: 2, total_tokens: 2 },
  ]) {
    const records: UsageRecord[] = [];
    await captureAttemptUsage(
      { ...input, priceSnapshot: price, response: { usage: providerUsage } },
      {
        writeUsage: async (record) => {
          records.push(record);
        },
      },
    );
    assert.equal(records[0]?.estimatedCost, null);
    assert.equal(records[0]?.upstreamBilledCost, null);
  }
  for (const bad of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1, null]) {
    assert.equal(estimateUsageCost({ ...usage, promptTokens: bad }, price), null);
  }
});

test('failed or unpriced attempts preserve existing unknown costs and flags', async () => {
  for (const attempt of [
    { ...input },
    {
      ...input,
      outcome: 'failed' as const,
      priceSnapshot: price,
      possiblyBilled: true,
      possibleDuplicate: true,
    },
  ]) {
    const records: UsageRecord[] = [];
    await captureAttemptUsage(attempt, {
      writeUsage: async (record) => {
        records.push(record);
      },
    });
    assert.equal(records[0]?.estimatedCost, null);
    assert.equal(records[0]?.possiblyBilled, attempt.possiblyBilled);
    assert.equal(records[0]?.possibleDuplicate, attempt.possibleDuplicate);
  }
  assert.equal(estimateUsageCost(usage, null), null);
  assert.equal(estimateUsageCost(usage, undefined), null);
});

test('exact arbitrary decimals preserve tiny values, integer totals and independent versions', () => {
  assert.deepEqual(
    estimateUsageCost(usage, {
      ...price,
      inputPerToken: '2.000',
      outputPerToken: '3',
      currency: 'KRW',
      priceVersion: 'v2',
    }),
    { amountDecimal: '12', currency: 'KRW', priceVersion: 'v2' },
  );
  assert.equal(
    estimateUsageCost(usage, { ...price, inputPerToken: '0', outputPerToken: '0' })?.amountDecimal,
    '0',
  );
  assert.equal(
    estimateUsageCost(
      { ...usage, promptTokens: Number.MAX_SAFE_INTEGER, completionTokens: 0 },
      { ...price, inputPerToken: '0.000000000000000001' },
    )?.amountDecimal,
    '0.009007199254740991',
  );
  assert.equal(
    estimateUsageCost(
      { ...usage, promptTokens: 1, completionTokens: 0 },
      { ...price, inputPerToken: `0.${'0'.repeat(125)}1` },
    )?.amountDecimal,
    `0.${'0'.repeat(125)}1`,
  );
  assert.equal(estimateUsageCost(usage, { ...price, inputPerToken: '9'.repeat(128) }), null);
});

test('malformed supplied prices fail with fixed private error before any usage write', async () => {
  const malformed = [
    { ...price, kind: 'per-million' },
    { ...price, currency: 'usd' },
    { ...price, currency: 'USDD' },
    { ...price, priceVersion: '' },
    { ...price, priceVersion: 'v'.repeat(257) },
    { ...price, priceVersion: 'bad\nversion' },
    ...['-1', '1e-6', '01', '.5', '1.', ' 1', '9'.repeat(129), null, Infinity].map(
      (inputPerToken) => ({ ...price, inputPerToken }),
    ),
    {
      ...price,
      get inputPerToken() {
        throw new Error('private-price-diagnostic');
      },
    },
  ];
  let writes = 0;
  for (const value of malformed) {
    assert.throws(() => estimateUsageCost(usage, value as FlatTokenPriceSnapshot), {
      name: 'InvalidUsagePrice',
      message: 'Invalid usage price',
    });
    await assert.rejects(
      captureAttemptUsage(
        { ...input, priceSnapshot: value as FlatTokenPriceSnapshot },
        {
          writeUsage: async () => {
            writes++;
          },
        },
      ),
      InvalidUsagePrice,
    );
  }
  assert.equal(writes, 0);
});

test('price fields are captured once and result is immutable', () => {
  const reads: Record<string, number> = {};
  const snapshot = Object.fromEntries(Object.entries(price).map(([key, value]) => [key, value]));
  for (const [key, value] of Object.entries(price)) {
    Object.defineProperty(snapshot, key, {
      get() {
        reads[key] = (reads[key] ?? 0) + 1;
        return value;
      },
    });
  }
  const result = estimateUsageCost(usage, snapshot as unknown as FlatTokenPriceSnapshot);
  assert.deepEqual(reads, {
    kind: 1,
    priceVersion: 1,
    currency: 1,
    inputPerToken: 1,
    outputPerToken: 1,
  });
  assert.equal(Object.isFrozen(result), true);
});

test('capture awaits required usage handoff and propagates write failure', async () => {
  let release!: () => void;
  let done = false;
  const pending = captureAttemptUsage(
    { ...input, priceSnapshot: price },
    {
      writeUsage: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    },
  ).then(() => {
    done = true;
  });
  await Promise.resolve();
  assert.equal(done, false);
  release();
  await pending;
  assert.equal(done, true);
  const failure = new Error('durable handoff failed');
  await assert.rejects(
    captureAttemptUsage(
      { ...input, priceSnapshot: price },
      {
        writeUsage: async () => {
          throw failure;
        },
      },
    ),
    (error) => error === failure,
  );
});

test('migrated PostgreSQL records estimates once and exposes existing JSON/CSV version columns', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL('../migrations/001_usage_records.sql', import.meta.url), 'utf8'),
    );
    const client = {
      query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]),
    };
    const writeUsage = createPostgresUsageLedger(client);
    const capture = (priceSnapshot: FlatTokenPriceSnapshot) =>
      captureAttemptUsage({ ...input, priceSnapshot }, { now: () => 1010, writeUsage });
    await capture(price);
    await capture(price);
    await assert.rejects(
      capture({ ...price, priceVersion: 'different-version' }),
      UsageLedgerConflict,
    );
    const reader = createPostgresUsageReader(client);
    const page = await reader({ principalId: 'human-1', limit: 10, cursor: null });
    assert.equal(page.records.length, 1);
    const row = page.records[0];
    assert.ok(row);
    const json = projectUsageJson(row);
    assert.deepEqual(json.estimatedCost, {
      amountDecimal: '0.500000000000000003',
      currency: 'USD',
      priceVersion: 'price-v1',
    });
    assert.equal(json.costComparison.status, 'estimate_only');
    assert.equal(json.upstreamBilledCost, null);
    const csv = serializeUsageCsv(page.records);
    assert.match(csv, /"estimated_amount","estimated_currency","price_version"/);
    assert.match(csv, /"0\.500000000000000003","USD","price-v1"/);
    assert.match(csv, /estimate_only/);
    assert.equal(
      (await reader({ principalId: 'other-human', limit: 10, cursor: null })).records.length,
      0,
    );
  } finally {
    await db.close();
  }
});

test('provider price-looking fields cannot supply trusted prices or reported invoices', async () => {
  const records: UsageRecord[] = [];
  await captureAttemptUsage(
    {
      ...input,
      response: {
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5, cost: 0 },
        priceSnapshot: price,
        estimatedCost: { amountDecimal: '0', currency: 'USD', priceVersion: 'spoofed' },
      },
    },
    {
      writeUsage: async (record) => {
        records.push(record);
      },
    },
  );
  assert.equal(records[0]?.estimatedCost, null);
  assert.equal(records[0]?.upstreamBilledCost, null);
});

test('disabled accounting never evaluates a new optional price getter', async () => {
  await captureAttemptUsage(
    {
      ...input,
      get priceSnapshot(): FlatTokenPriceSnapshot {
        throw new Error('must not read');
      },
    },
    {},
  );
});
