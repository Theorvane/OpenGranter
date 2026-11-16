import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoManagementGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import type { CatalogRequest } from '../src/management/catalog-client.ts';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountSessionCurrentPrincipal } from '../src/management/current-principal-session.ts';
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
test('trusted Account lifecycle consumes real owned HTTP, expires, reauthorizes and observes fresh IAM denial', async () => {
  const f = await fixture();
  const root = new Element();
  let now = 100;
  let fire = () => {};
  const app = mountSessionCurrentPrincipal(root, {
    now: () => now,
    schedule: (_delay, callback) => {
      fire = callback;
      return () => {};
    },
  });
  const request: CatalogRequest = (path, init) =>
    f.request(path, '', {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers)),
        authorization: `Bearer ${token}`,
      },
    });
  try {
    app.authorize({ expiresAt: 200, request });
    await waitFor(() => text(root).includes('account-human'));
    now = 200;
    fire();
    assert.doesNotMatch(text(root), /account-human/);
    assert.match(text(root), /expired/i);
    app.authorize({ expiresAt: 300, request });
    await waitFor(() => text(root).includes('account-human'));
    await f.db.exec('UPDATE iam_principals SET active=false');
    const refresh = nodes(root).find((node) => node.textContent === 'Refresh account');
    assert.ok(refresh);
    refresh.listeners.click?.();
    await waitFor(() => /sign in/i.test(text(root)));
    assert.doesNotMatch(text(root), /account-human/);
    assert.equal(
      (await f.db.query('SELECT * FROM sso_current_principal_audit_events')).rows.length,
      3,
    );
    await f.db.exec('UPDATE iam_principals SET active=true');
    let release!: () => void;
    let entered = false;
    f.hook(async () => {
      entered = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    let delivered = false;
    app.authorize({
      expiresAt: 400,
      request: async (path, init) => {
        const response = await request(path, init);
        delivered = true;
        return response;
      },
    });
    try {
      await waitFor(() => entered);
      now = 400;
      release();
      await waitFor(() => delivered && /expired/i.test(text(root)));
      assert.doesNotMatch(text(root), /account-human/);
      assert.equal(nodes(root).filter((node) => node.tag === 'button').length, 0);
    } finally {
      release?.();
    }
  } finally {
    app.dispose();
    await f.close();
  }
});
