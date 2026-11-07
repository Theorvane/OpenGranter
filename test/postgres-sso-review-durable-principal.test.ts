import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresSsoAdministrationBrowserServer } from '../src/gateway/postgres-sso-administration-browser-http.ts';
import { createPostgresSsoReviewBrowserServer } from '../src/gateway/postgres-sso-review-browser-http.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

for (const [name, factory] of [
  ['review', createPostgresSsoReviewBrowserServer],
  ['administration', createPostgresSsoAdministrationBrowserServer],
] as const) {
  test(
    name + ': existing browser host opts into durable Account identity without legacy audit',
    async () => {
      const jwt = await createSsoAccessTokenFixture();
      const token = await jwt.token();
      const db = new PGlite();
      for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
      await db.exec(
        await readFile(
          new URL('../contracts/sql/current-principal-audit.sql', import.meta.url),
          'utf8',
        ),
      );
      await db.exec("INSERT INTO iam_principals VALUES ('human-admin','human',true)");
      await db.query(
        'INSERT INTO iam_sso_identity_bindings (issuer,subject,principal_id) VALUES ($1,$2,$3)',
        [jwt.issuer, jwt.subject, 'human-admin'],
      );
      await db.exec('DROP TABLE gateway_audit_events');
      let queries = 0;
      let auditUnavailable = false;
      let malformed = false;
      const client = {
        query: (text: string, values: readonly unknown[]) => {
          queries++;
          return db.query(text, [...values]);
        },
      };
      const principalAuditClient = {
        query: (text: string, values: readonly unknown[]) => {
          if (auditUnavailable) throw new Error('PRIVATE audit failure');
          if (malformed) return Promise.resolve({ rows: [{ event_id: '0' }] });
          return client.query(text, values);
        },
      };
      const configuration = {
        ...jwt.config,
        client,
        principalAuditClient,
        newRequestId: () => 'durable-account',
        javascript: 'export const publicArtifact = true;',
      };
      const server = factory(configuration);
      assert.equal(server.listening, false);
      configuration.principalAuditClient = {
        query: () => {
          throw new Error('PRIVATE replacement');
        },
      };
      try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        assert.ok(address && typeof address === 'object');
        const origin = 'http://127.0.0.1:' + address.port;
        const me = (value = token) =>
          fetch(origin + '/management/v1/me', { headers: { authorization: 'Bearer ' + value } });
        const response = await me();
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('x-request-id'), 'durable-account');
        assert.deepEqual(await response.json(), { principalId: 'human-admin' });
        assert.deepEqual(
          (await db.query('SELECT outcome,principal_id FROM sso_current_principal_audit_events'))
            .rows,
          [{ outcome: 'ready', principal_id: 'human-admin' }],
        );
        const beforeStatic = queries;
        const asset = await fetch(origin + '/management/app.js');
        assert.equal(asset.status, 200);
        await asset.text();
        assert.equal(queries, beforeStatic);
        const wrongMethod = await fetch(origin + '/management/v1/me', { method: 'POST' });
        assert.equal(wrongMethod.status, 404);
        await wrongMethod.text();
        assert.equal(queries, beforeStatic);
        for (const state of ['unavailable', 'malformed']) {
          auditUnavailable = state === 'unavailable';
          malformed = state === 'malformed';
          for (const value of [token, 'PRIVATE-invalid-token']) {
            const failed = await me(value);
            assert.equal(failed.status, 503);
            const body = await failed.text();
            assert.match(body, /audit_unavailable/);
            assert.doesNotMatch(body, /human-admin|PRIVATE|sso_current_principal/);
            assert.equal(body.includes(token), false);
          }
        }
        auditUnavailable = false;
        malformed = false;
        await db.exec('DELETE FROM iam_sso_identity_bindings');
        const revoked = await me();
        assert.equal(revoked.status, 401);
        await revoked.text();
        await db.exec('DROP TABLE iam_sso_identity_bindings');
        const unavailable = await me();
        assert.equal(unavailable.status, 503);
        assert.doesNotMatch(await unavailable.text(), /human-admin|iam_sso_identity_bindings/);
        const events = (
          await db.query(
            'SELECT outcome,principal_id FROM sso_current_principal_audit_events ORDER BY event_id',
          )
        ).rows;
        assert.deepEqual(events, [
          { outcome: 'ready', principal_id: 'human-admin' },
          { outcome: 'unauthenticated', principal_id: null },
          { outcome: 'unavailable', principal_id: null },
        ]);
        assert.equal(JSON.stringify(events).includes(token), false);
      } finally {
        server.closeAllConnections();
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        await db.close();
      }
    },
  );
}

for (const factory of [
  createPostgresSsoReviewBrowserServer,
  createPostgresSsoAdministrationBrowserServer,
]) {
  test('explicit invalid principal audit option never silently selects legacy identity', async () => {
    const jwt = await createSsoAccessTokenFixture();
    const client = {
      query: async () => {
        throw new Error('SQL must not run during construction');
      },
    };
    for (const value of [undefined, null, {}, { query: null }]) {
      const configuration = {
        ...jwt.config,
        client,
        newRequestId: () => 'invalid-config',
        javascript: 'public',
      };
      Reflect.set(configuration, 'principalAuditClient', value);
      assert.throws(() => factory(configuration), /InvalidSsoAccessTokenConfiguration/);
    }
  });
}
