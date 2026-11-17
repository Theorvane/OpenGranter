import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresSsoCanonicalOperationsServer } from '../src/gateway/postgres-sso-canonical-operations-http.ts';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountSsoManagementOperations } from '../src/management/sso-operations-host.ts';
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

test('SSO operations host renders canonical HTTP Account then clears identity and transport on revocation', {
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
  let sequence = 0;
  const server = createPostgresSsoCanonicalOperationsServer({
    ...jwt.config,
    newRequestId: () => `transport-${++sequence}`,
    client: {
      query: (sql, params) => {
        return db.query(sql, [...params]);
      },
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;

  const root = new Element();
  const calls: { signal?: AbortSignal | null }[] = [];
  const host = mountSsoManagementOperations(
    root,
    () => ({
      dispose() {},
      save() {
        return 'unavailable';
      },
    }),
    { now: jwt.config.now },
  );
  try {
    assert.match(text(root), /Sign-in required/);
    host.authorize({
      accessToken: token,
      expiresAt: jwt.config.now() + 60000,
      request: (path, init) => {
        calls.push(init);
        return fetch(base + path, init);
      },
    });
    nodes(root)
      .find((n) => n.textContent === 'Account')
      ?.listeners.click?.();
    assert.match(text(root), /Loading account/);
    await until(() => text(root).includes('Principal ID'));
    assert.match(text(root), /admin/);
    const refresh = nodes(root).find((n) => n.textContent === 'Refresh account');
    assert.ok(refresh);
    await db.exec("UPDATE iam_principals SET active=false WHERE principal_id='admin'");
    refresh.listeners.click?.();
    await until(() => /Sign-in required|Access denied/.test(text(root)));
    assert.doesNotMatch(text(root), /Principal ID|admin/);
    assert.equal(calls.at(-1)?.signal?.aborted, true);
    const count = calls.length;
    refresh.listeners.click?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, count);
  } finally {
    host.dispose();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});
