import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import { startPostgresSsoWorkspaceGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import { createPostgresSsoAdministrationBrowserHandler } from '../src/gateway/postgres-sso-administration-browser-http.ts';
import type { SsoAuditHistoryAccessEvent } from '../src/gateway/postgres-sso-audit-history.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
async function fixture(enabled = true) {
  const db = new PGlite();
  let opens = 0;
  let closes = 0;
  let failAudit = false;
  let hook: (() => Promise<void>) | undefined;
  const events: SsoAuditHistoryAccessEvent[] = [];
  const connection: PostgresConnection = {
    query: (sql, params) => db.query(sql, [...params]),
    transaction: (callback) =>
      db.transaction((tx) =>
        callback({
          exec: (sql) => tx.exec(sql),
          query: (sql, params) => tx.query(sql, [...params]),
        }),
      ),
    close: async () => {
      closes++;
      await db.close();
    },
  };
  const ports = {
    ...jwt.config,
    host: '127.0.0.1',
    port: 0,
    browserJavascript: 'export const workspace = true;',
    newRequestId: () => 'workspace-audit',
    openConnection: () => {
      opens++;
      return connection;
    },
    ...(enabled
      ? {
          writeAuditHistoryAccess: async (event: SsoAuditHistoryAccessEvent) => {
            await hook?.();
            if (failAudit) throw Error('private sink failure');
            events.push(event);
          },
        }
      : {}),
  };
  const runtime = await startPostgresSsoWorkspaceGateway(ports);
  await db.exec(`
    INSERT INTO iam_principals VALUES ('human','human',true),('other','human',true);
    INSERT INTO iam_policies VALUES ('audit','v1','[{"effect":"Allow","actions":["audit:Read"],"resources":["principal:human"]}]');
    INSERT INTO iam_principal_policies VALUES ('human','audit');
  `);
  await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
    jwt.issuer,
    jwt.subject,
    'human',
  ]);
  const store = createPostgresGatewayAuditStore(connection, () => 100);
  for (const principalId of ['human', 'human', 'other'])
    await store.append({
      kind: 'request-denied',
      reason: 'invalid-request',
      requestId: `event-${principalId}`,
      principalId,
      credentialId: 'existing-proxy',
      policyVersions: [],
      modelAlias: 'chat',
    });
  const origin = `http://127.0.0.1:${runtime.address.port}`;
  return {
    db,
    ports,
    events,
    counts: () => ({ opens, closes }),
    fail: () => {
      failAudit = true;
    },
    hold: (value: () => Promise<void>) => {
      hook = value;
    },
    get: (
      path = '/management/v1/audit',
      authorization = `Bearer ${token}`,
      method = 'GET',
      cookie = '',
    ) => fetch(origin + path, { method, headers: { authorization, cookie } }),
    close: async () => {
      const promise = runtime.close();
      assert.equal(runtime.close(), promise);
      await promise;
    },
  };
}

test('workspace explicitly joins real scoped audit pages and CSV with existing routes', async () => {
  const f = await fixture();
  try {
    const page = await f.get('/management/v1/audit?limit=1&model=chat');
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    const body = (await page.json()) as { data: { principalId: string }[]; next_cursor: string };
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0]?.principalId, 'human');
    assert.equal(page.headers.get('x-audit-next-cursor'), body.next_cursor);
    const second = await f.get(`/management/v1/audit?cursor=${body.next_cursor}`);
    assert.equal(second.status, 200);
    assert.equal(((await second.json()) as { data: unknown[] }).data.length, 1);
    const csv = await f.get('/management/v1/audit?format=csv');
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-disposition') ?? '', /audit.csv/);
    assert.doesNotMatch(await csv.text(), /event-other/);
    assert.equal(f.events.length, 3);
    assert.equal(f.events[0]?.principalId, 'human');
    assert.equal('credentialId' in (f.events[0] ?? {}), false);
    for (const path of ['/management', '/management/app.js', '/management/v1/models']) {
      const response = await f.get(path);
      assert.equal(response.status, 200);
      await response.text();
    }
    const empty = await f.get('/management/v1/audit?from_ms=999');
    assert.deepEqual(await empty.json(), { object: 'list', data: [], next_cursor: null });
  } finally {
    await f.close();
  }
  assert.deepEqual(f.counts(), { opens: 1, closes: 1 });
});

test('workspace without explicit writer retains audit 404 and does not create audit schemas', async () => {
  const f = await fixture(false);
  try {
    assert.equal((await f.get()).status, 404);
    assert.equal(f.events.length, 0);
    const tables = await f.db.query(
      "SELECT tablename FROM pg_tables WHERE tablename IN ('sso_current_principal_audit_events','sso_usage_audit_events')",
    );
    assert.deepEqual(tables.rows, []);
  } finally {
    await f.close();
  }
});

test('workspace audit honors fresh IAM Deny and binding revocation, authenticates before query', async () => {
  const f = await fixture();
  try {
    const anonymous = await f.get('/management/v1/audit?unknown=1', '');
    assert.equal(anonymous.status, 401);
    await anonymous.text();
    const invalid = await f.get('/management/v1/audit?unknown=1');
    assert.equal(invalid.status, 400);
    await invalid.text();
    const forbidden = await f.get('/management/v1/audit?principal_id=other');
    assert.equal(forbidden.status, 403);
    await forbidden.text();
    await f.db.exec(
      `UPDATE iam_policies SET version='v2',statements='[{"effect":"Allow","actions":["audit:Read"],"resources":["*"]},{"effect":"Deny","actions":["audit:Read"],"resources":["principal:human"]}]' WHERE policy_id='audit'`,
    );
    const denied = await f.get();
    assert.equal(denied.status, 403);
    await denied.text();
    assert.deepEqual(f.events.at(-1)?.policyVersions, [{ id: 'audit', version: 'v2' }]);
    await f.db.exec('DELETE FROM iam_sso_identity_bindings');
    const revoked = await f.get();
    assert.equal(revoked.status, 401);
    await revoked.text();
    assert.deepEqual(
      f.events.map((e) => e.outcome),
      ['unauthenticated', 'invalid_query', 'forbidden', 'forbidden', 'unauthenticated'],
    );
  } finally {
    await f.close();
  }
});

test('workspace audit withholds JSON, CSV and auth failures when mandatory writer fails', async () => {
  const f = await fixture();
  try {
    f.fail();
    for (const [path, auth] of [
      ['/management/v1/audit', `Bearer ${token}`],
      ['/management/v1/audit?format=csv', `Bearer ${token}`],
      ['/management/v1/audit', ''],
    ]) {
      const response = await f.get(path, auth);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.text();
      assert.match(body, /audit_unavailable/);
      assert.doesNotMatch(body, /event-human|existing-proxy|private sink/);
    }
    assert.deepEqual(f.events, []);
  } finally {
    await f.close();
  }
});

test('workspace audit awaits the injected writer before releasing CSV', async () => {
  const f = await fixture();
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.hold(async () => {
    entered();
    await gate;
  });
  try {
    let resolved = false;
    const pending = f.get('/management/v1/audit?format=csv').then((r) => {
      resolved = true;
      return r;
    });
    await Promise.race([
      waiting,
      pending.then(() => {
        throw Error('Response released before writer entry');
      }),
    ]);
    assert.equal(resolved, false);
    release();
    const response = await pending;
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(f.events.length, 1);
  } finally {
    release();
    await f.close();
  }
});

test('workspace audit only exact GET path dispatches; cookies never confer authority', async () => {
  const f = await fixture();
  try {
    for (const [path, method] of [
      ['/management/v1/audit', 'POST'],
      ['/management/v1/audit/', 'GET'],
    ]) {
      const response = await f.get(path, `Bearer ${token}`, method);
      assert.equal(response.status, 404);
      await response.text();
    }
    assert.equal(f.events.length, 0);
    const response = await f.get('/management/v1/audit', '', 'GET', `session=${token}`);
    assert.equal(response.status, 401);
    await response.text();
  } finally {
    await f.close();
  }
});

test('invalid explicit writer fails before acquiring SQL and at direct composition', async () => {
  const db = new PGlite();
  let opens = 0;
  try {
    for (const writeAuditHistoryAccess of [undefined, null, false, {}, 'writer']) {
      await assert.rejects(
        startPostgresSsoWorkspaceGateway({
          ...jwt.config,
          host: '127.0.0.1',
          port: 0,
          browserJavascript: 'export {};',
          newRequestId: () => 'id',
          openConnection: () => {
            opens++;
            throw Error('must not open');
          },
          writeAuditHistoryAccess,
        } as unknown as Parameters<typeof startPostgresSsoWorkspaceGateway>[0]),
        { name: 'InvalidGatewayRuntimeInput' },
      );
      assert.throws(
        () =>
          createPostgresSsoAdministrationBrowserHandler({
            ...jwt.config,
            client: { query: (q: string, p: readonly unknown[]) => db.query(q, [...p]) },
            javascript: 'export {};',
            newRequestId: () => 'id',
            writeAuditHistoryAccess,
          } as unknown as Parameters<typeof createPostgresSsoAdministrationBrowserHandler>[0]),
        { name: 'InvalidSsoAccessTokenConfiguration' },
      );
    }
    assert.equal(opens, 0);
  } finally {
    await db.close();
  }
});

test('workspace audit SQL failure records unavailable and does not leak storage details', async () => {
  const f = await fixture();
  try {
    await f.db.exec('DROP TABLE gateway_audit_events');
    const response = await f.get();
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /gateway_audit_events|event-human|existing-proxy/);
    assert.equal(f.events.at(-1)?.outcome, 'unavailable');
    assert.equal(f.events.at(-1)?.count, 0);
    assert.equal(f.events.at(-1)?.principalId, 'human');
  } finally {
    await f.close();
  }
});
