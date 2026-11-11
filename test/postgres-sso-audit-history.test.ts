import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import {
  createPostgresSsoAuditHistory,
  type SsoAuditHistoryAccessEvent,
} from '../src/gateway/postgres-sso-audit-history.ts';
import { createSsoAuditHistoryHandler } from '../src/gateway/sso-audit-history-http.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

async function json(response: Response) {
  return (await response.json()) as {
    object: string;
    data: { requestId: string; credentialId: string }[];
    has_more: boolean;
    next_cursor: string | null;
    error: { code: string };
  };
}

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
async function fixture(hook?: (event: SsoAuditHistoryAccessEvent) => Promise<void>) {
  const db = new PGlite();
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
  await db.exec(`
    INSERT INTO iam_principals VALUES ('human', 'human', true), ('other', 'human', true);
    INSERT INTO iam_policies VALUES ('allow', 'v1',
      '[{"effect":"Allow","actions":["audit:Read"],"resources":["principal:human"]}]');
    INSERT INTO iam_principal_policies VALUES ('human', 'allow');
  `);
  await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
    jwt.issuer,
    jwt.subject,
    'human',
  ]);
  const sql: string[] = [];
  let broken = false;
  let auditBroken = false;
  const client = {
    query: (query: string, params: readonly unknown[]) => {
      sql.push(query);
      if (broken && query.includes('FROM gateway_audit_events')) throw Error('private SQL failure');
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
      credentialId: 'historical-proxy',
      policyVersions: [{ id: 'original', version: 'v1' }],
      count: 1,
    });
    time += 100;
  }
  sql.length = 0;
  const events: SsoAuditHistoryAccessEvent[] = [];
  const history = createPostgresSsoAuditHistory({
    ...jwt.config,
    client,
    writeAudit: async (event) => {
      if (auditBroken) throw Error('private audit failure');
      await hook?.(event);
      events.push(event);
    },
  });
  const handler = createSsoAuditHistoryHandler({ history, newRequestId: () => 'server-request' });
  return {
    db,
    history,
    handler,
    events,
    sql,
    failSql: () => {
      broken = true;
    },
    failAudit: () => {
      auditBroken = true;
    },
  };
}
function request(query = '', auth: string | null = token) {
  return new Request(`https://management.example/management/v1/audit${query}`, {
    headers: auth === null ? {} : { authorization: `Bearer ${auth}` },
  });
}

test('signed SSO JSON/CSV reads real principal-scoped SQL with filters and keyset continuation', async () => {
  const f = await fixture();
  try {
    const first = await f.handler(request('?limit=1'));
    assert.equal(first.status, 200);
    const page = await json(first);
    assert.equal(page.object, 'list');
    assert.equal(page.has_more, true);
    assert.equal(page.next_cursor, '2');
    assert.deepEqual(
      page.data.map((row: { requestId: string }) => row.requestId),
      ['second'],
    );
    assert.equal(page.data[0]?.credentialId, 'historical-proxy');
    const second = await f.handler(request(`?limit=1&cursor=${page.next_cursor}`));
    assert.deepEqual(
      (await json(second)).data.map((row: { requestId: string }) => row.requestId),
      ['first'],
    );
    const filtered = await f.handler(request('?from_ms=200&to_ms=300'));
    assert.deepEqual(
      (await json(filtered)).data.map((row: { requestId: string }) => row.requestId),
      ['second'],
    );
    const csv = await f.handler(request('?format=csv&limit=1'));
    assert.equal(csv.headers.get('x-next-cursor'), '2');
    assert.equal(csv.headers.get('x-has-more'), 'true');
    assert.match(csv.headers.get('content-type') ?? '', /text\/csv/u);
    const text = await csv.text();
    assert.match(text, /second/u);
    assert.doesNotMatch(text, /foreign|first/u);
    const empty = await f.handler(request('?from_ms=300'));
    assert.deepEqual((await json(empty)).data, []);
    assert.deepEqual(f.events[0], {
      requestId: 'server-request',
      principalId: 'human',
      policyVersions: [{ id: 'allow', version: 'v1' }],
      targetPrincipalId: 'human',
      outcome: 'ready',
      count: 1,
    });
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.equal(first.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(f.sql.some((sql) => sql.includes('FROM gateway_audit_events')));
  } finally {
    await f.db.close();
  }
});

test('audit permission is required for self and another principal; policy changes are fresh', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.handler(request('?principal_id=other'))).status, 403);
    assert.ok(!f.sql.some((sql) => sql.includes('FROM gateway_audit_events')));
    await f.db.exec(
      `UPDATE iam_policies SET version='v2', statements='[{"effect":"Allow","actions":["audit:Read"],"resources":["principal:other"]}]'`,
    );
    const allowed = await f.handler(request('?principal_id=other'));
    assert.equal(allowed.status, 200);
    assert.equal((await json(allowed)).data[0]?.requestId, 'foreign');
    assert.equal((await f.handler(request())).status, 403);
    await f.db.exec(
      `UPDATE iam_policies SET version='v3', statements='[{"effect":"Allow","actions":["usage:ReadSelf","models:List"],"resources":["*"]}]'`,
    );
    assert.equal((await f.handler(request())).status, 403);
    await f.db.exec(`UPDATE iam_principals SET active=false WHERE principal_id='human'`);
    assert.equal((await f.handler(request())).status, 401);
    assert.equal(f.events.at(-1)?.principalId, null);
  } finally {
    await f.db.close();
  }
});

test('authenticate before query parsing and redact JWT, query and stored rows from access metadata', async () => {
  const f = await fixture();
  try {
    for (const auth of [null, 'invalid', await jwt.token({ exp: jwt.nowSeconds - 1000 })]) {
      const response = await f.handler(request('?secret=private-query', auth));
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('www-authenticate'), 'Bearer');
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.ok(!f.sql.some((sql) => sql.includes('FROM gateway_audit_events')));
    assert.doesNotMatch(JSON.stringify(f.events), /private-query|invalid|Bearer|historical-proxy/u);
    for (const query of [
      '?limit=0',
      '?cursor=0',
      '?cursor=9223372036854775808',
      '?limit=1&limit=2',
      '?from_ms=200&to_ms=100',
      '?model=',
      '?unknown=value',
    ]) {
      const response = await f.handler(request(query));
      assert.equal(response.status, 400, query);
      assert.equal(f.events.at(-1)?.outcome, 'invalid_query');
      assert.equal(f.events.at(-1)?.count, 0);
    }
  } finally {
    await f.db.close();
  }
});

test('data and every error result are withheld when mandatory audit fails', async () => {
  const f = await fixture();
  try {
    f.failAudit();
    for (const req of [
      request(),
      request('?format=csv'),
      request('?principal_id=other'),
      request('?limit=0'),
      request('', null),
    ]) {
      const response = await f.handler(req);
      assert.equal(response.status, 503);
      assert.equal((await json(response)).error.code, 'audit_unavailable');
    }
  } finally {
    await f.db.close();
  }
});

test('SQL failure is sanitized and audited, not an empty successful history', async () => {
  const f = await fixture();
  try {
    f.failSql();
    const response = await f.handler(request());
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.match(body, /audit_history_unavailable/u);
    assert.doesNotMatch(body, /private SQL/u);
    assert.equal(f.events.at(-1)?.outcome, 'unavailable');
    assert.equal(f.events.at(-1)?.count, 0);
  } finally {
    await f.db.close();
  }
});

test('no HTTP response resolves while mandatory audit append is pending', async () => {
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(async () => {
    entered();
    await gate;
  });
  try {
    let finished = false;
    const response = f.handler(request()).then((value) => {
      finished = true;
      return value;
    });
    await waiting;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(finished, false);
    release();
    assert.equal((await response).status, 200);
  } finally {
    release();
    await f.db.close();
  }
});

test('Fetch adapter rejects noncanonical paths and GET framing without invoking history', async () => {
  let calls = 0;
  const handler = createSsoAuditHistoryHandler({
    newRequestId: () => 'request',
    history: {
      read: async () => {
        calls++;
        return { state: 'unauthenticated' as const };
      },
    },
  });
  for (const [req, status] of [
    [new Request('https://management.example/v1/audit'), 404],
    [
      new Request('https://management.example/management/v1/audit', {
        method: 'POST',
        body: 'secret',
      }),
      400,
    ],
    [
      new Request('https://management.example/management/v1/audit', {
        headers: { 'content-length': '1' },
      }),
      400,
    ],
    [
      new Request('https://management.example/management/v1/audit', {
        headers: { 'transfer-encoding': 'chunked' },
      }),
      400,
    ],
    [
      new Request('https://management.example/management/v1/audit', {
        signal: AbortSignal.abort(),
      }),
      400,
    ],
  ] as const) {
    const response = await handler(req);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(calls, 0);
});

test('explicit Deny overrides an inherited audit Allow on every request', async () => {
  const f = await fixture();
  try {
    await f.db.exec(`
      INSERT INTO iam_roles VALUES ('reader');
      INSERT INTO iam_principal_roles VALUES ('human', 'reader');
      INSERT INTO iam_role_policies VALUES ('reader', 'allow');
      DELETE FROM iam_principal_policies;
    `);
    assert.equal((await f.handler(request())).status, 200);
    f.sql.length = 0;
    await f.db.exec(`
      INSERT INTO iam_policies VALUES ('deny', 'v1', '[{"effect":"Deny","actions":["audit:Read"],"resources":["principal:human"]}]');
      INSERT INTO iam_principal_policies VALUES ('human', 'deny');
    `);
    assert.equal((await f.handler(request())).status, 403);
    assert.ok(!f.sql.some((sql) => sql.includes('FROM gateway_audit_events')));
    assert.equal(f.events.at(-1)?.count, 0);
    await f.db.exec('DELETE FROM iam_sso_identity_bindings');
    assert.equal((await f.handler(request())).status, 401);
  } finally {
    await f.db.close();
  }
});

test('model filters isolate real metadata and corrupt persisted rows fail closed as a whole', async () => {
  const f = await fixture();
  try {
    // Metadata can contain unrecognized keys at rest; the public projector drops them.
    await f.db.exec(
      `UPDATE gateway_audit_events SET kind='route-unavailable', details=details || '{"modelAlias":"chat","rawSecret":"must-not-leak"}'::jsonb WHERE event_id=2`,
    );
    const response = await f.handler(request('?model=chat'));
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /second/u);
    assert.doesNotMatch(text, /first|foreign|must-not-leak|rawSecret/u);
    const csv = await f.handler(request('?model=chat&format=csv'));
    assert.equal(csv.status, 200);
    assert.doesNotMatch(await csv.text(), /must-not-leak|rawSecret/u);
    await f.db.exec(
      `UPDATE gateway_audit_events SET policy_versions='null'::jsonb WHERE event_id=2`,
    );
    const corrupt = await f.handler(request());
    assert.equal(corrupt.status, 503);
    assert.equal((await json(corrupt)).error.code, 'audit_history_unavailable');
    assert.equal(f.events.at(-1)?.count, 0);
  } finally {
    await f.db.close();
  }
});

test('invalid audit port is rejected at construction and custom authentication callbacks cannot override JWT verification', async () => {
  const client = { query: async () => ({ rows: [] }) };
  assert.throws(
    () => createPostgresSsoAuditHistory({ ...jwt.config, client, writeAudit: undefined as never }),
    { name: 'InvalidSsoAccessTokenConfiguration' },
  );
  let overrideCalls = 0;
  const events: SsoAuditHistoryAccessEvent[] = [];
  const options = {
    ...jwt.config,
    client,
    verifyAccessToken: async () => {
      overrideCalls++;
      return { issuer: jwt.issuer, subject: jwt.subject };
    },
    writeAudit: async (event: SsoAuditHistoryAccessEvent) => {
      events.push(event);
    },
  };
  const history = createPostgresSsoAuditHistory(options);
  assert.deepEqual(await history.read('not-a-signed-token', 'request', ''), {
    state: 'unauthenticated',
  });
  assert.equal(overrideCalls, 0);
  assert.equal(events[0]?.principalId, null);
});
