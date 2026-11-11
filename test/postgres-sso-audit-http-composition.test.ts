import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import { createPostgresSsoAuditHistoryHandler } from '../src/gateway/postgres-sso-audit-history-http.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
interface AuditResponse {
  readonly data: readonly import('../src/audit/postgres-audit-history.ts').AuditHistoryEvent[];
  readonly has_more: boolean;
  readonly next_cursor: string | null;
}
async function json(response: Response): Promise<AuditResponse> {
  return (await response.json()) as AuditResponse;
}
async function fixture() {
  const db = new PGlite();
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
  await db.exec(`INSERT INTO iam_principals VALUES ('human', 'human', true);
    INSERT INTO iam_policies VALUES ('reader', 'v1', '[{"effect":"Allow","actions":["audit:Read"],"resources":["principal:human"]}]');
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
      if (sqlFailure && query.includes('FROM gateway_audit_events'))
        throw Error('private SQL cause');
      if (query.includes('INSERT INTO sso_audit_history_access_events')) {
        if (auditFailure) throw Error('private audit cause');
        return auditHook().then(() => db.query(query, [...params]));
      }
      return db.query(query, [...params]);
    },
  };
  let time = 100;
  const writer = createPostgresGatewayAuditStore(client, () => time);
  for (const [principalId, requestId] of [
    ['human', 'first'],
    ['human', 'second'],
    ['other', 'foreign'],
  ] as const) {
    await writer.append({
      kind: 'models-listed',
      principalId,
      requestId,
      credentialId: 'prior-proxy',
      policyVersions: [],
      count: 1,
    });
    time += 100;
  }
  const handler = createPostgresSsoAuditHistoryHandler({
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
      new Request(`https://management.test/management/v1/audit${query}`, {
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
    assert.equal(page.data[0]?.requestId, 'second');
    assert.equal(page.has_more, true);
    assert.equal((await f.request('?format=csv&limit=1')).status, 200);
    assert.equal((await json(await f.request('?model=absent'))).data.length, 0);
    const rows = (
      await f.db.query<Record<string, unknown>>(
        'SELECT * FROM sso_audit_history_access_events ORDER BY event_id',
      )
    ).rows;
    assert.equal(rows.length, 3);
    assert.equal(rows[0]?.principal_id, 'human');
    assert.equal(rows[0]?.target_principal_id, 'human');
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
      JSON.stringify([{ effect: 'Deny', actions: ['audit:*'], resources: ['principal:*'] }]),
    ]);
    assert.equal((await f.request()).status, 403);
    const rows = (
      await f.db.query<Record<string, unknown>>(
        'SELECT * FROM sso_audit_history_access_events ORDER BY event_id',
      )
    ).rows;
    assert.deepEqual(
      rows.map((r) => r.outcome),
      ['forbidden', 'invalid_query', 'unauthenticated', 'unavailable', 'forbidden'],
    );
    assert.equal(rows[0]?.target_principal_id, 'other');
    assert.equal(rows[1]?.target_principal_id, null);
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
      (await f.db.query<Record<string, unknown>>('SELECT * FROM sso_audit_history_access_events'))
        .rows.length,
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
      (await f.db.query<Record<string, unknown>>('SELECT * FROM sso_audit_history_access_events'))
        .rows.length,
      1,
    );
  } finally {
    release();
    await f.db.close();
  }
});
