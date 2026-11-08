import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import {
  createPostgresSsoAuditHistory,
  type SsoAuditHistoryAccessEvent,
} from '../src/gateway/postgres-sso-audit-history.ts';
import {
  createSsoAuditHistoryHandler,
  createSsoAuditHistoryServer,
} from '../src/gateway/sso-audit-history-http.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
async function fixture(hook?: (event: SsoAuditHistoryAccessEvent) => Promise<void>) {
  const db = new PGlite();
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
  await db.exec(`
    INSERT INTO iam_principals VALUES ('human','human',true),('other','human',true);
    INSERT INTO iam_policies VALUES ('allow','v1','[{"effect":"Allow","actions":["audit:Read"],"resources":["principal:human"]}]');
    INSERT INTO iam_roles VALUES ('reader');
    INSERT INTO iam_principal_roles VALUES ('human','reader');
    INSERT INTO iam_role_policies VALUES ('reader','allow');
  `);
  await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
    jwt.issuer,
    jwt.subject,
    'human',
  ]);
  let time = 100;
  const writer = createPostgresGatewayAuditStore(
    { query: (q, p) => db.query(q, [...p]) },
    () => time,
  );
  for (const [principalId, requestId, modelAlias, occurredAt] of [
    ['human', 'first', 'chat', 100],
    ['human', 'second', 'chat', 200],
    ['human', 'third', 'other-model', 300],
    ['other', 'foreign', 'chat', 400],
  ] as const) {
    time = occurredAt;
    await writer.append({
      kind: 'audit-history-read',
      requestId,
      principalId,
      credentialId: 'proxy-credential',
      policyVersions: [{ id: 'old', version: 'v1' }],
      targetPrincipalId: principalId,
      count: 1,
    });
    // A model-bearing gateway decision event supports existing audit model filters.
    await writer.append({
      kind: 'request-denied',
      reason: 'invalid-request',
      requestId: `${requestId}-model`,
      principalId,
      credentialId: 'proxy-credential',
      policyVersions: [{ id: 'old', version: 'v1' }],
      modelAlias,
    });
  }
  const events: SsoAuditHistoryAccessEvent[] = [];
  const sql: string[] = [];
  let failSql = false;
  let failAudit = false;
  const service = createPostgresSsoAuditHistory({
    ...jwt.config,
    client: {
      query: (q, p) => {
        sql.push(q);
        if (failSql && q.includes('FROM gateway_audit_events')) throw Error('private SQL fault');
        return db.query(q, [...p]);
      },
    },
    writeAudit: async (event) => {
      if (failAudit) throw Error('private audit fault');
      await hook?.(event);
      events.push(event);
    },
  });
  const server = createSsoAuditHistoryServer({
    audit: service,
    newRequestId: () => 'audit-request',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const get = (query = '', bearer = token) =>
    fetch(`http://127.0.0.1:${address.port}/management/v1/audit${query}`, {
      headers: { authorization: `Bearer ${bearer}` },
    });
  return {
    db,
    events,
    sql,
    service,
    get,
    failSql: () => {
      failSql = true;
    },
    failAudit: () => {
      failAudit = true;
    },
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
      await db.close();
    },
  };
}

test('signed SSO audit HTTP lists scoped real SQL pages, empty results and CSV', async () => {
  const f = await fixture();
  try {
    const first = await f.get('?limit=2');
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    const page = (await first.json()) as { data: { requestId: string }[]; next_cursor: string };
    assert.equal(page.data.length, 2);
    assert.equal(
      page.data.some((row) => row.requestId.includes('foreign')),
      false,
    );
    assert.ok(page.next_cursor);
    const second = await f.get(`?limit=2&cursor=${page.next_cursor}`);
    const next = (await second.json()) as { data: { requestId: string }[] };
    assert.equal(
      next.data.some((row) => page.data.some((previous) => previous.requestId === row.requestId)),
      false,
    );
    const empty = await f.get('?from_ms=999');
    assert.deepEqual(((await empty.json()) as { data: unknown[] }).data, []);
    const csv = await f.get('?format=csv&limit=1');
    assert.equal(csv.status, 200);
    assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.match(await csv.text(), /event_id/);
    assert.equal(f.events.at(-1)?.count, 1);
    assert.equal(f.events.at(-1)?.principalId, 'human');
    assert.equal('credentialId' in (f.events.at(-1) ?? {}), false);
  } finally {
    await f.close();
  }
});

test('audit model and half-open time filters use existing SQL contract', async () => {
  const f = await fixture();
  try {
    const response = await f.get('?model=chat&from_ms=100&to_ms=200');
    assert.equal(response.status, 200);
    const page = (await response.json()) as { data: { requestId: string }[] };
    assert.deepEqual(
      page.data.map((row) => row.requestId),
      ['first-model'],
    );
  } finally {
    await f.close();
  }
});

test('target audit permission is required even for self; no usage permission substitute', async () => {
  const f = await fixture();
  try {
    const denied = await f.get('?principal_id=other');
    assert.equal(denied.status, 403);
    await denied.text();
    await f.db.exec(
      `UPDATE iam_policies SET statements='[{"effect":"Allow","actions":["usage:ReadSelf"],"resources":["*"]}]'`,
    );
    const self = await f.get();
    assert.equal(self.status, 403);
    await self.text();
    assert.equal(f.events.at(-1)?.outcome, 'forbidden');
  } finally {
    await f.close();
  }
});

test('fresh IAM grants target then explicit Deny wins without SQL history reads', async () => {
  const f = await fixture();
  try {
    await f.db.exec(
      `UPDATE iam_policies SET statements='[{"effect":"Allow","actions":["audit:Read"],"resources":["principal:*"]}]'`,
    );
    const yes = await f.get('?principal_id=other');
    assert.equal(yes.status, 200);
    assert.match(await yes.text(), /foreign/);
    await f.db.exec(
      `UPDATE iam_policies SET statements='[{"effect":"Allow","actions":["audit:Read"],"resources":["*"]},{"effect":"Deny","actions":["audit:Read"],"resources":["principal:other"]}]'`,
    );
    f.sql.length = 0;
    const no = await f.get('?principal_id=other');
    assert.equal(no.status, 403);
    await no.text();
    assert.equal(
      f.sql.some((q) => q.includes('FROM gateway_audit_events')),
      false,
    );
  } finally {
    await f.close();
  }
});

test('unauthenticated before query validation and fresh binding revocation are audited', async () => {
  const f = await fixture();
  try {
    const bad = await f.get('?unknown=x', 'invalid');
    assert.equal(bad.status, 401);
    await bad.text();
    assert.equal(f.events.at(-1)?.principalId, null);
    await f.db.exec('DELETE FROM iam_sso_identity_bindings');
    const revoked = await f.get();
    assert.equal(revoked.status, 401);
    await revoked.text();
  } finally {
    await f.close();
  }
});

test('invalid queries fail audited before history SQL', async () => {
  const f = await fixture();
  try {
    for (const query of [
      '?limit=0',
      '?limit=1&limit=2',
      '?cursor=0',
      '?cursor=9223372036854775808',
      '?from_ms=2&to_ms=1',
      '?unknown=x',
    ]) {
      f.sql.length = 0;
      const response = await f.get(query);
      assert.equal(response.status, 400);
      await response.text();
      assert.equal(
        f.sql.some((q) => q.includes('FROM gateway_audit_events')),
        false,
      );
    }
    assert.equal(f.events.at(-1)?.outcome, 'invalid_query');
  } finally {
    await f.close();
  }
});

test('SQL failure and audit failure withhold content and private diagnostics', async () => {
  const f = await fixture();
  try {
    f.failSql();
    const sql = await f.get();
    assert.equal(sql.status, 503);
    assert.equal((await sql.text()).includes('private'), false);
    assert.equal(f.events.at(-1)?.outcome, 'unavailable');
    f.failAudit();
    const audit = await f.get();
    assert.equal(audit.status, 503);
    assert.match(await audit.text(), /audit_unavailable/);
  } finally {
    await f.close();
  }
});

test('successful JSON and CSV remain withheld until mandatory audit completes', async () => {
  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  let gate = Promise.resolve();
  let signal = Promise.resolve();
  const f = await fixture(async () => {
    entered?.();
    await gate;
  });
  try {
    for (const format of ['json', 'csv']) {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      signal = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let settled = false;
      const pending = f.service.read(token, 'request', `?format=${format}`).then((value) => {
        settled = true;
        return value;
      });
      await signal;
      assert.equal(settled, false);
      release?.();
      assert.equal((await pending).state, 'ready');
    }
  } finally {
    release?.();
    await f.close();
  }
});

test('successful SQL results are withheld if mandatory access audit fails for JSON or CSV', async () => {
  const f = await fixture();
  try {
    f.failAudit();
    for (const format of ['json', 'csv']) {
      const response = await f.get(`?format=${format}`);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.text();
      assert.match(body, /audit_unavailable/);
      assert.equal(body.includes('first-model'), false);
      assert.equal(body.includes('proxy-credential'), false);
      assert.equal(body.includes('private audit fault'), false);
    }
  } finally {
    await f.close();
  }
});

test('cookie-only HTTP requests cannot authenticate and denied responses are noncacheable', async () => {
  const f = await fixture();
  try {
    const response = await createSsoAuditHistoryHandler({
      audit: f.service,
      newRequestId: () => 'cookie-test',
    })(
      new Request('https://management.invalid/management/v1/audit', {
        headers: { cookie: `access_token=${token}` },
      }),
    );
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(f.events.at(-1)?.outcome, 'unauthenticated');
    assert.equal((await response.text()).includes(token), false);
  } finally {
    await f.close();
  }
});

test('HTTP route, request ID and transport rejection do not invoke trusted reader', async () => {
  let calls = 0;
  const handler = createSsoAuditHistoryHandler({
    newRequestId: () => 'request',
    audit: {
      read: async () => {
        calls++;
        return { state: 'unavailable' };
      },
    },
  });
  for (const request of [
    new Request('https://management.invalid/other'),
    new Request('https://management.invalid/management/v1/audit', { method: 'POST', body: 'x' }),
    new Request('https://management.invalid/management/v1/audit', {
      headers: { 'content-length': '1' },
    }),
  ]) {
    const response = await handler(request);
    assert.ok([400, 404].includes(response.status));
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const badId = createSsoAuditHistoryHandler({
    newRequestId: () => 'private\nfault',
    audit: {
      read: async () => {
        calls++;
        return { state: 'unavailable' };
      },
    },
  });
  assert.equal(
    (await badId(new Request('https://management.invalid/management/v1/audit'))).status,
    503,
  );
  assert.equal(calls, 0);
});

test('an audit writer is mandatory at service construction', () => {
  assert.throws(
    () =>
      createPostgresSsoAuditHistory({
        ...jwt.config,
        client: { query: async () => ({ rows: [] }) },
        writeAudit: undefined as never,
      }),
    { name: 'InvalidSsoAccessTokenConfiguration' },
  );
});
