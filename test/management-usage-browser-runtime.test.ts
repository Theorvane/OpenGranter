import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { startPostgresSsoManagementGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

test('canonical usage browser artifact traverses owned HTTP runtime, scoped SQL, CSV and fresh Deny', async () => {
  const jwt = await createSsoAccessTokenFixture();
  const token = await jwt.token();
  const db = new PGlite();
  let runtime: Awaited<ReturnType<typeof startPostgresSsoManagementGateway>> | undefined;
  try {
    let auditFails = false;
    const client: PostgresConnection = {
      transaction: (callback) =>
        db.transaction((tx) =>
          callback({
            exec: (sql) => tx.exec(sql),
            query: (sql, params) => tx.query(sql, [...params]),
          }),
        ),
      close: () => db.close(),
      query: (sql, params) => {
        if (auditFails && sql.includes('INSERT INTO sso_usage_audit_events'))
          throw new Error('PRIVATE');
        return db.query(sql, [...params]);
      },
    };
    const javascript = await buildManagementBrowser({
      root: process.cwd(),
      entry: 'src/management/usage-review.ts',
    });
    const { createUsageReview } = (await import(
      `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
    )) as typeof import('../src/management/usage-review.ts');
    runtime = await startPostgresSsoManagementGateway({
      ...jwt.config,
      host: '127.0.0.1',
      port: 0,
      openConnection: () => client,
      newRequestId: () => 'review',
      browserJavascript: javascript,
    });
    await db.exec(`INSERT INTO iam_principals VALUES ('human', 'human', true);
      INSERT INTO iam_policies VALUES ('reader', 'v1', '[{"effect":"Allow","actions":["usage:ReadSelf"],"resources":["principal:human"]}]');
      INSERT INTO iam_principal_policies VALUES ('human', 'reader');`);
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1, $2, $3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
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
    const base = `http://127.0.0.1:${runtime.address.port}`;
    assert.equal(await (await fetch(`${base}/management/app.js`)).text(), javascript);
    let calls = 0;
    const review = createUsageReview(async (path, init) => {
      calls++;
      return fetch(base + path, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${token}` },
      });
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
    if (runtime) await runtime.close();
    else if (!db.closed) await db.close();
  }
});
