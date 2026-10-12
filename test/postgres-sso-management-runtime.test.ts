import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoManagementGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const startupError = { name: 'GatewayStartupUnavailable', message: 'Gateway startup unavailable' };

function fixture() {
  const db = new PGlite();
  let opens = 0;
  let closes = 0;
  let requestNumber = 0;
  let auditGate: (() => Promise<void>) | undefined;
  const connection: PostgresConnection = {
    query: async (sql, params) => {
      if (sql.includes('INSERT INTO gateway_audit_events')) await auditGate?.();
      return db.query(sql, [...params]);
    },
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
    newRequestId: () => `management-${++requestNumber}`,
    openConnection: () => {
      opens++;
      return connection;
    },
  };
  return {
    db,
    ports,
    connection,
    counts: () => ({ opens, closes }),
    gateAudit: (gate: () => Promise<void>) => {
      auditGate = gate;
    },
  };
}

function request(port: number, path: string, body: unknown, accessToken?: string) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('owned migrated management socket enforces SSO, IAM and audited issue/revoke', async () => {
  const f = fixture();
  const runtime = await startPostgresSsoManagementGateway(f.ports);
  const issue = '/management/v1/proxy-tokens';
  const revoke = `${issue}/revoke`;
  try {
    assert.equal(runtime.address.address, '127.0.0.1');
    assert.ok(runtime.address.port > 0);
    const unauthenticated = await request(runtime.address.port, issue, { malformed: true });
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.headers.get('cache-control'), 'no-store');
    await unauthenticated.text();
    assert.deepEqual((await f.db.query('SELECT kind FROM gateway_audit_events')).rows, [
      { kind: 'management-auth-denied' },
    ]);
    const proxyPath = await request(runtime.address.port, '/v1/chat/completions', {});
    assert.equal(proxyPath.status, 404);
    assert.equal(proxyPath.headers.get('cache-control'), 'no-store');
    await proxyPath.text();

    await f.db.exec(
      `INSERT INTO iam_principals VALUES ('human-admin','human',true),('human-owner','human',true); INSERT INTO iam_policies VALUES ('manage','v1','[{"effect":"Allow","actions":["iam:Manage"],"resources":["principal:*"]}]'); INSERT INTO iam_principal_policies VALUES ('human-admin','manage');`,
    );
    await f.db.query(
      'INSERT INTO iam_sso_identity_bindings (issuer, subject, principal_id) VALUES ($1,$2,$3)',
      [jwt.issuer, jwt.subject, 'human-admin'],
    );
    const signed = await jwt.token();
    const issuedResponse = await request(
      runtime.address.port,
      issue,
      { principalId: 'human-owner', expiresAt: jwt.config.now() + 86400000 },
      signed,
    );
    assert.equal(issuedResponse.status, 201);
    assert.equal(issuedResponse.headers.get('cache-control'), 'no-store');
    const issued = (await issuedResponse.json()) as { credentialId: string; token: string };
    assert.deepEqual(Object.keys(issued), ['credentialId', 'token']);
    assert.ok(issued.token);
    const revoked = await request(
      runtime.address.port,
      revoke,
      {
        credentialId: issued.credentialId,
      },
      signed,
    );
    assert.equal(revoked.status, 200);
    assert.deepEqual(await revoked.json(), { revoked: true });
    assert.deepEqual(
      (await f.db.query('SELECT action,actor_id FROM proxy_credential_events ORDER BY event_id'))
        .rows,
      [
        { action: 'issued', actor_id: 'human-admin' },
        { action: 'revoked', actor_id: 'human-admin' },
      ],
    );
    await f.db.exec(
      `UPDATE iam_policies SET version='v2', statements='[{"effect":"Deny","actions":["iam:Manage"],"resources":["*"]}]'`,
    );
    const denied = await request(
      runtime.address.port,
      issue,
      {
        principalId: 'human-owner',
        expiresAt: jwt.config.now() + 86400000,
      },
      signed,
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('cache-control'), 'no-store');
    await denied.text();
    const operational =
      JSON.stringify((await f.db.query('SELECT * FROM gateway_audit_events')).rows) +
      JSON.stringify((await f.db.query('SELECT * FROM token_management_decisions')).rows);
    for (const secret of [signed, issued.token, jwt.issuer, jwt.subject])
      assert.equal(operational.includes(secret), false);
    assert.deepEqual(f.counts(), { opens: 1, closes: 0 });
  } finally {
    const closing = runtime.close();
    assert.equal(runtime.close(), closing);
    await closing;
  }
  assert.deepEqual(f.counts(), { opens: 1, closes: 1 });
  await assert.rejects(request(runtime.address.port, issue, {}));
});

test('shutdown waits for an in-flight authentication audit before closing its connection', {
  timeout: 15_000,
}, async () => {
  const f = fixture();
  const runtime = await startPostgresSsoManagementGateway(f.ports);
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.gateAudit(async () => {
    entered();
    await gate;
  });
  const pending = request(runtime.address.port, '/management/v1/proxy-tokens', {});
  try {
    await started;
    const closing = runtime.close();
    await nextTurn();
    assert.equal(f.counts().closes, 0);
    release();
    const response = await pending;
    assert.equal(response.status, 401);
    await response.text();
    await closing;
    assert.equal(f.counts().closes, 1);
  } finally {
    release();
    await runtime.close();
  }
});

test('invalid bind input fails before opening and bad SSO configuration closes the connection', async () => {
  const invalid = fixture();
  try {
    await assert.rejects(startPostgresSsoManagementGateway({ ...invalid.ports, port: -1 }), {
      name: 'InvalidGatewayRuntimeInput',
      message: 'Invalid gateway runtime input',
    });
    assert.deepEqual(invalid.counts(), { opens: 0, closes: 0 });
  } finally {
    await invalid.db.close();
  }
  const badConfig = fixture();
  await assert.rejects(
    startPostgresSsoManagementGateway({
      ...badConfig.ports,
      jwks: { keys: [] },
    }),
    startupError,
  );
  assert.deepEqual(badConfig.counts(), { opens: 1, closes: 1 });
});

test('migration failure closes the management connection without leaking SQL details', async () => {
  const f = fixture();
  await assert.rejects(
    startPostgresSsoManagementGateway({
      ...f.ports,
      openConnection: () => ({
        ...f.connection,
        transaction: async () => {
          throw new Error('private-migration-detail');
        },
      }),
    }),
    (error: unknown) => {
      assert.equal((error as Error).name, startupError.name);
      assert.equal((error as Error).message, startupError.message);
      assert.equal((error as Error).cause, undefined);
      return true;
    },
  );
  assert.equal(f.counts().closes, 1);
});

test('occupied management bind closes its migrated connection with a safe startup failure', async () => {
  const occupied = createServer();
  await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  const address = occupied.address() as AddressInfo;
  const f = fixture();
  try {
    await assert.rejects(
      startPostgresSsoManagementGateway({
        ...f.ports,
        port: address.port,
      }),
      startupError,
    );
    assert.deepEqual(f.counts(), { opens: 1, closes: 1 });
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  }
});
