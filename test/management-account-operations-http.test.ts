import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoManagementGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountSessionManagementOperations } from '../src/management/operations-session.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
async function fixture(installAudit = true, shell = false) {
  const db = new PGlite();
  let auditHook = async () => {};
  let acknowledgement: { readonly rows: readonly unknown[] } | undefined;
  let calls = 0;
  let closes = 0;
  const client: PostgresConnection = {
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
    query: async (sql, params) => {
      calls++;
      if (sql.includes('INSERT INTO sso_current_principal_audit_events')) {
        await auditHook();
        if (acknowledgement) return acknowledgement;
      }
      return db.query(sql, [...params]);
    },
  };
  const runtime = await startPostgresSsoManagementGateway({
    ...jwt.config,
    host: '127.0.0.1',
    port: 0,
    openConnection: () => client,
    newRequestId: () => 'account-read',
    ...(shell ? { browserJavascript: '// public Account shell' } : {}),
  });
  if (installAudit)
    await db.exec(
      await readFile(
        new URL('../contracts/sql/current-principal-audit.sql', import.meta.url),
        'utf8',
      ),
    );
  await db.exec("INSERT INTO iam_principals VALUES ('account-human','human',true)");
  await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
    jwt.issuer,
    jwt.subject,
    'account-human',
  ]);
  const address = runtime.address;
  return {
    db,
    ack(value: { readonly rows: readonly unknown[] } | undefined) {
      acknowledgement = value;
    },
    get calls() {
      return calls;
    },
    hook(value: () => Promise<void>) {
      auditHook = value;
    },
    request(path = '/management/v1/me', authorization = `Bearer ${token}`, init: RequestInit = {}) {
      return fetch(`http://127.0.0.1:${address.port}${path}`, {
        headers: { authorization },
        ...init,
      });
    },
    async close() {
      await Promise.all([runtime.close(), runtime.close()]);
      assert.equal(closes, 1);
    },
  };
}

class Element implements CatalogElement {
  textContent: string | null = null;
  value = '';
  children: Element[] = [];
  attributes: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  readonly tag: string;
  constructor(tag = 'div') {
    this.tag = tag;
  }
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
    this.textContent = null;
  }
  setAttribute(key: string, value: string) {
    this.attributes[key] = value;
  }
  addEventListener(key: string, listener: () => void) {
    this.listeners[key] = listener;
  }
  focus() {}
}
const nodes = (root: Element): Element[] => [root, ...root.children.flatMap(nodes)];
const text = (root: Element) =>
  nodes(root)
    .map((n) => n.textContent ?? '')
    .join(' ');

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'Account UI did not settle');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function click(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
  return node;
}

test('operations navigates actual HTTP history to audited Account, retries audit outage and locks on deactivation', async () => {
  const f = await fixture();
  await f.db.query('INSERT INTO iam_policies VALUES ($1,$2,$3)', [
    'reader',
    'v1',
    JSON.stringify([
      { effect: 'Allow', actions: ['usage:ReadSelf'], resources: ['principal:account-human'] },
    ]),
  ]);
  await f.db.query('INSERT INTO iam_principal_policies VALUES ($1,$2)', [
    'account-human',
    'reader',
  ]);
  const root = new Element();
  const calls: string[] = [];
  const app = mountSessionManagementOperations(root, () => ({
    save: () => 'started',
    dispose() {},
  }));
  const grant = {
    expiresAt: Date.now() + 60_000,
    request: (path: string, init: RequestInit) => {
      calls.push(path);
      return f.request(path, `Bearer ${token}`, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers)),
          authorization: `Bearer ${token}`,
        },
      });
    },
  };
  app.authorize(grant);
  try {
    await waitFor(() => text(root).includes('No history matches'));
    click(root, 'Account');
    await waitFor(() => text(root).includes('account-human'));
    assert.equal(
      (await f.db.query('SELECT * FROM sso_current_principal_audit_events')).rows.length,
      1,
    );
    await f.db.exec(
      'ALTER TABLE sso_current_principal_audit_events RENAME TO paused_account_audit',
    );
    click(root, 'Refresh account');
    assert.doesNotMatch(text(root), /account-human/);
    await waitFor(() => text(root).includes('Account unavailable'));
    assert.doesNotMatch(text(root), /paused_account_audit|INSERT|Postgres/);
    await f.db.exec(
      'ALTER TABLE paused_account_audit RENAME TO sso_current_principal_audit_events',
    );
    click(root, 'Retry account');
    await waitFor(() => text(root).includes('account-human'));
    click(root, 'History');
    await waitFor(() => text(root).includes('No history matches'));
    assert.doesNotMatch(text(root), /account-human/);
    click(root, 'Account');
    await waitFor(() => text(root).includes('account-human'));
    await f.db.exec('UPDATE iam_principals SET active=false');
    const refresh = click(root, 'Refresh account');
    await waitFor(() => text(root).includes('Sign-in required'));
    assert.doesNotMatch(text(root), /account-human|Management operations/);
    assert.equal(nodes(root).filter((n) => n.tag === 'button').length, 0);
    const count = calls.length;
    refresh.listeners.click?.();
    assert.equal(calls.length, count);
    // IAM recovery does not silently revive a denied caller-owned grant.
    await f.db.exec('UPDATE iam_principals SET active=true');
    refresh.listeners.click?.();
    assert.equal(calls.length, count);
    assert.doesNotMatch(text(root), /account-human|Management operations/);
    // Only explicit trusted caller authorization mounts a fresh workspace.
    app.authorize(grant);
    await waitFor(() => text(root).includes('No history matches'));
    assert.doesNotMatch(text(root), /account-human/);
    click(root, 'Account');
    await waitFor(() => text(root).includes('account-human'));
    assert.equal(calls.filter((path) => path === '/management/v1/principal').length, 6);
    assert.equal(
      (await f.db.query('SELECT * FROM sso_current_principal_audit_events')).rows.length,
      5,
    );
  } finally {
    app.dispose();
    await f.close();
  }
});
