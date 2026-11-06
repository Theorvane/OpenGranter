import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  createPostgresSsoManagementWorkspaceHandler,
  createPostgresSsoManagementWorkspaceServer,
} from '../src/gateway/postgres-sso-management-workspace-http.ts';
import { createPostgresSsoReviewHandler } from '../src/gateway/postgres-sso-review-http.ts';
import { createManagementTokenClient } from '../src/management/token-management-client.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const issuePath = '/management/v1/proxy-tokens';
const revokePath = `${issuePath}/revoke`;
const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
const now = jwt.config.now;
const day = 86400000;
function request(path: string, body: unknown, accessToken = token, signal?: AbortSignal) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
}
const issue = { principalId: 'owner', expiresAt: now() + day };
async function fixture() {
  const db = new PGlite();
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
  await db.exec(
    await readFile(new URL('../contracts/sso-usage-audit-schema.sql', import.meta.url), 'utf8'),
  );
  await db.exec(`INSERT INTO iam_principals VALUES ('admin','human',true),('owner','human',true);
    INSERT INTO iam_policies VALUES ('manage','v1','[{"effect":"Allow","actions":["iam:Manage","llm:ListModels","usage:ReadSelf"],"resources":["*"]}]');
    INSERT INTO iam_principal_policies VALUES ('admin','manage');`);
  await db.query(
    'INSERT INTO iam_sso_identity_bindings (issuer,subject,principal_id) VALUES ($1,$2,$3)',
    [jwt.issuer, jwt.subject, 'admin'],
  );
  let failAudit = false;
  let queries = 0;
  const config = {
    ...jwt.config,
    client: {
      query: async (sql: string, params: readonly unknown[]) => {
        queries++;
        if (failAudit && sql.includes('INSERT INTO token_management_decisions'))
          throw Error('private database failure');
        return db.query(sql, [...params]);
      },
    },
    newRequestId: () => 'workspace-request',
  };
  return {
    db,
    config,
    failAudit: () => {
      failAudit = true;
    },
    queries: () => queries,
  };
}
async function status(response: Response, expected: number) {
  assert.equal(response.status, expected);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  if (expected !== 201)
    assert.doesNotMatch(
      JSON.stringify(body),
      /private database failure|private-subject-fixture|private-issuer-fixture/,
    );
  return body;
}

test('explicit workspace rejects route/method lookalikes without SQL; review remains read-only', async () => {
  let queries = 0;
  let ids = 0;
  const config = {
    ...jwt.config,
    client: {
      query: async () => {
        queries++;
        throw Error('unexpected SQL');
      },
    },
    newRequestId: () => {
      ids++;
      return 'r';
    },
  };
  const handler = createPostgresSsoManagementWorkspaceHandler(config);
  const review = createPostgresSsoReviewHandler(config);
  for (const path of [issuePath, revokePath]) {
    await status(await review(request(path, issue)), 404);
    for (const method of ['GET', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'])
      await status(await handler(new Request(`http://localhost${path}`, { method })), 404);
    for (const suffix of ['/', '-extra', '%2F'])
      await status(await handler(request(path + suffix, issue)), 404);
  }
  assert.equal(queries, 0);
  assert.equal(ids, 0);
});

test('workspace preserves child query/body/abort validation and ignores extra authority ports', async () => {
  const f = await fixture();
  try {
    let overrides = 0;
    const handler = createPostgresSsoManagementWorkspaceHandler({
      ...f.config,
      authenticate: () => {
        overrides++;
        return 'admin';
      },
      issue: () => {
        overrides++;
        return {};
      },
      writeAudit: () => {
        overrides++;
      },
    } as typeof f.config);
    await status(await handler(request(issuePath + '?actor=admin', issue)), 400);
    // Existing child authenticates before rejecting query parameters.
    assert.equal(f.queries(), 1);
    await status(await handler(request(issuePath, issue, token, AbortSignal.abort())), 400);
    assert.equal(f.queries(), 1);
    await status(await handler(request(issuePath, { ...issue, actorId: 'admin' })), 400);
    await status(await handler(request(issuePath, issue, 'not-a-jwt')), 401);
    assert.equal(overrides, 0);
    assert.equal(
      (await f.db.query<Record<string, unknown>>('SELECT * FROM proxy_credentials')).rows.length,
      0,
    );
    const events = (
      await f.db.query<Record<string, unknown>>(
        'SELECT kind,principal_id,details FROM gateway_audit_events',
      )
    ).rows;
    assert.equal(events.length, 1);
    assert.equal(events[0]?.principal_id, null);
  } finally {
    await f.db.close();
  }
});

test('workspace current owner IAM, lifetime and failed mandatory audit block writes', async () => {
  const f = await fixture();
  try {
    const handler = createPostgresSsoManagementWorkspaceHandler(f.config);
    await status(await handler(request(issuePath, { ...issue, expiresAt: now() + 31 * day })), 400);
    await f.db.exec(
      `UPDATE iam_policies SET version='v2', statements='[{"effect":"Deny","actions":["iam:Manage"],"resources":["*"]}]' WHERE policy_id='manage'`,
    );
    await status(await handler(request(issuePath, issue)), 403);
    const decisions = (
      await f.db.query<Record<string, unknown>>(
        'SELECT outcome,policy_versions FROM token_management_decisions ORDER BY event_id',
      )
    ).rows;
    assert.deepEqual(
      decisions.map((row) => row.outcome),
      ['allowed', 'denied'],
    );
    f.failAudit();
    await status(await handler(request(issuePath, issue)), 503);
    assert.equal(
      (await f.db.query<Record<string, unknown>>('SELECT * FROM proxy_credentials')).rows.length,
      0,
    );
  } finally {
    await f.db.close();
  }
});

test('unbound workspace serves signed SSO reads and issue/digest/revoke over real loopback HTTP', async () => {
  const f = await fixture();
  const server = createPostgresSsoManagementWorkspaceServer(f.config);
  assert.equal(server.listening, false);
  assert.equal(f.queries(), 0);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown) =>
    fetch(base + path, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
    });
  try {
    for (const path of ['/management/v1/models', '/management/v1/usage'])
      await status(
        await fetch(base + path, { headers: { authorization: `Bearer ${token}` } }),
        200,
      );
    // Existing browser transport, test-only signed authority adapter: not a session.
    const uiClient = createManagementTokenClient((path, init) => {
      const headers = new Headers(init.headers);
      headers.set('authorization', 'Bearer ' + token);
      return fetch(base + path, { ...init, headers });
    });
    const issued = await uiClient.issue(issue);
    assert.equal(issued.state, 'issued');
    if (issued.state !== 'issued') throw Error('issuance failed');
    assert.equal(typeof issued.token, 'string');
    const digest = createHash('sha256').update(issued.token).digest('hex');
    const stored = (
      await f.db.query<Record<string, unknown>>(
        'SELECT token_digest,revoked_at_ms FROM proxy_credentials WHERE credential_id=$1',
        [issued.credentialId],
      )
    ).rows[0];
    assert.equal(stored?.token_digest, digest);
    assert.equal(stored?.revoked_at_ms, null);
    assert.deepEqual(await uiClient.revoke({ credentialId: issued.credentialId }), {
      state: 'revoked',
      revoked: true,
    });
    uiClient.dispose();
    assert.notEqual(
      (
        await f.db.query<Record<string, unknown>>(
          'SELECT revoked_at_ms FROM proxy_credentials WHERE credential_id=$1',
          [issued.credentialId],
        )
      ).rows[0]?.revoked_at_ms,
      null,
    );
    const events = (
      await f.db.query<Record<string, unknown>>(
        'SELECT action,actor_id,principal_id FROM proxy_credential_events ORDER BY event_id',
      )
    ).rows;
    assert.deepEqual(events, [
      { action: 'issued', actor_id: 'admin', principal_id: 'owner' },
      { action: 'revoked', actor_id: 'admin', principal_id: 'owner' },
    ]);
    const history = JSON.stringify(
      (await f.db.query<Record<string, unknown>>('SELECT * FROM token_management_decisions')).rows,
    );
    assert.equal(history.includes(issued.token), false);
    assert.equal(history.includes(token), false);
    await f.db.exec('DELETE FROM iam_sso_identity_bindings');
    await status(await post(issuePath, issue), 401);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await f.db.close();
  }
});
