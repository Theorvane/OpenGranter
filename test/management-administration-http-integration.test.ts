import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as nodeRequest } from 'node:http';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { createPostgresProxyCredentialStore } from '../src/gateway/postgres-proxy-credentials.ts';
import { createPostgresSsoAdministrationBrowserServer } from '../src/gateway/postgres-sso-administration-browser-http.ts';
import { createPostgresSsoReviewBrowserHandler } from '../src/gateway/postgres-sso-review-browser-http.ts';
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
      assert.equal(server.listening, false);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const base = 'http://127.0.0.1:' + address.port;
      const root = new TokenElement();
      const lifecycle = new EventTarget();
      const app = mount(root, lifecycle, { now: jwt.config.now });
      const reads: string[] = [];
      const paths: string[] = [];
      const statuses: number[] = [];
      const request: CatalogRequest = async (path, init) => {
        if (path.includes('/proxy-tokens')) paths.push(path);
        else reads.push(path);
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
        const html = await fetch(base + '/management');
        assert.equal(html.status, 200);
        assert.match(await html.text(), /management\/app.js/);
        const artifact = await fetch(base + '/management/app.js');
        assert.equal(await artifact.text(), bundled);
        await app.authorize(grant);
        assert.ok(reads.includes('/management/v1/models'));
        root.button('Account').click();
        await until(() => root.text().includes('human-admin'));
        assert.ok(reads.includes('/management/v1/me'));
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

test('explicit administration allowlist preserves read-only contract and rejects ambient authority', async () => {
  const db = new PGlite();
  for (const migration of await loadPostgresMigrationSources()) await db.exec(migration.sql);
  let queries = 0;
  let ids = 0;
  const ports = {
    ...jwt.config,
    client: {
      query: (text: string, values: readonly unknown[] = []) => {
        queries++;
        return db.query(text, [...values]);
      },
    },
    newRequestId: () => 'administration-' + ++ids,
    javascript: 'export const publicArtifact = true;',
  };
  const readonly = createPostgresSsoReviewBrowserHandler(ports);
  const server = createPostgresSsoAdministrationBrowserServer(ports);
  assert.equal(server.listening, false);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port;
  try {
    for (const path of ['/management', '/management/', '/management/app.js']) {
      const result = await fetch(base + path);
      assert.equal(result.status, 200);
      assert.equal(result.headers.get('cache-control'), 'no-store');
      assert.equal(result.headers.get('set-cookie'), null);
      await result.text();
    }
    assert.equal(queries, 0);
    assert.equal(ids, 0);
    for (const [method, path] of [
      ['GET', '/management/v1/proxy-tokens'],
      ['DELETE', '/management/v1/proxy-tokens/revoke'],
      ['POST', '/management/v1/proxy-tokens/'],
      ['POST', '/management/v1/proxy-tokens/revoke/'],
      ['POST', '/management/v1/me'],
      ['POST', '/management/v1/models'],
      ['POST', '/management/v1/usage'],
      ['POST', '/v1/chat/completions'],
    ] as const) {
      const result = await fetch(base + path, { method });
      assert.equal(result.status, 404);
      assert.equal(result.headers.get('cache-control'), 'no-store');
      await result.text();
    }
    for (const path of ['/management/v1/proxy-tokens', '/management/v1/proxy-tokens/revoke']) {
      const result = await readonly(new Request(base + path, { method: 'POST' }));
      assert.equal(result.status, 404);
    }
    assert.equal(queries, 0);
    assert.equal(ids, 0);
    for (const path of ['/management/v1/proxy-tokens', '/management/v1/proxy-tokens/revoke']) {
      const result = await fetch(base + path, {
        method: 'POST',
        headers: { cookie: 'session=not-authority', 'content-type': 'application/json' },
        body: '{malformed-private-input',
      });
      assert.equal(result.status, 401);
      assert.equal(result.headers.get('cache-control'), 'no-store');
      assert.equal(result.headers.get('set-cookie'), null);
      assert.doesNotMatch(await result.text(), /not-authority|malformed-private-input/);
    }
    const events = JSON.stringify((await db.query('SELECT * FROM gateway_audit_events')).rows);
    assert.doesNotMatch(events, /not-authority|malformed-private-input/);
    assert.equal((await db.query('SELECT * FROM proxy_credentials')).rows.length, 0);
    await db.exec('DROP TABLE gateway_audit_events');
    const failure = await fetch(base + '/management/v1/proxy-tokens', { method: 'POST' });
    assert.equal(failure.status, 503);
    assert.match(await failure.text(), /audit_unavailable/);
    const trace = await new Promise<{
      status: number | undefined;
      headers: Record<string, unknown>;
      body: string;
    }>((resolve, reject) => {
      const request = nodeRequest(
        base + '/management/v1/proxy-tokens',
        { method: 'TRACE' },
        (response) => {
          let body = '';
          response.on('data', (chunk) => {
            body += String(chunk);
          });
          response.on('end', () =>
            resolve({ status: response.statusCode, headers: response.headers, body }),
          );
        },
      );
      request.on('error', reject);
      request.end();
    });
    assert.equal(trace.status, 503);
    assert.equal(trace.headers['cache-control'], 'no-store');
    assert.match(trace.body, /internal_error/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});
