import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoManagementGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import { mountManagementOperations } from '../src/management/operations-app.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { Element, nodes, text } from './account-token-dom-fixture.ts';
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

function click(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
  return node;
}
function input(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'label' && n.textContent === label)?.children[0];
  assert.ok(node, label);
  return node;
}
async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(check(), 'owned HTTP response completed');
}
for (const outcome of ['issued', 'denied', 'audit-failure'] as const) {
  test(`owned HTTP Account to confirmed token issuance: ${outcome}`, async () => {
    const f = await fixture();
    const root = new Element();
    const paths: string[] = [];
    const statuses: number[] = [];
    const ui = mountManagementOperations(
      root,
      async (path, init) => {
        paths.push(path);
        const headers = new Headers(init.headers);
        headers.set('authorization', `Bearer ${token}`);
        const response = await f.request(path, `Bearer ${token}`, { ...init, headers });
        if (init.method === 'POST') statuses.push(response.status);
        return response;
      },
      () => ({ save: () => 'started', dispose() {} }),
    );
    try {
      await f.db.exec(
        `INSERT INTO iam_policies VALUES ('manage','v1','[{"effect":"Allow","actions":["iam:Manage"],"resources":["principal:account-human"]}]'); INSERT INTO iam_principal_policies VALUES ('account-human','manage');`,
      );
      // The history request may fail without optional history audit tables. Account is independent.
      await until(() => !text(root).includes('Loading usage'));
      click(root, 'Account');
      await until(() => text(root).includes('Prepare token for this account'));
      const before = paths.length;
      const detached = click(root, 'Prepare token for this account');
      assert.equal(paths.length, before);
      assert.equal(input(root, 'Principal ID').value, 'account-human');
      input(root, 'Expiry (Unix milliseconds, integer)').value = String(
        jwt.config.now() + 86400000,
      );
      click(root, 'Review issuance');
      assert.equal(paths.length, before);
      if (outcome === 'denied')
        await f.db.exec(
          `UPDATE iam_policies SET version='v2',statements='[{"effect":"Deny","actions":["iam:Manage"],"resources":["*"]}]'`,
        );
      if (outcome === 'audit-failure') await f.db.exec('DROP TABLE token_management_decisions');
      click(root, 'Confirm issuance');
      await until(() => !text(root).includes('Issuance in progress'));
      assert.deepEqual(statuses, [outcome === 'issued' ? 201 : outcome === 'denied' ? 403 : 503]);
      const count = (
        await f.db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM proxy_credentials')
      ).rows[0]?.count;
      assert.equal(count, outcome === 'issued' ? 1 : 0);
      if (outcome === 'issued') assert.match(text(root), /Token issued/);
      else assert.doesNotMatch(text(root), /Token issued|Bearer token \(secret\)/);
      detached.listeners.click?.();
      assert.equal(statuses.length, 1);
      ui.dispose();
      assert.equal(text(root), '');
    } finally {
      ui.dispose();
      await f.close();
    }
  });
}
