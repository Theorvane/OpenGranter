import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  createPostgresSsoUsageHistory,
  type SsoUsageAuditEvent,
} from '../src/gateway/postgres-sso-usage-history.ts';
import { createSsoUsageHistoryHandler } from '../src/gateway/sso-usage-history-http.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
interface UsageResponse {
  readonly data: readonly import('../src/usage/record-usage.ts').UsageRecord[];
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
  const events: SsoUsageAuditEvent[] = [];
  const sql: string[] = [];
  const client = {
    query: (query: string, params: readonly unknown[]) => {
      sql.push(query);
      if (sqlFailure && query.includes('FROM usage_records')) throw Error('private SQL cause');
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
      }),
    );
  }
  const service = createPostgresSsoUsageHistory({
    ...jwt.config,
    client,
    writeAudit: async (event) => {
      if (auditFailure) throw Error('private audit cause');
      await auditHook();
      events.push(event);
    },
  });
  const handler = createSsoUsageHistoryHandler({ history: service, newRequestId: () => 'read-1' });
  const request = (query = '', credential = token) =>
    handler(
      new Request(`https://management.test/management/v1/usage${query}`, {
        headers: { authorization: `Bearer ${credential}` },
      }),
    );
  return {
    db,
    events,
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
test('signed SSO Fetch reads scoped, filtered, paginated persisted usage and bounded CSV', async () => {
  const f = await fixture();
  try {
    const first = await f.request('?limit=1&model=chat&from_ms=100&to_ms=400');
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    const page = await json(first);
    assert.deepEqual(
      page.data.map((row: { attemptId: string }) => row.attemptId),
      ['c'],
    );
    assert.equal(page.data[0]?.usage.status, 'missing');
    assert.equal(page.data[0]?.estimatedCost, null);
    assert.equal(page.has_more, true);
    const second = await json(await f.request(`?limit=1&cursor=${page.next_cursor}`));
    assert.equal(second.data[0]?.attemptId, 'b');
    const csv = await f.request('?format=csv&limit=1');
    assert.match(csv.headers.get('content-type') ?? '', /text\/csv/u);
    assert.equal(csv.headers.get('x-has-more'), 'true');
    assert.ok(csv.headers.get('x-next-cursor'));
    assert.match(await csv.text(), /missing/u);
    assert.equal((await json(await f.request('?model=absent'))).data.length, 0);
    assert.equal(f.events[0]?.principalId, 'human');
    assert.equal(f.events[0]?.count, 1);
    assert.ok(!JSON.stringify(f.events).includes(token));
    assert.ok(!JSON.stringify(f.events).includes('prior-proxy'));
  } finally {
    await f.db.close();
  }
});
test('explicit principal needs ReadAll even for self; fresh policy Deny and removal take effect', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('?principal_id=human')).status, 403);
    assert.equal((await f.request('?principal_id=other')).status, 403);
    await f.db.query(
      'UPDATE iam_policies SET version = $1, statements = $2::jsonb WHERE policy_id = $3',
      [
        'v2',
        JSON.stringify([{ effect: 'Allow', actions: ['usage:*'], resources: ['principal:*'] }]),
        'reader',
      ],
    );
    const all = await json(await f.request('?principal_id=other'));
    assert.equal(all.data[0]?.principalId, 'other');
    assert.equal(f.events.at(-1)?.policyVersions?.[0]?.version, 'v2');
    await f.db.query('UPDATE iam_policies SET statements = $1::jsonb WHERE policy_id = $2', [
      JSON.stringify([
        { effect: 'Allow', actions: ['usage:*'], resources: ['*'] },
        { effect: 'Deny', actions: ['usage:ReadSelf'], resources: ['*'] },
      ]),
      'reader',
    ]);
    assert.equal((await f.request()).status, 403);
    await f.db.exec('DELETE FROM iam_sso_identity_bindings');
    assert.equal((await f.request()).status, 401);
  } finally {
    await f.db.close();
  }
});
test('authentication, query, storage and mandatory audit failures withhold data', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('', 'invalid')).status, 401);
    assert.equal((await f.request('', await jwt.token({ exp: jwt.nowSeconds - 120 }))).status, 401);
    assert.equal((await f.request('?limit=0')).status, 400);
    assert.equal((await f.request('?model=chat&model=other')).status, 400);
    f.failSql();
    const unavailable = await f.request();
    assert.equal(unavailable.status, 503);
    assert.ok(!(await unavailable.text()).includes('private'));
    assert.equal(f.events.at(-1)?.outcome, 'unavailable');
    f.failAudit();
    const failed = await f.request();
    assert.equal(failed.status, 503);
    assert.match(await failed.text(), /audit_unavailable/u);
    assert.match(await (await f.request('', 'invalid')).text(), /audit_unavailable/u);
  } finally {
    await f.db.close();
  }
});
test('success is withheld until the mandatory audit append resolves', async () => {
  const f = await fixture();
  try {
    let release = () => {};
    let entered = () => {};
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.hook(async () => {
      entered();
      await gate;
    });
    let settled = false;
    const response = f.request().then((value) => {
      settled = true;
      return value;
    });
    await ready;
    assert.equal(settled, false);
    release();
    assert.equal((await response).status, 200);
  } finally {
    await f.db.close();
  }
});

test('denied reads never query usage and successful data is withheld on failed audit', async () => {
  const f = await fixture();
  try {
    f.sql.length = 0;
    assert.equal((await f.request('?principal_id=other')).status, 403);
    assert.ok(!f.sql.some((query) => query.includes('FROM usage_records')));
    f.failAudit();
    const response = await f.request();
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.match(body, /audit_unavailable/u);
    assert.ok(!body.includes('prior-proxy'));
    assert.ok(!body.includes('attemptId'));
  } finally {
    await f.db.close();
  }
});

test('corrupt or cross-principal persisted usage fails closed, including hidden lookahead', async () => {
  const f = await fixture();
  try {
    await f.db.query(
      "UPDATE usage_records SET record = jsonb_set(record, '{principalId}', $1::jsonb) WHERE attempt_id = $2",
      [JSON.stringify('other'), 'b'],
    );
    const response = await f.request('?limit=1');
    assert.equal(response.status, 503);
    assert.match(await response.text(), /usage_unavailable/u);
    assert.equal(f.events.at(-1)?.count, 0);
    assert.equal(f.events.at(-1)?.outcome, 'unavailable');
  } finally {
    await f.db.close();
  }
});

test('human disable, wrong audience and policy removal deny fresh requests', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('', await jwt.token({ aud: 'wrong' }))).status, 401);
    await f.db.exec('DELETE FROM iam_principal_policies');
    assert.equal((await f.request()).status, 403);
    await f.db.exec("UPDATE iam_principals SET active = false WHERE principal_id = 'human'");
    assert.equal((await f.request()).status, 401);
    assert.equal(f.events.at(-1)?.principalId, null);
  } finally {
    await f.db.close();
  }
});
