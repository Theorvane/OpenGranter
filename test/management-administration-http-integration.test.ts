import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { createPostgresProxyCredentialStore } from '../src/gateway/postgres-proxy-credentials.ts';
import { createPostgresSsoAdministrationBrowserServer } from '../src/gateway/postgres-sso-administration-browser-http.ts';
import { createProxyTokenService } from '../src/gateway/proxy-tokens.ts';
import type { CatalogRequest } from '../src/management/catalog-client.ts';
import { mountSsoUsageWorkspace as source } from '../src/management/sso-usage-workspace.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
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
      ': same-origin Models/Account and confirmed mutations use actual composed HTTP without read stubs',
    async () => {
      const db = new PGlite();
      for (const migration of await loadPostgresMigrationSources()) await db.exec(migration.sql);
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
      const server = createPostgresSsoAdministrationBrowserServer({
        ...jwt.config,
        client,
        javascript: bundled,
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
      const paths: string[] = [];
      const statuses: number[] = [];
      const request: CatalogRequest = async (path, init) => {
        if (path.includes('/proxy-tokens')) paths.push(path);
        assert.equal(init.cache, 'no-store');
        assert.equal(init.credentials, 'omit');
        const headers = new Headers(init.headers);
        headers.set('authorization', 'Bearer ' + accessToken);
        const response = await fetch(base + path, { ...init, headers });
        if (path.includes('/proxy-tokens')) statuses.push(response.status);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        return response;
      };
      const grant = { request, expiresAt: jwt.config.now() + 60000 };
      const fillIssue = () => {
        root.named('principalId').value = 'human-owner';
        root.named('expiresAt').value = String(jwt.config.now() + 86400000);
        root.named('issue').submit();
      };
      const count = async () =>
        (await db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM proxy_credentials'))
          .rows[0]?.count;
      const verify = createProxyTokenService({
        store: createPostgresProxyCredentialStore(client),
        now: jwt.config.now,
      });
      try {
        await app.authorize(grant);
        root.button('Account').click();
        await until(() => root.text().includes('human-admin'));
        root.button('Credentials').click();
        fillIssue();
        assert.equal(paths.length, 0);
        assert.match(root.text(), /Principal ID to issue for: human-owner/);
        const staleConfirmation = root.button('Confirm issuance');
        root.button('Cancel issuance').click();
        staleConfirmation.click();
        assert.equal(paths.length, 0);
        fillIssue();
        root.button('Confirm issuance').click();
        await until(() =>
          root.all().some((n) => n.attrs['aria-label'] === 'One-time proxy token secret'),
        );
        assert.deepEqual(statuses, [201]);
        assert.equal(await count(), 1);
        const secret = root
          .all()
          .find((n) => n.attrs['aria-label'] === 'One-time proxy token secret')?.textContent;
        assert.ok(secret);
        assert.equal((await verify.verifyCredential(secret))?.principalId, 'human-owner');
        const credentialId = (
          await db.query<{ credential_id: string }>('SELECT credential_id FROM proxy_credentials')
        ).rows[0]?.credential_id;
        assert.ok(credentialId);
        root.button('Models').click();
        assert.ok(!root.text().includes(secret));
        root.button('Credentials').click();
        assert.ok(!root.text().includes(secret));
        root.named('credentialId').value = credentialId;
        root.named('revoke').submit();
        assert.equal(paths.length, 1);
        root.button('Confirm revocation').click();
        await until(() => /Token revoked\./.test(root.text()));
        assert.deepEqual(statuses, [201, 200]);
        assert.equal(await verify.verifyCredential(secret), undefined);
        const decisions = (
          await db.query(
            'SELECT operation,outcome,actor_id,target_principal_id FROM token_management_decisions ORDER BY event_id',
          )
        ).rows;
        assert.deepEqual(decisions, [
          {
            operation: 'issue',
            outcome: 'allowed',
            actor_id: 'human-admin',
            target_principal_id: 'human-owner',
          },
          {
            operation: 'revoke',
            outcome: 'allowed',
            actor_id: 'human-admin',
            target_principal_id: 'human-owner',
          },
        ]);
        const audit = JSON.stringify((await db.query('SELECT * FROM gateway_audit_events')).rows);
        assert.ok(!audit.includes(secret));
        assert.ok(!audit.includes(accessToken));
        // A fresh IAM change, not just a stale browser grant, blocks the next confirmed mutation.
        await db.exec(
          `UPDATE iam_policies SET version='v2',statements='[{"effect":"Deny","actions":["iam:Manage"],"resources":["*"]}]'`,
        );
        fillIssue();
        root.button('Confirm issuance').click();
        await until(() => /Access denied/.test(root.text()));
        assert.deepEqual(statuses, [201, 200, 403]);
        assert.equal(await count(), 1);
        assert.ok(!root.text().includes(secret));
        assert.equal(
          (
            await db.query<{ outcome: string }>(
              'SELECT outcome FROM token_management_decisions WHERE policy_versions @> \'[{"version":"v2"}]\'',
            )
          ).rows[0]?.outcome,
          'denied',
        );
        // Explicit test-only permission restoration is NOT browser login or automatic retry.
        await db.exec(
          `UPDATE iam_policies SET version='v3',statements='[{"effect":"Allow","actions":["iam:Manage"],"resources":["principal:*"]}]'`,
        );
        await app.authorize(grant);
        root.button('Credentials').click();
        // Required audit storage unavailable: transaction must not leave an issued credential.
        await db.exec('DROP TABLE token_management_decisions');
        fillIssue();
        root.button('Confirm issuance').click();
        await until(() => /reconcil/i.test(root.text()));
        assert.equal(statuses.at(-1), 503);
        assert.equal(await count(), 1);
        const before = paths.length;
        await app.authorize(grant);
        root.button('Credentials').click();
        assert.match(root.text(), /reconcil/i);
        root.named('issue').submit();
        assert.equal(paths.length, before);
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
