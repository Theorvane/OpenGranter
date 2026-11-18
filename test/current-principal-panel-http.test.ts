import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoManagementGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountCurrentPrincipalPanel } from '../src/management/current-principal-panel.ts';
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
function refresh(root: Element) {
  const button = nodes(root).find(
    (node) => node.tag === 'button' && node.textContent === 'Refresh account',
  );
  assert.ok(button);
  button.listeners.click?.();
}

test('Account DOM reads real owned HTTP identity then clears on fresh deactivation', async () => {
  const f = await fixture();
  const root = new Element();
  const panel = mountCurrentPrincipalPanel(root, (path, init) =>
    f.request(path, `Bearer ${token}`, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers)),
        authorization: `Bearer ${token}`,
      },
    }),
  );
  try {
    assert.match(text(root), /Loading account/);
    await waitFor(() => text(root).includes('account-human'));
    assert.equal(
      (await f.db.query('SELECT * FROM sso_current_principal_audit_events')).rows.length,
      1,
    );
    await f.db.exec('UPDATE iam_principals SET active=false');
    refresh(root);
    assert.doesNotMatch(text(root), /account-human/);
    await waitFor(() => text(root).includes('Sign in required'));
    assert.equal(nodes(root).filter((node) => node.tag === 'button').length, 0);
    assert.equal(
      (await f.db.query('SELECT * FROM sso_current_principal_audit_events')).rows.length,
      2,
    );
  } finally {
    panel.dispose();
    await f.close();
  }
});

test('Account DOM hides identity on required audit outage and recovers after explicit retry', async () => {
  const f = await fixture();
  const root = new Element();
  const panel = mountCurrentPrincipalPanel(root, (path, init) =>
    f.request(path, `Bearer ${token}`, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers)),
        authorization: `Bearer ${token}`,
      },
    }),
  );
  try {
    await waitFor(() => text(root).includes('account-human'));
    await f.db.exec('DROP TABLE sso_current_principal_audit_events');
    refresh(root);
    assert.doesNotMatch(text(root), /account-human/);
    await waitFor(() => text(root).includes('Account unavailable'));
    assert.doesNotMatch(text(root), /account-human|SQL|SELECT|table/);
    await f.db.exec(
      await readFile(
        new URL('../contracts/sql/current-principal-audit.sql', import.meta.url),
        'utf8',
      ),
    );
    const retry = nodes(root).find(
      (node) => node.tag === 'button' && node.textContent === 'Retry account',
    );
    assert.ok(retry);
    retry.listeners.click?.();
    await waitFor(() => text(root).includes('account-human'));
    assert.equal(
      (await f.db.query('SELECT * FROM sso_current_principal_audit_events')).rows.length,
      1,
    );
  } finally {
    panel.dispose();
    await f.close();
  }
});

test('Account binding removal ends the mount; trusted remount reads only the rebound identity', async () => {
  const f = await fixture();
  const root = new Element();
  const mount = () =>
    mountCurrentPrincipalPanel(root, (path, init) =>
      f.request(path, 'Bearer ' + token, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers)),
          authorization: 'Bearer ' + token,
        },
      }),
    );
  let panel = mount();
  try {
    await waitFor(() => text(root).includes('account-human'));
    const oldRefresh = nodes(root).find((node) => node.tag === 'button');
    assert.ok(oldRefresh);
    await f.db.exec('DELETE FROM iam_sso_identity_bindings');
    refresh(root);
    assert.doesNotMatch(text(root), /account-human/);
    await waitFor(() => text(root).includes('Sign in required'));
    assert.equal(nodes(root).filter((node) => node.tag === 'button').length, 0);
    await f.db.query('INSERT INTO iam_principals VALUES ($1,$2,true)', [
      'replacement-human',
      'human',
    ]);
    await f.db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'replacement-human',
    ]);
    const before = f.calls;
    oldRefresh.listeners.click?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.calls, before);
    assert.match(text(root), /Sign in required/);
    panel.dispose();
    panel = mount();
    assert.match(text(root), /Loading account/);
    assert.doesNotMatch(text(root), /account-human|replacement-human/);
    await waitFor(() => text(root).includes('replacement-human'));
    assert.doesNotMatch(text(root), /account-human/);
    oldRefresh.listeners.click?.();
    assert.match(text(root), /replacement-human/);
    assert.deepEqual(
      (
        await f.db.query(
          'SELECT outcome, principal_id FROM sso_current_principal_audit_events ORDER BY event_id',
        )
      ).rows,
      [
        { outcome: 'ready', principal_id: 'account-human' },
        { outcome: 'unauthenticated', principal_id: null },
        { outcome: 'ready', principal_id: 'replacement-human' },
      ],
    );
  } finally {
    panel.dispose();
    await f.close();
  }
});
