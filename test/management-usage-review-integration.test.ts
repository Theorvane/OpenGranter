import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresSsoUsageHistoryHandler } from '../src/gateway/postgres-sso-usage-history-http.ts';
import { createUsageReview } from '../src/management/usage-review.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

test('signed SSO usage screen composes JSON/CSV, scoped migrated storage, durable audit and fresh Deny', async () => {
  const jwt = await createSsoAccessTokenFixture();
  const token = await jwt.token();
  const db = new PGlite();
  try {
    for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
    await db.exec(`INSERT INTO iam_principals VALUES ('human', 'human', true);
      INSERT INTO iam_policies VALUES ('reader', 'v1', '[{"effect":"Allow","actions":["usage:ReadSelf"],"resources":["principal:human"]}]');
      INSERT INTO iam_principal_policies VALUES ('human', 'reader');`);
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1, $2, $3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    let auditFails = false;
    const client = {
      query: (sql: string, params: readonly unknown[]) => {
        if (auditFails && sql.includes('INSERT INTO sso_usage_audit_events'))
          throw new Error('PRIVATE');
        return db.query(sql, [...params]);
      },
    };
    const write = createPostgresUsageLedger(client);
    for (const [principalId, attemptId] of [
      ['human', 'a'],
      ['human', 'z'],
      ['other', 'foreign'],
    ] as const) {
      await write(
        buildUsageRecord({
          principalId,
          attemptId,
          occurredAt: 100,
          credentialId: 'historical',
          policyVersions: [],
          requestId: 'inference',
          modelAlias: 'chat',
          routeKind: 'managed',
          upstreamModelId: 'upstream',
          selectedCandidateId: 'candidate',
          latencyMs: 2,
          outcome: 'succeeded',
          possiblyBilled: true,
          possibleDuplicate: true,
          estimatedCost: { amountDecimal: '0.0100', currency: 'USD', priceVersion: 'v1' },
        }),
      );
    }
    const handler = createPostgresSsoUsageHistoryHandler({
      ...jwt.config,
      client,
      newRequestId: () => 'review',
    });
    let calls = 0;
    const review = createUsageReview(async (path, init) => {
      calls++;
      return handler(
        new Request(`https://management.test${path}`, {
          ...init,
          headers: { ...init.headers, authorization: `Bearer ${token}` },
        }),
      );
    });
    await review.load({ model: 'chat', fromMs: 0, toMs: 101, limit: 1 });
    assert.equal(review.snapshot().state, 'ready');
    assert.equal(review.snapshot().data[0]?.attemptId, 'z');
    assert.equal(review.snapshot().data[0]?.costComparison.status, 'estimate_only');
    assert.equal(review.snapshot().data[0]?.usage.totalTokens, null);
    assert.equal(review.snapshot().data[0]?.possibleDuplicate, true);
    auditFails = true;
    await review.next();
    assert.equal(review.snapshot().state, 'unavailable');
    assert.deepEqual(review.snapshot().data, []);
    assert.equal((await review.exportCsv()).state, 'unavailable');
    auditFails = false;
    await review.retry();
    assert.equal(review.snapshot().data[0]?.attemptId, 'a');
    const csv = await review.exportCsv();
    assert.equal(csv.state, 'ready');
    if (csv.state === 'ready') {
      assert.match(csv.csv, /estimate_only/u);
      assert.match(csv.csv, /0.0100/u);
      assert.doesNotMatch(csv.csv, /foreign|PRIVATE/u);
      assert.equal(csv.csv.split('\n').filter(Boolean).length, 2);
    }
    await review.previous();
    assert.equal(review.snapshot().data[0]?.attemptId, 'z');
    await review.load({ model: 'absent' });
    assert.equal(review.snapshot().state, 'empty');
    await db.query('UPDATE iam_policies SET version = $1, statements = $2::jsonb', [
      'v2',
      JSON.stringify([{ effect: 'Deny', actions: ['usage:*'], resources: ['principal:*'] }]),
    ]);
    assert.equal((await review.exportCsv()).state, 'denied');
    assert.equal(review.snapshot().state, 'denied');
    assert.deepEqual(review.snapshot().data, []);
    const before = calls;
    await review.load();
    await review.retry();
    assert.equal(calls, before);
    const accesses = (
      await db.query<{ outcome: string }>(
        'SELECT outcome FROM sso_usage_audit_events ORDER BY event_id',
      )
    ).rows;
    assert.deepEqual(
      accesses.map((entry) => entry.outcome),
      ['ready', 'ready', 'ready', 'ready', 'ready', 'forbidden'],
    );
    assert.doesNotMatch(JSON.stringify(review.snapshot()), /foreign|PRIVATE|Bearer/u);
    review.dispose();
  } finally {
    await db.close();
  }
});
