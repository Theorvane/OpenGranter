import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresSsoCanonicalReviewHandler } from '../src/gateway/postgres-sso-canonical-review-http.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
interface UsageResponse {
  readonly data: readonly (import('../src/usage/record-usage.ts').UsageRecord & {
    costComparison: import('../src/usage/cost-comparison.ts').UsageCostComparison;
  })[];
  readonly has_more: boolean;
  readonly next_cursor: string | null;
}
async function json(response: Response): Promise<UsageResponse> {
  return (await response.json()) as UsageResponse;
}
async function fixture() {
  const db = new PGlite();
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
  await db.exec(`INSERT INTO iam_principals VALUES ('human', 'human', true);
    INSERT INTO iam_policies VALUES ('reader', 'v1', '[{"effect":"Allow","actions":["usage:ReadSelf"],"resources":["principal:human"]}]');
    INSERT INTO iam_principal_policies VALUES ('human', 'reader');`);
  await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1, $2, $3)', [
    jwt.issuer,
    jwt.subject,
    'human',
  ]);
  let sqlFailure = false;
  let auditFailure = false;
  let auditHook = async () => {};
  const sql: string[] = [];
  const client = {
    query: (query: string, params: readonly unknown[]) => {
      sql.push(query);
      if (sqlFailure && query.includes('FROM usage_records')) throw Error('private SQL cause');
      if (query.includes('INSERT INTO sso_usage_audit_events')) {
        if (auditFailure) throw Error('private audit cause');
        return auditHook().then(() => db.query(query, [...params]));
      }
      return db.query(query, [...params]);
    },
  };
  const write = createPostgresUsageLedger(client);
  for (const [principalId, attemptId, occurredAt] of [
    ['human', 'c', 300],
    ['human', 'b', 200],
    ['human', 'a', 100],
    ['other', 'foreign', 400],
  ] as const) {
    await write(
      buildUsageRecord({
        principalId,
        attemptId,
        occurredAt,
        credentialId: 'prior-proxy',
        policyVersions: [],
        requestId: attemptId === 'a' ? 'unrelated' : 'Trace:/A+1',
        modelAlias: 'chat',
        routeKind: 'managed',
        upstreamModelId: 'upstream',
        selectedCandidateId: 'candidate',
        latencyMs: 2,
        outcome: 'succeeded',
        possiblyBilled: true,
        possibleDuplicate: false,
        ...(attemptId === 'c'
          ? {
              estimatedCost: {
                amountDecimal: '9007199254740993.000000000000000001',
                currency: 'USD',
                priceVersion: 'v1',
              },
              upstreamBilledCost: {
                amountDecimal: '9007199254740993.000000000000000002',
                currency: 'USD',
                source: 'openrouter',
              },
            }
          : {}),
      }),
    );
  }
  const handler = createPostgresSsoCanonicalReviewHandler({
    ...jwt.config,
    client,
    newRequestId: () => 'read-1',
    ...{
      writeAudit: async () => {
        throw Error('forged override');
      },
    },
  });
  const request = (query = '', credential = token) =>
    handler(
      new Request(`https://management.test/management/v1/usage${query}`, {
        headers: { authorization: `Bearer ${credential}` },
      }),
    );
  return {
    db,
    sql,
    request,
    failSql: () => {
      sqlFailure = true;
    },
    failAudit: () => {
      auditFailure = true;
    },
    hook: (hook: () => Promise<void>) => {
      auditHook = hook;
    },
  };
}

test('canonical signed SSO traces exact requests without dropping comparisons or audit', {
  timeout: 30000,
}, async () => {
  const f = await fixture();
  try {
    const query = new URLSearchParams({ request_id: 'Trace:/A+1', model: 'chat', limit: '1' });
    const first = await f.request('?' + query);
    assert.equal(first.status, 200);
    const page = await json(first);
    assert.equal(page.data.length, 1);
    assert.equal(page.data[0]?.attemptId, 'c');
    assert.deepEqual(page.data[0]?.costComparison, {
      status: 'reported_above_estimate',
      reportedMinusEstimated: '0.000000000000000001',
      currency: 'USD',
    });
    assert.equal(page.has_more, true);
    assert.ok(page.next_cursor);
    query.set('cursor', page.next_cursor);
    const next = await json(await f.request('?' + query));
    assert.deepEqual(
      next.data.map((row) => row.attemptId),
      ['b'],
    );
    assert.equal(next.has_more, false);
    query.delete('cursor');
    query.set('format', 'csv');
    const csv = await f.request('?' + query);
    assert.equal(csv.status, 200);
    const text = await csv.text();
    assert.ok(text.includes('reported_above_estimate'));
    assert.ok(text.includes('0.000000000000000001'));
    assert.ok(!text.includes('foreign'));
    assert.ok(!text.includes(token));
    assert.equal((await f.request('?request_id=Trace%3A%2FA%2B1&principal_id=other')).status, 403);
    const empty = await json(await f.request('?request_id=trace%3A%2FA%2B1'));
    assert.deepEqual(empty.data, []);
    assert.equal((await f.request('?request_id=bad%20id')).status, 400);
    const audit = await f.db.query('SELECT * FROM sso_usage_audit_events');
    assert.equal(audit.rows.length, 6);
    f.failAudit();
    const withheld = await f.request('?request_id=Trace%3A%2FA%2B1');
    assert.equal(withheld.status, 503);
    assert.ok(!(await withheld.text()).includes('amountDecimal'));
  } finally {
    await f.db.close();
  }
});
