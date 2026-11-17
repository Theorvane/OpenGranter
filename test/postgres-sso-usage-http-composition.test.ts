import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresSsoUsageHistoryHandler } from '../src/gateway/postgres-sso-usage-history-http.ts';
import { createSsoUsageClient } from '../src/management/usage-client.ts';
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
        requestId: 'inference',
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
  const handler = createPostgresSsoUsageHistoryHandler({
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

test('concrete composition persists signed SSO attribution for JSON, CSV and empty pages', async () => {
  const f = await fixture();
  try {
    const response = await f.request('?limit=1');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const page = await json(response);
    assert.equal(page.data[0]?.attemptId, 'c');
    assert.deepEqual(page.data[0]?.costComparison, {
      status: 'reported_above_estimate',
      reportedMinusEstimated: '0.000000000000000001',
      currency: 'USD',
    });
    assert.equal(page.has_more, true);
    const csvResponse = await f.request('?format=csv&limit=1');
    assert.equal(csvResponse.status, 200);
    const csv = await csvResponse.text();
    assert.ok(csv.includes('"reported_above_estimate","0.000000000000000001","USD"'));
    assert.ok(!csv.includes('foreign'));
    assert.ok(!csv.includes(token));
    assert.equal((await json(await f.request('?model=absent'))).data.length, 0);
    const rows = (
      await f.db.query<Record<string, unknown>>(
        'SELECT * FROM sso_usage_audit_events ORDER BY event_id',
      )
    ).rows;
    assert.equal(rows.length, 3);
    assert.equal(rows[0]?.principal_id, 'human');
    assert.equal(rows[0]?.target_principal_id, 'human');
    assert.equal(rows[0]?.mode, 'self');
    assert.equal(rows[0]?.request_id, 'read-1');
    assert.deepEqual(rows[0]?.policy_versions, [{ id: 'reader', version: 'v1' }]);
    assert.equal(String(rows[0]?.record_count), '1');
    assert.equal(String(rows[2]?.record_count), '0');
    assert.doesNotMatch(JSON.stringify(rows), /prior-proxy|candidate|upstream|Bearer|forged/u);
    assert.ok(!JSON.stringify(rows).includes(token));
  } finally {
    await f.db.close();
  }
});
test('concrete audit records fresh Deny, malformed query, authentication and SQL failures', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('?principal_id=other')).status, 403);
    assert.equal((await f.request('?limit=0')).status, 400);
    assert.equal((await f.request('', 'invalid')).status, 401);
    f.failSql();
    assert.equal((await f.request()).status, 503);
    await f.db.query('UPDATE iam_policies SET version = $1, statements = $2::jsonb', [
      'v2',
      JSON.stringify([{ effect: 'Deny', actions: ['usage:*'], resources: ['principal:*'] }]),
    ]);
    assert.equal((await f.request()).status, 403);
    const rows = (
      await f.db.query<Record<string, unknown>>(
        'SELECT * FROM sso_usage_audit_events ORDER BY event_id',
      )
    ).rows;
    assert.deepEqual(
      rows.map((r) => r.outcome),
      ['forbidden', 'invalid_query', 'unauthenticated', 'unavailable', 'forbidden'],
    );
    assert.equal(rows[0]?.target_principal_id, 'other');
    assert.equal(rows[0]?.mode, 'all');
    assert.equal(rows[1]?.mode, null);
    assert.equal(rows[2]?.principal_id, null);
    assert.deepEqual(rows[4]?.policy_versions, [{ id: 'reader', version: 'v2' }]);
  } finally {
    await f.db.close();
  }
});
test('durable insert is awaited and failure withholds JSON, CSV and anonymous results', async () => {
  const f = await fixture();
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    f.hook(async () => {
      entered();
      await blocked;
    });
    let settled = false;
    const pending = f.request().then((response) => {
      settled = true;
      return response;
    });
    await started;
    assert.equal(settled, false);
    assert.equal(
      (await f.db.query<Record<string, unknown>>('SELECT * FROM sso_usage_audit_events')).rows
        .length,
      0,
    );
    release();
    assert.equal((await pending).status, 200);
    f.failAudit();
    for (const [query, credential] of [
      ['', token],
      ['?format=csv', token],
      ['', 'invalid'],
    ]) {
      const response = await f.request(query, credential);
      assert.equal(response.status, 503);
      assert.match(await response.text(), /audit_unavailable/u);
    }
    assert.equal(
      (await f.db.query<Record<string, unknown>>('SELECT * FROM sso_usage_audit_events')).rows
        .length,
      1,
    );
  } finally {
    release();
    await f.db.close();
  }
});

test('signed SSO SQL usage reaches the browser transport with exact cost comparison and mandatory audit', async () => {
  const f = await fixture();
  try {
    const client = createSsoUsageClient(async (path) =>
      f.request(new URL(path, 'https://management.test').search),
    );
    const result = await client.read({ limit: 1, model: 'chat' });
    assert.equal(result.state, 'ready');
    if (result.state !== 'ready') return;
    assert.deepEqual(result.data[0]?.costComparison, {
      status: 'reported_above_estimate',
      reportedMinusEstimated: '0.000000000000000001',
      currency: 'USD',
    });
    assert.equal(result.data[0]?.principalId, 'human');
    assert.equal(result.data[0]?.attemptId, 'c');
    assert.ok(!JSON.stringify(result).includes(token));
    const audit = await f.db.query<Record<string, unknown>>('SELECT * FROM sso_usage_audit_events');
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0]?.principal_id, 'human');
    assert.equal((await client.read({ principalId: 'other', limit: 1 })).state, 'denied');
    f.failAudit();
    assert.deepEqual(await client.read({ limit: 1 }), { state: 'unavailable' });
  } finally {
    await f.db.close();
  }
});
