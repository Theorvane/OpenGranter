import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresAuditHistoryReader } from '../src/audit/postgres-audit-history.ts';
import type { MigrationConnection } from '../src/storage/postgres-migrations.ts';
import { serializeUsageCsv } from '../src/usage/csv.ts';
import {
  createDurableReservations,
  ReservationFailure,
  type ReservationInput,
  type SettlementEvidence,
} from '../src/usage/durable-reservations.ts';
import { projectUsageJson } from '../src/usage/json.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

function connection(db: PGlite): MigrationConnection {
  return {
    transaction: (callback) =>
      db.transaction((tx) =>
        callback({
          exec: (sql) => tx.exec(sql),
          query: (sql, params) => tx.query(sql, [...params]),
        }),
      ),
  };
}

const files = ['001_usage_records.sql', '003_gateway_audit.sql', '015_durable_reservations.sql'];
function input(requestId = 'r1'): ReservationInput {
  return {
    requestId,
    principalId: 'person',
    credentialId: 'token',
    policyVersions: [{ id: 'iam', version: '1' }],
    principalActive: true,
    statements: [{ effect: 'Allow', actions: ['*'], resources: ['*'] }],
    modelAlias: 'chat',
    routeVersion: 'route1',
    requestBinding: 'bound1',
    expiresAt: 500,
    candidates: [
      {
        id: 'a',
        providerId: 'openai',
        transportProviderId: 'router',
        upstreamModelId: 'model',
        liability: '6',
        currency: 'USD',
        attestationId: 'ceiling1',
        validUntil: 10000,
      },
    ],
  };
}
function firstCandidate() {
  const value = input().candidates[0];
  assert.ok(value);
  return value;
}
function usage(attemptId = 'r1/managed/1', requestId = 'r1', candidateId = 'a') {
  return buildUsageRecord({
    requestId,
    attemptId,
    principalId: 'person',
    credentialId: 'token',
    policyVersions: [{ id: 'iam', version: '1' }],
    modelAlias: 'chat',
    routeKind: 'managed',
    upstreamModelId: 'model',
    selectedCandidateId: candidateId,
    actualInferenceProviderId: 'openai',
    occurredAt: 100,
    latencyMs: 1,
    outcome: 'failed',
    possiblyBilled: true,
    possibleDuplicate: false,
  });
}
async function setup(path?: string) {
  const db = new PGlite(path);
  for (const file of files)
    await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  await db.query(`INSERT INTO reservation_principals(principal_id,version,currency,window_ms,request_limit,budget,valid_until_ms)
    VALUES('person','v1','USD',1000,100,10,10000)`);
  let now = 100;
  const evidence = new Map<string, SettlementEvidence>();
  const ports = {
    connection: connection(db),
    now: () => now,
    resolveEvidence: async (id: string) => evidence.get(id),
  };
  return {
    db,
    ports,
    service: createDurableReservations(ports),
    evidence,
    setNow: (value: number) => {
      now = value;
    },
  };
}
async function admitted(service: ReturnType<typeof createDurableReservations>, value = input()) {
  const result = await service.reserve(value);
  assert.equal(result.status, 'admitted');
  if (result.status !== 'admitted') throw new Error('expected admission');
  return result.handle;
}

test('summed complete candidate liability and concurrent monetary admission are enforced', async () => {
  const f = await setup();
  try {
    const two = {
      ...input(),
      candidates: [...input().candidates, { ...firstCandidate(), id: 'b' }],
    };
    assert.equal((await f.service.reserve(two)).status, 'denied');
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => f.service.reserve(input(`r${i}`))),
    );
    assert.equal(results.filter((r) => r.status === 'admitted').length, 1);
  } finally {
    await f.db.close();
  }
});
test('model, transport, final provider and inactive/default/explicit Deny prevent admission and remain audited', async () => {
  const f = await setup();
  try {
    const denied = [
      { ...input(), statements: [] },
      { ...input(), principalActive: false },
      ...['model:chat', 'provider:openai', 'provider:router'].map((resource) => ({
        ...input(),
        statements: [
          ...input().statements,
          { effect: 'Deny' as const, actions: ['*'], resources: [resource] },
        ],
      })),
    ];
    for (const value of denied) assert.equal((await f.service.reserve(value)).status, 'denied');
    assert.equal((await f.db.query('SELECT * FROM routing_reservations')).rows.length, 0);
    const history = await createPostgresAuditHistoryReader({
      query: (sql, params) => f.db.query(sql, [...params]),
    })({ principalId: 'person', limit: 100 });
    assert.equal(history.events.length, 5);
    assert.ok(
      history.events.every((e) => e.kind === 'reservation' && e.details.action === 'denied'),
    );
  } finally {
    await f.db.close();
  }
});
test('missing/stale policy, currency mismatch and malformed liability fail closed', async () => {
  const f = await setup();
  try {
    assert.equal((await f.service.reserve({ ...input(), principalId: 'absent' })).status, 'denied');
    f.setNow(10000);
    assert.equal((await f.service.reserve(input())).status, 'denied');
    f.setNow(100);
    assert.equal(
      (
        await f.service.reserve({
          ...input(),
          candidates: input().candidates.map((c) => ({ ...c, currency: 'EUR' })),
        })
      ).status,
      'denied',
    );
    for (const liability of [
      '-1',
      'NaN',
      '0.00000000000000000000000000000000000000000000000000000000000000001',
    ]) {
      await assert.rejects(
        f.service.reserve({
          ...input(),
          candidates: input().candidates.map((c) => ({ ...c, liability })),
        }),
        ReservationFailure,
      );
    }
  } finally {
    await f.db.close();
  }
});
test('duplicate request observes state without execution authority and conflicting binding is rejected', async () => {
  const f = await setup();
  try {
    const handle = await admitted(f.service);
    assert.deepEqual(await f.service.reserve(input()), { status: 'existing' });
    await assert.rejects(
      f.service.reserve({ ...input(), requestBinding: 'other' }),
      ReservationFailure,
    );
    const results = await Promise.allSettled([
      f.service.start(handle, 'a'),
      f.service.start(handle, 'a'),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  } finally {
    await f.db.close();
  }
});
test('unknown handoff, completion and a new UTC window retain uncertain money', async () => {
  const f = await setup();
  try {
    const handle = await admitted(f.service);
    const attempt = await f.service.start(handle, 'a');
    await f.service.handoff('person', 'r1', usage(attempt));
    await f.service.complete(handle);
    await f.service.complete(handle);
    await assert.rejects(f.service.start(handle, 'a'), ReservationFailure);
    f.setNow(1100);
    assert.equal((await f.service.reserve({ ...input('r2'), expiresAt: 1500 })).status, 'denied');
    assert.deepEqual(await f.service.recover('person'), [attempt]);
  } finally {
    await f.db.close();
  }
});
test('usage and control audit failure roll back together; exact retries deduplicate, conflict preserves original', async () => {
  const f = await setup();
  try {
    const handle = await admitted(f.service);
    await f.service.start(handle, 'a');
    let fail = true;
    const faulty = createDurableReservations({
      ...f.ports,
      connection: {
        transaction: (callback) =>
          f.db.transaction((tx) =>
            callback({
              ...tx,
              query: async (sql, params) => {
                if (fail && sql.includes('INSERT INTO gateway_audit_events'))
                  throw new Error('private driver secret');
                return tx.query(sql, [...params]);
              },
            }),
          ),
      },
    });
    await assert.rejects(faulty.handoff('person', 'r1', usage()), ReservationFailure);
    assert.equal((await f.db.query('SELECT * FROM usage_records')).rows.length, 0);
    fail = false;
    await faulty.handoff('person', 'r1', usage());
    await faulty.handoff('person', 'r1', usage());
    await assert.rejects(
      faulty.handoff('person', 'r1', { ...usage(), latencyMs: 2 }),
      ReservationFailure,
    );
    assert.equal((await f.db.query('SELECT * FROM usage_records')).rows.length, 1);
    const row = (
      await f.db.query<{ record: ReturnType<typeof usage> }>('SELECT record FROM usage_records')
    ).rows[0];
    assert.ok(row);
    assert.equal(row.record.usage.status, 'missing');
    assert.equal(row.record.upstreamBilledCost, null);
  } finally {
    await f.db.close();
  }
});
test('expiry and disk restart fence stale execution while recovering unresolved attempt intent', async () => {
  const path = await mkdtemp(join(tmpdir(), 'reservation-restart-'));
  const f = await setup(path);
  let closed = false;
  try {
    const handle = await admitted(f.service);
    await f.service.start(handle, 'a');
    await f.db.close();
    closed = true;
    const reopened = new PGlite(path);
    try {
      const service = createDurableReservations({
        ...f.ports,
        connection: connection(reopened),
        now: () => 600,
      });
      assert.deepEqual(await service.recover('person'), ['r1/managed/1']);
      assert.deepEqual(await service.recover('person'), ['r1/managed/1']);
      await assert.rejects(service.start(handle, 'a'), ReservationFailure);
      await service.handoff('person', 'r1', usage());
      assert.equal((await service.reserve({ ...input('r2'), expiresAt: 900 })).status, 'denied');
    } finally {
      await reopened.close();
    }
  } finally {
    if (!closed) await f.db.close();
    await rm(path, { recursive: true, force: true });
  }
});
test('evidence-backed settlement is idempotent, preserves bill sources, rejects failure and blocks truthful overrun', async () => {
  const f = await setup();
  try {
    const handle = await admitted(f.service);
    await f.service.start(handle, 'a');
    await f.service.handoff('person', 'r1', usage());
    await assert.rejects(
      f.service.reconcile('person', 'r1', 'r1/managed/1', 'missing'),
      ReservationFailure,
    );
    f.evidence.set('bill1', {
      attemptId: 'r1/managed/1',
      amount: '7.0001',
      currency: 'USD',
      authority: 'invoice-review',
    });
    await f.service.reconcile('person', 'r1', 'r1/managed/1', 'bill1');
    await f.service.reconcile('person', 'r1', 'r1/managed/1', 'bill1');
    const debit = (
      await f.db.query<{ debit: string }>('SELECT debit::text FROM routing_reservation_attempts')
    ).rows[0]?.debit;
    assert.equal(debit, '7.0001');
    f.setNow(1100);
    assert.equal((await f.service.reserve({ ...input('r2'), expiresAt: 1500 })).status, 'denied');
    f.evidence.set('bill2', {
      attemptId: 'r1/managed/1',
      amount: '0',
      currency: 'USD',
      authority: 'invoice-review',
    });
    await assert.rejects(
      f.service.reconcile('person', 'r1', 'r1/managed/1', 'bill2'),
      ReservationFailure,
    );
  } finally {
    await f.db.close();
  }
});
test('a successful or response-started attempt cannot permit another fallback attempt', async () => {
  const f = await setup();
  try {
    const value = {
      ...input(),
      candidates: [...input().candidates, { ...firstCandidate(), id: 'b', liability: '1' }],
    };
    const handle = await admitted(f.service, value);
    await f.service.start(handle, 'a');
    await f.service.handoff('person', 'r1', { ...usage(), outcome: 'succeeded' });
    await assert.rejects(f.service.start(handle, 'b'), ReservationFailure);
  } finally {
    await f.db.close();
  }
});

test('fallback requires explicit pre-response classification and preserves possible duplicate accounting', async () => {
  const f = await setup();
  try {
    const value = {
      ...input(),
      candidates: [...input().candidates, { ...firstCandidate(), id: 'b', liability: '1' }],
    };
    const handle = await admitted(f.service, value);
    await f.service.start(handle, 'a');
    await f.service.handoff('person', 'r1', usage(), true);
    const attempt = await f.service.start(handle, 'b');
    assert.equal(attempt, 'r1/managed/2');
    await assert.rejects(
      f.service.handoff('person', 'r1', usage(attempt, 'r1', 'b')),
      ReservationFailure,
    );
    await f.service.handoff('person', 'r1', {
      ...usage(attempt, 'r1', 'b'),
      possibleDuplicate: true,
    });
    assert.equal((await f.db.query('SELECT * FROM usage_records')).rows.length, 2);
  } finally {
    await f.db.close();
  }
});
test('ambiguous admission commit observes existing state without granting another execution permit', async () => {
  const f = await setup();
  try {
    let first = true;
    const service = createDurableReservations({
      ...f.ports,
      connection: {
        transaction: async (callback) => {
          const result = await f.ports.connection.transaction(callback);
          if (first) {
            first = false;
            throw new Error('ack lost after commit');
          }
          return result;
        },
      },
    });
    await assert.rejects(service.reserve(input()), ReservationFailure);
    assert.deepEqual(await service.reserve(input()), { status: 'existing' });
    f.setNow(600);
    assert.deepEqual(await service.recover('person'), []);
    assert.equal((await service.reserve({ ...input('r2'), expiresAt: 900 })).status, 'admitted');
  } finally {
    await f.db.close();
  }
});
test('expiry releases only never-entered slots, never request quota; authoritative zero releases an entered hold', async () => {
  const f = await setup();
  try {
    await f.db.exec('UPDATE reservation_principals SET request_limit=1');
    const handle = await admitted(f.service);
    await f.service.start(handle, 'a');
    await f.service.handoff('person', 'r1', usage());
    f.evidence.set('zero', {
      attemptId: 'r1/managed/1',
      amount: '0',
      currency: 'USD',
      authority: 'verified-no-charge',
    });
    await f.service.reconcile('person', 'r1', 'r1/managed/1', 'zero');
    await f.service.complete(handle);
    assert.equal((await f.service.reserve(input('r2'))).status, 'denied');
    f.setNow(1100);
    assert.equal((await f.service.reserve({ ...input('r2'), expiresAt: 1500 })).status, 'admitted');
  } finally {
    await f.db.close();
  }
});
test('required admission audit failure leaves no reservation or quota consumed', async () => {
  const f = await setup();
  try {
    const service = createDurableReservations({
      ...f.ports,
      connection: {
        transaction: (callback) =>
          f.ports.connection.transaction((tx) =>
            callback({
              ...tx,
              query: (sql, params) => {
                if (sql.includes('INSERT INTO gateway_audit_events'))
                  throw new Error('private audit failure');
                return tx.query(sql, params);
              },
            }),
          ),
      },
    });
    await assert.rejects(service.reserve(input()), ReservationFailure);
    assert.equal((await f.db.query('SELECT * FROM routing_reservations')).rows.length, 0);
    await admitted(f.service);
  } finally {
    await f.db.close();
  }
});

test('expired liability attestation and changed admission policy cannot silently authorize replay', async () => {
  const f = await setup();
  try {
    assert.equal(
      (
        await f.service.reserve({
          ...input('stale'),
          candidates: input().candidates.map((c) => ({ ...c, validUntil: 50 })),
        })
      ).status,
      'denied',
    );
    await admitted(f.service);
    await f.db.exec("UPDATE reservation_principals SET version='v2'");
    await assert.rejects(f.service.reserve(input()), ReservationFailure);
  } finally {
    await f.db.close();
  }
});

test('existing gateway accounting prevents a fresh reservation from replaying the same request identity', async () => {
  const f = await setup();
  try {
    await createPostgresUsageLedger({ query: (sql, params) => f.db.query(sql, [...params]) })(
      usage(),
    );
    assert.equal((await f.service.reserve(input())).status, 'denied');
  } finally {
    await f.db.close();
  }
});
test('admission retains the actual quota policy snapshot and rejects same-version policy drift on replay', async () => {
  const f = await setup();
  try {
    await admitted(f.service);
    const result = await f.db.query<{ policy_snapshot: { budget: string } }>(
      'SELECT policy_snapshot FROM routing_reservations',
    );
    assert.equal(result.rows[0]?.policy_snapshot.budget, '10');
    await f.db.exec('UPDATE reservation_principals SET budget=20');
    await assert.rejects(f.service.reserve(input()), ReservationFailure);
  } finally {
    await f.db.close();
  }
});

test('malformed persisted binding cannot redirect completion to another reservation', async () => {
  const f = await setup();
  try {
    const handle = await admitted(f.service);
    await f.db.query(
      "UPDATE routing_reservations SET binding=jsonb_set(binding,'{requestId}','\"other\"'::jsonb) WHERE request_id='r1'",
    );
    await assert.rejects(f.service.complete(handle), ReservationFailure);
    assert.notEqual(
      (
        await f.db.query<{ owner_token: string | null }>(
          'SELECT owner_token FROM routing_reservations',
        )
      ).rows[0]?.owner_token,
      null,
    );
  } finally {
    await f.db.close();
  }
});

test('clock refreshed after principal lock denies expired admission and expired attempt start', async () => {
  const f = await setup();
  try {
    const delayed = createDurableReservations({
      ...f.ports,
      connection: {
        transaction: (callback) =>
          f.ports.connection.transaction((tx) =>
            callback({
              ...tx,
              query: async (sql, params) => {
                const result = await tx.query(sql, params);
                if (sql.includes('FOR UPDATE')) f.setNow(600);
                return result;
              },
            }),
          ),
      },
    });
    assert.equal((await delayed.reserve(input('expired'))).status, 'denied');
    f.setNow(100);
    const handle = await admitted(f.service);
    await assert.rejects(delayed.start(handle, 'a'), ReservationFailure);
  } finally {
    await f.db.close();
  }
});
test('authoritative recovery settles lost handoff using existing immutable unknown accounting without fabricated latency or outcome', async () => {
  const f = await setup();
  try {
    const handle = await admitted(f.service);
    const attempt = await f.service.start(handle, 'a');
    f.setNow(600);
    assert.deepEqual(await f.service.recover('person'), [attempt]);
    f.evidence.set('zero', {
      attemptId: attempt,
      amount: '0',
      currency: 'USD',
      authority: 'verified-no-charge',
    });
    await f.service.reconcile('person', 'r1', attempt, 'zero');
    await f.service.reconcile('person', 'r1', attempt, 'zero');
    const rows = await f.db.query<{ record: unknown }>('SELECT record FROM usage_records');
    assert.equal(rows.rows.length, 1);
    const json = projectUsageJson(rows.rows[0]?.record);
    assert.equal(json.outcome, 'unknown');
    assert.equal(json.latencyMs, null);
    assert.equal(json.occurredAt, 100);
    assert.equal(json.actualInferenceProviderId, null);
    assert.equal(json.usage.status, 'missing');
    assert.equal(json.estimatedCost, null);
    assert.equal(json.upstreamBilledCost, null);
    assert.equal(json.possiblyBilled, true);
    const csv = serializeUsageCsv([json]);
    assert.match(csv, /"100","","unknown"/u);
    await assert.rejects(f.service.handoff('person', 'r1', usage()), ReservationFailure);
    assert.deepEqual(await f.service.recover('person'), []);
  } finally {
    await f.db.close();
  }
});

test('recovery cannot settle active execution and required recovery audit failure rolls back accounting and liability together', async () => {
  const f = await setup();
  try {
    const handle = await admitted(f.service);
    const attempt = await f.service.start(handle, 'a');
    f.evidence.set('zero', {
      attemptId: attempt,
      amount: '0',
      currency: 'USD',
      authority: 'verified-no-charge',
    });
    await assert.rejects(f.service.reconcile('person', 'r1', attempt, 'zero'), ReservationFailure);
    f.setNow(600);
    await f.service.recover('person');
    const faulty = createDurableReservations({
      ...f.ports,
      connection: {
        transaction: (callback) =>
          f.ports.connection.transaction((tx) =>
            callback({
              ...tx,
              query: (sql, params) => {
                if (sql.includes('INSERT INTO gateway_audit_events'))
                  throw new Error('private recovery audit failure');
                return tx.query(sql, params);
              },
            }),
          ),
      },
    });
    await assert.rejects(faulty.reconcile('person', 'r1', attempt, 'zero'), ReservationFailure);
    assert.equal((await f.db.query('SELECT * FROM usage_records')).rows.length, 0);
    const rows = await f.db.query<{ handed_off: boolean; debit: string | null }>(
      'SELECT handed_off,debit::text FROM routing_reservation_attempts',
    );
    assert.equal(rows.rows[0]?.handed_off, false);
    assert.equal(rows.rows[0]?.debit, null);
    await f.service.reconcile('person', 'r1', attempt, 'zero');
    assert.equal((await f.db.query('SELECT * FROM usage_records')).rows.length, 1);
  } finally {
    await f.db.close();
  }
});
test('unknown recovery accounting rejects invented latency, actual provider, counts and bills while known outcomes require latency', () => {
  const unknown = {
    ...usage(),
    outcome: 'unknown',
    latencyMs: null,
    actualInferenceProviderId: null,
  };
  assert.equal(projectUsageJson(unknown).outcome, 'unknown');
  for (const invalid of [
    { ...unknown, latencyMs: 0 },
    { ...unknown, actualInferenceProviderId: 'openai' },
    { ...unknown, possiblyBilled: false },
    {
      ...unknown,
      usage: { status: 'reported', promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    },
    { ...unknown, estimatedCost: { amountDecimal: '0', currency: 'USD', priceVersion: 'fake' } },
    {
      ...unknown,
      upstreamBilledCost: { amountDecimal: '0', currency: 'USD', source: 'direct-provider' },
    },
    { ...usage(), latencyMs: null },
  ])
    assert.throws(() => projectUsageJson(invalid));
});

test('atomic admission cannot grant two requests the last quota allowance', async () => {
  const db = new PGlite();
  try {
    for (const file of [
      '001_usage_records.sql',
      '003_gateway_audit.sql',
      '015_durable_reservations.sql',
    ]) {
      await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    }
    await db.query(`INSERT INTO reservation_principals
      (principal_id, version, currency, window_ms, request_limit, budget, valid_until_ms)
      VALUES ('person', 'v1', 'USD', 1000, 1, 100, 10000)`);
    const service = createDurableReservations({
      connection: connection(db),
      now: () => 100,
      resolveEvidence: async () => undefined,
    });
    const input = (requestId: string) => ({
      requestId,
      principalId: 'person',
      credentialId: 'token',
      policyVersions: [{ id: 'iam', version: '1' }],
      principalActive: true,
      statements: [{ effect: 'Allow' as const, actions: ['*'], resources: ['*'] }],
      modelAlias: 'chat',
      routeVersion: 'route1',
      requestBinding: 'input-output-bound1',
      candidates: [
        {
          id: 'a',
          providerId: 'openai',
          transportProviderId: 'openai',
          upstreamModelId: 'model',
          liability: '6',
          currency: 'USD',
          attestationId: 'ceiling1',
          validUntil: 10000,
        },
      ],
      expiresAt: 500,
    });
    const results = await Promise.all([service.reserve(input('r1')), service.reserve(input('r2'))]);
    assert.equal(results.filter((result) => result.status === 'admitted').length, 1);
    assert.equal(results.filter((result) => result.status === 'denied').length, 1);
  } finally {
    await db.close();
  }
});
