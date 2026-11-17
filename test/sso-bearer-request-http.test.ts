import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresSsoCanonicalOperationsServer } from '../src/gateway/postgres-sso-canonical-operations-http.ts';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { createCurrentPrincipalClient } from '../src/management/current-principal-client.ts';
import { mountCurrentPrincipalPanel } from '../src/management/current-principal-panel.ts';
import { createSsoManagementRequest } from '../src/management/sso-bearer-request.ts';
import { issueManagementToken } from '../src/management/token-issue-client.ts';
import { revokeManagementToken } from '../src/management/token-revoke-client.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

class Element implements CatalogElement {
  textContent: string | null = null;
  children: Element[] = [];
  listeners: Record<string, () => void> = {};
  ownerDocument = { createElement: () => new Element() };
  focus() {}
  setAttribute() {}
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
    this.textContent = null;
  }
  addEventListener(type: string, callback: () => void) {
    this.listeners[type] = callback;
  }
}
const nodes = (root: Element): Element[] => [root, ...root.children.flatMap(nodes)];
const text = (root: Element) =>
  nodes(root)
    .map((node) => node.textContent ?? '')
    .join(' ');
async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(check(), 'DOM must settle before bounded deadline');
}

test('explicit bearer adapter connects real canonical HTTP Account and token mutations with fresh IAM/audit', {
  timeout: 30000,
}, async () => {
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
  await db.exec(`
    INSERT INTO iam_principals VALUES ('admin','human',true),('owner','service',true);
    INSERT INTO iam_policies VALUES ('manage','v1','[{"effect":"Allow","actions":["iam:Manage"],"resources":["principal:owner"]}]');
    INSERT INTO iam_principal_policies VALUES ('admin','manage');
  `);
  await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
    jwt.issuer,
    jwt.subject,
    'admin',
  ]);
  let failAudit = false;
  let sequence = 0;
  const server = createPostgresSsoCanonicalOperationsServer({
    ...jwt.config,
    newRequestId: () => `transport-${++sequence}`,
    client: {
      query: (sql, params) => {
        if (failAudit && sql.includes('INSERT INTO token_management_decisions'))
          throw new Error('private audit failure');
        return db.query(sql, [...params]);
      },
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const transport = createSsoManagementRequest({
    accessToken: token,
    expiresAt: jwt.config.now() + 60000,
    now: jwt.config.now,
    request: (path, init) => fetch(base + path, init),
  });
  try {
    const account = await createCurrentPrincipalClient(transport.request).read();
    assert.deepEqual(account, { state: 'ready', data: { id: 'admin', kind: 'human' } });
    const issued = await issueManagementToken(transport.request, 'owner', jwt.config.now() + 30000);
    assert.equal(issued.state, 'ready');
    if (issued.state !== 'ready') throw new Error('Issuance did not complete');
    const revoked = await revokeManagementToken(transport.request, issued.credentialId);
    assert.equal(revoked.state, 'ready');
    await db.exec("DELETE FROM iam_principal_policies WHERE principal_id='admin'");
    const denied = await issueManagementToken(transport.request, 'owner', jwt.config.now() + 30000);
    assert.equal(denied.state, 'denied');
    await db.exec("INSERT INTO iam_principal_policies VALUES ('admin','manage')");
    failAudit = true;
    const unavailable = await issueManagementToken(
      transport.request,
      'owner',
      jwt.config.now() + 30000,
    );
    assert.equal(unavailable.state, 'uncertain');
    const count = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM proxy_credentials',
    );
    assert.equal(
      count.rows[0]?.count,
      1,
      'failed required audit must not create a second credential',
    );
    const invalid = createSsoManagementRequest({
      accessToken: 'synthetic.invalid.token',
      expiresAt: jwt.config.now() + 60000,
      now: jwt.config.now,
      request: (path, init) => fetch(base + path, init),
    });
    assert.equal(
      (await createCurrentPrincipalClient(invalid.request).read()).state,
      'unauthenticated',
    );
    invalid.dispose();
    // Actual management DOM consumer over native HTTP and canonical SSO/IAM.
    // This is a structural DOM port, not a claim of installed browser acceptance.
    const root = new Element();
    const panel = mountCurrentPrincipalPanel(root, transport.request);
    try {
      assert.match(text(root), /Loading account/);
      await until(() => text(root).includes('Principal ID'));
      assert.match(text(root), /admin/);
      const refresh = nodes(root).find((node) => node.textContent === 'Refresh account');
      assert.ok(refresh);
      await db.exec("UPDATE iam_principals SET active=false WHERE principal_id='admin'");
      refresh.listeners.click?.();
      await until(() => /Sign in required|Access denied/.test(text(root)));
      assert.doesNotMatch(text(root), /Principal ID|admin/);
      refresh.listeners.click?.();
      assert.doesNotMatch(text(root), /Principal ID|admin/);
    } finally {
      panel.dispose();
      assert.equal(root.children.length, 0);
    }
  } finally {
    transport.dispose();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});
