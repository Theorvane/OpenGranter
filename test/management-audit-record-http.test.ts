import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
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
    client,
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

test('audit record details use owned HTTP, fresh IAM and mandatory durable access audit', async () => {
  const f = await fixture(false);
  await f.db.query('INSERT INTO iam_policies VALUES ($1,$2,$3)', [
    'reader',
    'v1',
    JSON.stringify([
      {
        effect: 'Allow',
        actions: ['usage:ReadSelf', 'audit:Read'],
        resources: ['principal:account-human'],
      },
    ]),
  ]);
  await f.db.query('INSERT INTO iam_principal_policies VALUES ($1,$2)', [
    'account-human',
    'reader',
  ]);
  await createPostgresGatewayAuditStore(f.client, () => 100).append({
    kind: 'models-listed',
    principalId: 'account-human',
    requestId: 'historical-request',
    credentialId: 'historical-credential',
    policyVersions: [{ id: 'old-policy', version: 'v7' }],
    count: 2,
  });
  const root = new Element();
  const paths: string[] = [];
  const app = mountSessionManagementOperations(root, () => ({
    save: () => 'started',
    dispose() {},
  }));
  app.authorize({
    expiresAt: Date.now() + 60_000,
    request: (path, init) => {
      paths.push(path);
      return f.request(path, `Bearer ${token}`, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers)),
          authorization: `Bearer ${token}`,
        },
      });
    },
  });
  try {
    await waitFor(() => text(root).includes('No history matches'));
    click(root, 'Audit');
    await waitFor(() => text(root).includes('historical-request'));
    const details = nodes(root).find((node) => node.tag === 'details');
    assert.ok(details);
    assert.match(text(details), /historical-credential/);
    assert.match(text(details), /old-policy.*v7/);
    assert.match(text(details), /"count": 2/);
    assert.equal(paths.filter((path) => path.includes('/audit?')).length, 1);
    await f.db.exec('ALTER TABLE sso_audit_history_access_events RENAME TO paused_history_audit');
    click(root, 'Apply filters');
    assert.doesNotMatch(text(root), /historical-request|old-policy/);
    await waitFor(() => text(root).includes('History unavailable'));
    assert.equal(nodes(root).filter((n) => n.tag === 'details').length, 0);
    await f.db.exec('ALTER TABLE paused_history_audit RENAME TO sso_audit_history_access_events');
    click(root, 'Retry');
    await waitFor(() => text(root).includes('historical-request'));
    click(root, 'Usage');
    assert.doesNotMatch(text(root), /historical-request|old-policy/);
    await waitFor(() => text(root).includes('No history matches'));
    await f.db.exec('UPDATE iam_principals SET active=false');
    const stale = click(root, 'Audit');
    assert.match(text(root), /Loading history/);
    assert.doesNotMatch(text(root), /historical-request|old-policy/);
    await waitFor(() => text(root).includes('Sign-in required'));
    assert.doesNotMatch(
      text(root),
      /historical-request|old-policy|Credential ID|Management operations/,
    );
    const count = paths.length;
    stale.listeners.click?.();
    assert.equal(paths.length, count);
    assert.deepEqual(
      (
        await f.db.query<{ outcome: string }>(
          'SELECT outcome FROM sso_audit_history_access_events ORDER BY event_id',
        )
      ).rows.map((r) => r.outcome),
      ['ready', 'ready', 'unauthenticated'],
    );
  } finally {
    app.dispose();
    await f.close();
  }
});
