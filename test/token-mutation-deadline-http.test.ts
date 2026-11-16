import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoManagementGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import type { CatalogRequest } from '../src/management/catalog-client.ts';
import { issueManagementToken } from '../src/management/token-issue-client.ts';
import { revokeManagementToken } from '../src/management/token-revoke-client.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const accessToken = await jwt.token();

for (const operation of ['issue', 'revoke'] as const) {
  test(`owned HTTP + migrated SQL: ${operation} timeout preserves committed mutation`, async () => {
    const db = new PGlite();
    const client: PostgresConnection = {
      query: (sql, params) => db.query(sql, [...params]),
      transaction: (callback) =>
        db.transaction((tx) =>
          callback({
            exec: (sql) => tx.exec(sql),
            query: (sql, params) => tx.query(sql, [...params]),
          }),
        ),
      close: () => db.close(),
    };
    let sequence = 0;
    const runtime = await startPostgresSsoManagementGateway({
      ...jwt.config,
      host: '127.0.0.1',
      port: 0,
      openConnection: () => client,
      newRequestId: () => `handoff-${++sequence}`,
    });
    await db.exec(
      "INSERT INTO iam_principals VALUES ('human-admin','human',true),('human-owner','human',true)",
    );
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'human-admin',
    ]);
    await db.query('INSERT INTO iam_policies VALUES ($1,$2,$3)', [
      'manage',
      'v1',
      JSON.stringify([
        { effect: 'Allow', actions: ['iam:Manage'], resources: ['principal:human-owner'] },
      ]),
    ]);
    await db.query('INSERT INTO iam_principal_policies VALUES ($1,$2)', ['human-admin', 'manage']);

    const direct: CatalogRequest = (path, init) =>
      fetch(`http://127.0.0.1:${runtime.address.port}${path}`, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers)),
          authorization: `Bearer ${accessToken}`,
        },
      });
    try {
      let credentialId = '';
      if (operation === 'revoke') {
        const issued = await issueManagementToken(
          direct,
          'human-owner',
          jwt.config.now() + 86400000,
        );
        assert.equal(issued.state, 'ready');
        if (issued.state !== 'ready') throw new Error('setup issuance unavailable');
        credentialId = issued.credentialId;
      }
      let deliver!: (response: Response) => void;
      let received!: (response: Response) => void;
      const headers = new Promise<Response>((resolve) => {
        received = resolve;
      });
      const delivery = new Promise<Response>((resolve) => {
        deliver = resolve;
      });
      let calls = 0;
      const delayed: CatalogRequest = async (path, init) => {
        calls++;
        // Simulate a caller port ignoring abort after a committed HTTP write.
        const { signal: _signal, ...transport } = init;
        const response = await direct(path, transport);
        received(response);
        return delivery;
      };
      const result =
        operation === 'issue'
          ? issueManagementToken(delayed, 'human-owner', jwt.config.now() + 86400000)
          : revokeManagementToken(delayed, credentialId);
      const response = await headers;
      assert.equal(response.status, operation === 'issue' ? 201 : 200);
      // Exercise the actual ten-second production bound without clock injection.
      assert.deepEqual(await result, { state: 'uncertain' });
      assert.equal(calls, 1);
      const events = await db.query('SELECT action FROM proxy_credential_events ORDER BY event_id');
      assert.deepEqual(
        events.rows,
        operation === 'issue'
          ? [{ action: 'issued' }]
          : [{ action: 'issued' }, { action: 'revoked' }],
      );
      const decisions = await db.query(
        'SELECT operation,outcome FROM token_management_decisions ORDER BY event_id',
      );
      assert.deepEqual(
        decisions.rows,
        operation === 'issue'
          ? [{ operation: 'issue', outcome: 'allowed' }]
          : [
              { operation: 'issue', outcome: 'allowed' },
              { operation: 'revoke', outcome: 'allowed' },
            ],
      );
      deliver(response);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(response.bodyUsed, true);
      assert.equal(calls, 1);
      assert.deepEqual(await result, { state: 'uncertain' });
    } finally {
      await runtime.close();
    }
  });
}
