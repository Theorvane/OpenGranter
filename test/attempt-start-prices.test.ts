import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { invokeDelegatedRoute } from '../src/routing/invoke-delegated-route.ts';
import {
  DirectProviderFailure,
  invokeManagedRoute,
} from '../src/routing/invoke-jev-managed-route.ts';
import { serializeUsageCsv } from '../src/usage/csv.ts';
import { projectUsageJson } from '../src/usage/json.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { createPostgresUsageReader } from '../src/usage/postgres-reader.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

const base = {
  principalId: 'person',
  credentialId: 'cred',
  policyVersions: [],
  requestId: 'req',
  routeVersion: 'v1',
  principalActive: true,
  modelAlias: 'chat',
  statements: [
    { effect: 'Allow' as const, actions: ['llm:InvokeModel'], resources: ['model:chat'] },
    { effect: 'Allow' as const, actions: ['llm:UseProvider'], resources: ['provider:*'] },
  ],
};
const response = { usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } };
function price(version = 'price-1') {
  return {
    kind: 'flat-token' as const,
    priceVersion: version,
    currency: 'USD',
    inputPerToken: '0.1',
    outputPerToken: '0.2',
  };
}
const candidate = {
  id: 'c1',
  kind: 'managed' as const,
  providerId: 'p1',
  upstreamModelId: 'vendor/model',
};

test('managed snapshots trusted prices before invocation, not after mutable source changes', async () => {
  const records: UsageRecord[] = [];
  const source = price();
  const contexts: unknown[] = [];
  const result = await invokeManagedRoute({
    ...base,
    candidates: [candidate],
    ports: {
      checkLimit: async () => true,
      resolveSecret: async () => undefined,
      writeAudit: async () => {},
      now: () => 100,
      writeUsage: async (record) => {
        records.push(record);
      },
      resolveAttemptPrice: (context) => {
        assert.ok(Object.isFrozen(context));
        contexts.push(context);
        return source;
      },
      invokeDirect: async () => {
        assert.equal(contexts.length, 1);
        source.priceVersion = 'changed';
        source.inputPerToken = '999';
        return response;
      },
    },
  });
  assert.equal(result.status, 'invoked');
  assert.deepEqual(contexts, [
    {
      requestId: 'req',
      routeVersion: 'v1',
      routeKind: 'managed',
      modelAlias: 'chat',
      upstreamModelId: 'vendor/model',
      selectedCandidateId: 'c1',
      attemptNumber: 1,
      startedAt: 100,
    },
  ]);
  assert.deepEqual(records[0]?.estimatedCost, {
    amountDecimal: '0.7',
    currency: 'USD',
    priceVersion: 'price-1',
  });
});

test('delegated snapshots once before dispatch and ignores provider spoofed prices', async () => {
  const records: UsageRecord[] = [];
  let calls = 0;
  const result = await invokeDelegatedRoute({
    ...base,
    credentialRef: 'ref',
    candidates: [{ ...candidate, kind: 'delegated' }],
    request: { model: 'chat', messages: [] },
    ports: {
      checkLimit: async () => true,
      writeAudit: async () => {},
      resolveVerifiedProviderSlug: async () => 'OpenAI',
      resolveAttemptPrice: () => {
        calls++;
        return price();
      },
      writeUsage: async (record) => {
        records.push(record);
      },
      invokeOpenRouter: async () => {
        assert.equal(calls, 1);
        return { ...response, priceSnapshot: price('spoof') };
      },
    },
  });
  assert.equal(result.status, 'invoked');
  assert.equal(calls, 1);
  assert.equal(records[0]?.estimatedCost?.priceVersion, 'price-1');
});

for (const mode of ['managed', 'delegated'] as const) {
  async function run(options: {
    resolve: () => ReturnType<typeof price> | null;
    disabled?: boolean;
    denied?: boolean;
    invoke?: () => Promise<typeof response>;
  }) {
    const records: UsageRecord[] = [];
    const audit: unknown[] = [];
    let invoked = 0;
    const common = {
      checkLimit: async () => !options.denied,
      writeAudit: async (event: unknown) => {
        audit.push(event);
      },
      resolveAttemptPrice: options.resolve,
      ...(options.disabled
        ? {}
        : {
            writeUsage: async (record: UsageRecord) => {
              records.push(record);
            },
          }),
    };
    const invoke = async () => {
      invoked++;
      return options.invoke ? options.invoke() : response;
    };
    const result =
      mode === 'managed'
        ? await invokeManagedRoute({
            ...base,
            candidates: [candidate],
            ports: { ...common, resolveSecret: async () => undefined, invokeDirect: invoke },
          })
        : await invokeDelegatedRoute({
            ...base,
            credentialRef: 'ref',
            candidates: [{ ...candidate, kind: 'delegated' }],
            request: { model: 'chat', messages: [] },
            ports: {
              ...common,
              resolveVerifiedProviderSlug: async () => 'OpenAI',
              invokeOpenRouter: invoke,
            },
          });
    return { result, records, audit, invoked };
  }
  test(`${mode} rejects a throwing or malformed price before dispatch without a billed attempt`, async () => {
    for (const resolve of [
      () => {
        throw new Error('private price lookup');
      },
      () => ({ ...price(), inputPerToken: 'private malformed' }),
    ]) {
      const { result, records, audit, invoked } = await run({ resolve });
      assert.deepEqual(result, {
        status: 'failed',
        reason: 'usage-unavailable',
        possiblyBilled: false,
      });
      assert.equal(invoked, 0);
      assert.deepEqual(records, []);
      const failure = audit.at(-1) as { kind: string; possiblyBilled: boolean };
      assert.equal(failure.kind, 'usage-handoff-failed');
      assert.equal(failure.possiblyBilled, false);
      assert.equal(JSON.stringify({ result, records, audit }).includes('private'), false);
    }
  });
  test(`${mode} skips pricing for disabled accounting and denied requests`, async () => {
    let resolved = 0;
    const resolve = () => {
      resolved++;
      throw new Error('must not resolve');
    };
    assert.equal((await run({ resolve, disabled: true })).result.status, 'invoked');
    assert.equal((await run({ resolve, denied: true })).result.status, 'denied');
    assert.equal(resolved, 0);
  });
  test(`${mode} missing price or missing counters remain unknown, not zero`, async () => {
    const absent = await run({ resolve: () => null });
    assert.equal(absent.result.status, 'invoked');
    assert.equal(absent.records[0]?.estimatedCost, null);
    const missing = await run({
      resolve: () => price(),
      invoke: async () => ({}) as typeof response,
    });
    assert.equal(missing.result.status, 'invoked');
    assert.equal(missing.records[0]?.estimatedCost, null);
  });
}

test('managed fallback captures candidate-specific versions, preserving earlier billing and failed unknown cost', async () => {
  const records: UsageRecord[] = [];
  const captured: string[] = [];
  const second = { ...candidate, id: 'c2', providerId: 'p2' };
  const result = await invokeManagedRoute({
    ...base,
    candidates: [candidate, second],
    ports: {
      checkLimit: async () => true,
      resolveSecret: async () => undefined,
      writeAudit: async () => {},
      resolveAttemptPrice: (context) => {
        captured.push(context.selectedCandidateId ?? 'none');
        return price(context.selectedCandidateId ?? 'none');
      },
      writeUsage: async (record) => {
        records.push(record);
      },
      invokeDirect: async (selected) => {
        assert.equal(captured.at(-1), selected.id);
        if (selected.id === 'c1') throw new DirectProviderFailure('server-error', false, true);
        return response;
      },
    },
  });
  assert.equal(result.status, 'invoked');
  assert.deepEqual(captured, ['c1', 'c2']);
  assert.equal(records.length, 2);
  assert.equal(records[0]?.estimatedCost, null);
  assert.equal(records[1]?.estimatedCost?.priceVersion, 'c2');
  assert.equal(records[1]?.possibleDuplicate, true);
});

test('managed later pricing failure cannot dispatch fallback or erase earlier potentially billed attempts', async () => {
  const records: UsageRecord[] = [];
  let invoked = 0;
  const result = await invokeManagedRoute({
    ...base,
    candidates: [candidate, { ...candidate, id: 'c2' }],
    ports: {
      checkLimit: async () => true,
      resolveSecret: async () => undefined,
      writeAudit: async () => {},
      resolveAttemptPrice: (context) => {
        if (context.attemptNumber === 2) throw new Error('private');
        return price();
      },
      writeUsage: async (record) => {
        records.push(record);
      },
      invokeDirect: async () => {
        invoked++;
        throw new DirectProviderFailure('server-error', false, true);
      },
    },
  });
  assert.deepEqual(result, { status: 'failed', reason: 'usage-unavailable', possiblyBilled: true });
  assert.equal(invoked, 1);
  assert.equal(records.length, 1);
});

test('price fields are detached once and frozen by the shared snapshot helper', async () => {
  const { captureAttemptPrice } = await import('../src/usage/capture-attempt.ts');
  let reads = 0;
  const source = {
    ...price(),
    get inputPerToken() {
      reads++;
      return '0.1';
    },
  };
  const snapshot = captureAttemptPrice(
    { writeUsage: async () => {}, resolveAttemptPrice: () => source },
    {
      requestId: 'req',
      routeVersion: 'v1',
      routeKind: 'managed',
      modelAlias: 'chat',
      upstreamModelId: 'model',
      selectedCandidateId: 'c1',
      attemptNumber: 1,
      startedAt: 100,
    },
  );
  assert.equal(reads, 1);
  assert.ok(Object.isFrozen(snapshot));
  assert.notEqual(snapshot, source);
});

test('actual managed orchestration persists the attempt-start version through migrated SQL and JSON/CSV', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL('../migrations/001_usage_records.sql', import.meta.url), 'utf8'),
    );
    const client = {
      query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]),
    };
    const source = price('at-start');
    const result = await invokeManagedRoute({
      ...base,
      candidates: [candidate],
      ports: {
        now: () => 100,
        checkLimit: async () => true,
        resolveSecret: async () => undefined,
        writeAudit: async () => {},
        writeUsage: createPostgresUsageLedger(client),
        resolveAttemptPrice: () => source,
        invokeDirect: async () => {
          source.priceVersion = 'after-dispatch';
          source.outputPerToken = '99';
          return response;
        },
      },
    });
    assert.equal(result.status, 'invoked');
    const read = createPostgresUsageReader(client);
    const page = await read({ principalId: 'person', limit: 10, cursor: null });
    assert.equal(page.records.length, 1);
    const row = page.records[0];
    assert.ok(row);
    assert.deepEqual(projectUsageJson(row).estimatedCost, {
      amountDecimal: '0.7',
      currency: 'USD',
      priceVersion: 'at-start',
    });
    assert.match(serializeUsageCsv(page.records), /"0\.7","USD","at-start"/);
    assert.equal(projectUsageJson(row).upstreamBilledCost, null);
    assert.equal(
      (await read({ principalId: 'foreign', limit: 10, cursor: null })).records.length,
      0,
    );
  } finally {
    await db.close();
  }
});

test('delegated multi-provider selection exposes null selected candidate, never inventing actual provider pricing', async () => {
  let selected: string | null | undefined;
  const result = await invokeDelegatedRoute({
    ...base,
    credentialRef: 'ref',
    candidates: [
      { ...candidate, kind: 'delegated' },
      { ...candidate, kind: 'delegated', id: 'c2', providerId: 'p2' },
    ],
    request: { model: 'chat', messages: [] },
    ports: {
      checkLimit: async () => true,
      writeAudit: async () => {},
      writeUsage: async (record) => {
        assert.equal(record.estimatedCost, null);
      },
      resolveVerifiedProviderSlug: async (id) => (id === 'p1' ? 'OpenAI' : 'Anthropic'),
      resolveAttemptPrice: (context) => {
        selected = context.selectedCandidateId;
        assert.equal(context.routeVersion, 'v1');
        return null;
      },
      invokeOpenRouter: async () => response,
    },
  });
  assert.equal(result.status, 'invoked');
  assert.equal(selected, null);
});
