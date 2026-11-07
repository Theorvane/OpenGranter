import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { createPostgresSsoAdministrationBrowserServer } from '../src/gateway/postgres-sso-administration-browser-http.ts';
import type { CatalogRequest } from '../src/management/catalog-client.ts';
import { mountSsoUsageWorkspace as source } from '../src/management/sso-usage-workspace.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';
import { TokenElement } from './token-management-dom-fixture.ts';

const javascript = await buildManagementBrowser({
  root: process.cwd(),
  entry: 'src/management/sso-usage-workspace.ts',
});
const built = (await import(
  'data:text/javascript;base64,' + Buffer.from(javascript).toString('base64')
)) as { mountSsoUsageWorkspace: typeof source };
async function until(predicate: () => boolean) {
  for (let i = 0; i < 200 && !predicate(); i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(predicate(), 'workspace did not settle');
}
for (const [name, mount] of [
  ['source', source],
  ['built', built.mountSsoUsageWorkspace],
] as const) {
  test(
    name +
      ': Account and empty Models traverse existing opted-in administration host with no read stubs',
    async () => {
      const jwt = await createSsoAccessTokenFixture();
      const token = await jwt.token();
      const db = new PGlite();
      for (const migration of await loadPostgresMigrationSources()) await db.exec(migration.sql);
      await db.exec(
        await readFile(
          new URL('../contracts/sql/current-principal-audit.sql', import.meta.url),
          'utf8',
        ),
      );
      await db.exec("INSERT INTO iam_principals VALUES ('human-account','human',true)");
      await db.query(
        'INSERT INTO iam_sso_identity_bindings (issuer,subject,principal_id) VALUES ($1,$2,$3)',
        [jwt.issuer, jwt.subject, 'human-account'],
      );
      const client = {
        query: (text: string, values: readonly unknown[]) => db.query(text, [...values]),
      };
      let failing = false;
      const principalAuditClient = {
        query: (text: string, values: readonly unknown[]) => {
          if (failing) throw new Error('PRIVATE audit');
          return client.query(text, values);
        },
      };
      let id = 0;
      const server = createPostgresSsoAdministrationBrowserServer({
        ...jwt.config,
        client,
        principalAuditClient,
        javascript,
        newRequestId: () => 'ui-account-' + ++id,
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const origin = 'http://127.0.0.1:' + address.port;
      const root = new TokenElement();
      const app = mount(root, new EventTarget(), { now: jwt.config.now });
      const statuses: number[] = [];
      const paths: string[] = [];
      const request: CatalogRequest = async (path, init) => {
        paths.push(path);
        const headers = new Headers(init.headers);
        headers.set('authorization', 'Bearer ' + token);
        const response = await fetch(origin + path, { ...init, headers });
        if (path === '/management/v1/me') statuses.push(response.status);
        return response;
      };
      const grant = { request, expiresAt: jwt.config.now() + 60000 };
      const account = async (status: number) => {
        await app.authorize(grant);
        root.button('Account').click();
        await until(
          () => statuses.at(-1) === status && !root.text().includes('Loading current principal'),
        );
      };
      try {
        await account(200);
        await until(() => root.text().includes('human-account'));
        assert.ok(paths.includes('/management/v1/models'));
        assert.ok(paths.includes('/management/v1/me'));
        assert.deepEqual(
          (await db.query('SELECT outcome,principal_id FROM sso_current_principal_audit_events'))
            .rows,
          [{ outcome: 'ready', principal_id: 'human-account' }],
        );
        failing = true;
        await account(503);
        await until(() => root.text().includes('Current principal unavailable'));
        assert.doesNotMatch(root.text(), /human-account|PRIVATE|audit_unavailable/);
        failing = false;
        const readsBeforeRetry = paths.length;
        root.button('Retry current principal').click();
        await until(() => statuses.at(-1) === 200 && root.text().includes('human-account'));
        assert.equal(paths.length, readsBeforeRetry + 1);
        assert.equal(paths.at(-1), '/management/v1/me');
        assert.equal(
          (await db.query('SELECT * FROM sso_current_principal_audit_events')).rows.length,
          2,
        );
        await until(() => root.text().includes('human-account'));
        await db.exec('DELETE FROM iam_sso_identity_bindings');
        root.button('Account').click();
        await until(() => statuses.at(-1) === 401);
        await until(() => root.text().includes('Sign-in required'));
        assert.doesNotMatch(root.text(), /human-account/);
        app.clear();
        assert.doesNotMatch(root.text(), /human-account/);
      } finally {
        app.dispose();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await db.close();
      }
    },
  );
}
