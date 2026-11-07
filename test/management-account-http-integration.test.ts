import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { createPostgresRfc9068SsoManagementServer } from '../src/gateway/postgres-sso-management-http.ts';
import type { CatalogRequest } from '../src/management/catalog-client.ts';
import { mountSsoUsageWorkspace as source } from '../src/management/sso-usage-workspace.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';
import { TokenElement } from './token-management-dom-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const accessToken = await jwt.token();
const bundled = await buildManagementBrowser({
  root: process.cwd(),
  entry: 'src/management/sso-usage-workspace.ts',
});
const built = (await import(
  'data:text/javascript;base64,' + Buffer.from(bundled).toString('base64')
)) as { mountSsoUsageWorkspace: typeof source };
async function until(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(predicate(), 'workspace did not settle');
}
for (const [label, mount] of [
  ['source', source],
  ['built public module', built.mountSsoUsageWorkspace],
] as const) {
  test(
    label +
      ': Account identity traverses signed SSO HTTP and fresh binding with mandatory failure audit',
    async () => {
      const db = new PGlite();
      for (const name of [
        '002_proxy_credentials.sql',
        '003_gateway_audit.sql',
        '004_iam_snapshots.sql',
        '008_token_management_decisions.sql',
        '011_sso_identity_bindings.sql',
      ]) {
        await db.exec(await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8'));
      }
      await db.exec(
        `INSERT INTO iam_principals VALUES ('human-admin','human',true),('human-owner','human',true); INSERT INTO iam_policies VALUES ('manage','v1','[{"effect":"Allow","actions":["iam:Manage"],"resources":["principal:*"]}]'); INSERT INTO iam_principal_policies VALUES ('human-admin','manage');`,
      );
      await db.query(
        'INSERT INTO iam_sso_identity_bindings (issuer,subject,principal_id) VALUES ($1,$2,$3)',
        [jwt.issuer, jwt.subject, 'human-admin'],
      );
      const client = {
        query: (sql: string, params: readonly unknown[] = []) => db.query(sql, [...params]),
      };
      let sequence = 0;
      const server = createPostgresRfc9068SsoManagementServer({
        ...jwt.config,
        client,
        newRequestId: () => 'credentials-' + ++sequence,
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const base = 'http://127.0.0.1:' + address.port;
      const root = new TokenElement();
      const lifecycle = new EventTarget();
      const app = mount(root, lifecycle, { now: jwt.config.now });
      const statuses: number[] = [];
      const paths: string[] = [];
      const request: CatalogRequest = async (path, init) => {
        // Explicit catalog-only stub: identity requests traverse the actual server.
        if (path === '/management/v1/models') return Response.json({ object: 'list', data: [] });
        paths.push(path);
        assert.equal(path, '/management/v1/me');
        assert.equal(init.method, 'GET');
        assert.equal(init.cache, 'no-store');
        assert.equal(init.credentials, 'omit');
        assert.equal(init.redirect, 'error');
        const headers = new Headers(init.headers);
        headers.set('authorization', 'Bearer ' + accessToken);
        const response = await fetch(base + path, { ...init, headers });
        statuses.push(response.status);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        return response;
      };
      const grant = { request, expiresAt: jwt.config.now() + 60000 };
      const readAccount = async () => {
        await app.authorize(grant);
        root.button('Account').click();
        await until(() => !/Loading current principal/.test(root.text()));
      };
      try {
        // Identity works with NO policy attachment, but must not create one.
        await db.exec('DELETE FROM iam_principal_policies');
        await readAccount();
        assert.match(root.text(), /Current principal: human-admin/);
        assert.equal(statuses.at(-1), 200);
        assert.equal((await db.query('SELECT * FROM iam_principal_policies')).rows.length, 0);
        assert.equal((await db.query('SELECT * FROM proxy_credentials')).rows.length, 0);
        root.button('Models').click();
        assert.doesNotMatch(root.text(), /human-admin/);
        // Fresh binding lookup on every read: inactive/removed bindings cannot reuse identity.
        await db.exec("UPDATE iam_principals SET active=false WHERE principal_id='human-admin'");
        await readAccount();
        assert.equal(statuses.at(-1), 401);
        assert.match(root.text(), /Sign-in required/);
        assert.doesNotMatch(root.text(), /human-admin/);
        await db.exec("UPDATE iam_principals SET active=true WHERE principal_id='human-admin'");
        await readAccount();
        assert.equal(statuses.at(-1), 200);
        await db.exec('DELETE FROM iam_sso_identity_bindings');
        await readAccount();
        assert.equal(statuses.at(-1), 401);
        assert.doesNotMatch(root.text(), /human-admin/);
        const audit = await db.query('SELECT * FROM gateway_audit_events');
        assert.ok(audit.rows.length >= 2);
        const serialized = JSON.stringify(audit.rows);
        assert.doesNotMatch(serialized, /private-subject-fixture|private-issuer-fixture/);
        assert.ok(!serialized.includes(accessToken));
        // Failed required anonymous auth audit suppresses the original auth response.
        await db.exec('DROP TABLE gateway_audit_events');
        await readAccount();
        assert.equal(statuses.at(-1), 503);
        assert.match(root.text(), /Current principal unavailable/);
        assert.doesNotMatch(root.text(), /human-admin|audit_unavailable|private/);
        assert.ok(paths.every((path) => path === '/management/v1/me'));
        lifecycle.dispatchEvent(new Event('pagehide'));
        assert.doesNotMatch(root.text(), /human-admin/);
      } finally {
        app.dispose();
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        await db.close();
      }
    },
  );
}
