import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoManagementGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import { createSsoUsageClient } from '../src/management/usage-client.ts';
import { createSsoUsageExportClient } from '../src/management/usage-export-client.ts';
import { createUsageReview } from '../src/management/usage-review.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

test('owned HTTP request-scoped usage clients preserve SQL isolation, opaque paging, CSV, fresh IAM and mandatory audit', async () => {
  const jwt = await createSsoAccessTokenFixture();
  const token = await jwt.token();
  const db = new PGlite();
  let auditFailure = false;
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
      if (auditFailure && sql.includes('INSERT INTO sso_usage_audit_events'))
        throw Error('PRIVATE audit outage');
      return db.query(sql, [...params]);
    },
  };
  const runtime = await startPostgresSsoManagementGateway({
    ...jwt.config,
    host: '127.0.0.1',
    port: 0,
    openConnection: () => client,
    newRequestId: () => 'usage-inspection',
  });
  const paths: string[] = [];
  const request = async (
    path: string,
    init: Parameters<import('../src/management/catalog-client.ts').CatalogRequest>[1],
  ) => {
    paths.push(path);
    return fetch(`http://127.0.0.1:${runtime.address.port}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
    });
  };
  try {
    await db.exec(`INSERT INTO iam_principals VALUES ('human','human',true);
      INSERT INTO iam_policies VALUES ('reader','v1','[{"effect":"Allow","actions":["usage:ReadSelf","usage:ReadAll"],"resources":["principal:human"]}]');
      INSERT INTO iam_principal_policies VALUES ('human','reader');`);
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    const write = createPostgresUsageLedger(client);
    for (const [attemptId, requestId, principalId, occurredAt] of [
      ['a3', 'req:A+1/@x', 'human', 300],
      ['a2', 'req:A+1/@x', 'human', 200],
      ['other-request', 'different', 'human', 400],
      ['other-principal', 'req:A+1/@x', 'other', 500],
    ] as const)
      await write(
        buildUsageRecord({
          principalId,
          credentialId: 'old',
          policyVersions: [],
          requestId,
          attemptId,
          occurredAt,
          modelAlias: 'chat',
          routeKind: 'managed',
          upstreamModelId: 'up',
          selectedCandidateId: 'c',
          latencyMs: 1,
          outcome: 'succeeded',
          possiblyBilled: true,
          possibleDuplicate: true,
        }),
      );
    const filters = { requestId: 'req:A+1/@x', principalId: 'human', model: 'chat', limit: 1 };
    const review = createUsageReview(request);
    await review.load(filters);
    assert.equal(review.snapshot().state, 'ready');
    assert.deepEqual(
      review.snapshot().data.map((r) => r.attemptId),
      ['a3'],
    );
    assert.equal(review.snapshot().canNext, true);
    await review.next();
    assert.deepEqual(
      review.snapshot().data.map((r) => r.attemptId),
      ['a2'],
    );
    assert.equal(review.snapshot().canPrevious, true);
    assert.equal(review.snapshot().canNext, false);
    const nextQuery = new URL(paths.at(-1) ?? '', 'http://local.invalid').searchParams;
    assert.equal(nextQuery.get('request_id'), filters.requestId);
    assert.ok(nextQuery.get('cursor'));
    const exported = await review.exportCsv();
    assert.equal(exported.state, 'ready');
    if (exported.state === 'ready') {
      assert.match(exported.csv, /req:A\+1\/@x/);
      assert.doesNotMatch(exported.csv, /other-request|other-principal|different/);
    }
    await review.previous();
    assert.deepEqual(
      review.snapshot().data.map((r) => r.attemptId),
      ['a3'],
    );
    const empty = await createSsoUsageClient(request).read({ requestId: 'absent' });
    assert.equal(empty.state, 'ready');
    if (empty.state === 'ready') assert.equal(empty.data.length, 0);
    auditFailure = true;
    assert.equal((await createSsoUsageClient(request).read(filters)).state, 'unavailable');
    assert.equal((await createSsoUsageExportClient(request).read(filters)).state, 'unavailable');
    auditFailure = false;
    await db.query('UPDATE iam_policies SET statements = $1::jsonb WHERE policy_id = $2', [
      JSON.stringify([
        { effect: 'Allow', actions: ['usage:ReadSelf'], resources: ['principal:human'] },
      ]),
      'reader',
    ]);
    const self = await createSsoUsageClient(request).read({ requestId: filters.requestId });
    assert.equal(self.state, 'ready');
    if (self.state === 'ready')
      assert.deepEqual(
        self.data.map((r) => r.attemptId),
        ['a3', 'a2'],
      );
    assert.equal((await createSsoUsageClient(request).read(filters)).state, 'denied');
    await db.exec(
      `UPDATE iam_policies SET statements = '[{"effect":"Deny","actions":["usage:ReadSelf","usage:ReadAll"],"resources":["principal:human"]}]'::jsonb`,
    );
    await review.retry();
    assert.equal(review.snapshot().state, 'denied');
    assert.equal(review.snapshot().data.length, 0);
    review.dispose();
  } finally {
    await runtime.close();
  }
});
