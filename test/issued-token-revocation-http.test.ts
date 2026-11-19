import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoManagementGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import { createPostgresProxyCredentialStore } from '../src/gateway/postgres-proxy-credentials.ts';
import { createProxyTokenService } from '../src/gateway/proxy-tokens.ts';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountTokenManagementPanel } from '../src/management/token-management-panel.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const accessToken = await jwt.token();
class Element implements CatalogElement {
  textContent: string | null = null;
  value = '';
  attributes: Record<string, string> = {};
  children: Element[] = [];
  listeners: Record<string, () => void> = {};
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
  readonly tag: string;
  constructor(tag = 'div') {
    this.tag = tag;
  }
  setAttribute(key: string, value: string) {
    this.attributes[key] = value;
  }
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
    this.textContent = null;
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners[type] = listener;
  }
  focus() {}
}
const nodes = (root: Element): Element[] => [root, ...root.children.flatMap(nodes)];
const text = (root: Element) =>
  nodes(root)
    .map((n) => n.textContent ?? '')
    .join(' ');
function click(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
  return node;
}
function enter(root: Element, label: string, value: string) {
  const input = nodes(root).find((n) => n.tag === 'label' && n.textContent === label)?.children[0];
  assert.ok(input, label);
  input.value = value;
}

async function waitFor(check: () => boolean) {
  const until = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < until, 'Token UI did not settle');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
for (const outcome of ['success', 'deny', 'audit-outage', 'inactive'] as const) {
  test(`issued token handoff through owned HTTP + embedded PostgreSQL: ${outcome}`, async () => {
    const db = new PGlite();
    const client: PostgresConnection = {
      query: (sql, params) => db.query(sql, [...params]),
      transaction: (callback) =>
        db.transaction((tx) =>
          callback({
            exec: (sql) => tx.exec(sql),
            query: (sql, params) => tx.query(sql, [...params]),
          }),
        ),
      close: () => db.close(),
    };
    let sequence = 0;
    const runtime = await startPostgresSsoManagementGateway({
      ...jwt.config,
      host: '127.0.0.1',
      port: 0,
      openConnection: () => client,
      newRequestId: () => `handoff-${++sequence}`,
    });
    await db.exec(
      "INSERT INTO iam_principals VALUES ('human-admin','human',true),('human-owner','human',true)",
    );
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'human-admin',
    ]);
    await db.query('INSERT INTO iam_policies VALUES ($1,$2,$3)', [
      'manage',
      'v1',
      JSON.stringify([
        { effect: 'Allow', actions: ['iam:Manage'], resources: ['principal:human-owner'] },
      ]),
    ]);
    await db.query('INSERT INTO iam_principal_policies VALUES ($1,$2)', ['human-admin', 'manage']);
    const root = new Element();
    const calls: string[] = [];
    const panel = mountTokenManagementPanel(root, (path, init) => {
      calls.push(path);
      return fetch(`http://127.0.0.1:${runtime.address.port}${path}`, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers)),
          authorization: `Bearer ${accessToken}`,
        },
      });
    });
    try {
      enter(root, 'Principal ID', 'human-owner');
      enter(root, 'Expiry (Unix milliseconds, integer)', String(jwt.config.now() + 86400000));
      click(root, 'Review issuance');
      click(root, 'Confirm issuance');
      await waitFor(() => text(root).includes('Token issued.'));
      const pre = nodes(root).filter((n) => n.tag === 'pre');
      const credentialId = pre[0]?.textContent;
      const issuedToken = pre[1]?.textContent;
      assert.ok(credentialId);
      assert.ok(issuedToken);
      const tokens = createProxyTokenService({
        store: createPostgresProxyCredentialStore(client),
        now: jwt.config.now,
      });
      assert.equal((await tokens.verifyCredential(issuedToken))?.principalId, 'human-owner');
      const rows = await db.query<{ token_digest: string }>(
        'SELECT credential_id,token_digest,revoked_at_ms FROM proxy_credentials',
      );
      assert.equal(rows.rows.length, 1);
      assert.notEqual(rows.rows[0]?.token_digest, issuedToken);
      const handoff = click(root, 'Review issued token revocation');
      assert.equal(calls.length, 1);
      assert.equal(pre[1]?.textContent, '');
      assert.match(text(root), new RegExp(credentialId));
      if (outcome === 'deny')
        await db.query('UPDATE iam_policies SET version=$1,statements=$2', [
          'v2',
          JSON.stringify([{ effect: 'Deny', actions: ['iam:Manage'], resources: ['*'] }]),
        ]);
      if (outcome === 'audit-outage')
        await db.exec('ALTER TABLE token_management_decisions RENAME TO paused_decisions');
      if (outcome === 'inactive')
        await db.exec("UPDATE iam_principals SET active=false WHERE principal_id='human-admin'");
      const confirm = click(root, 'Confirm revocation');
      await waitFor(() => !text(root).includes('Revocation in progress'));
      assert.equal(calls.length, 2);
      assert.doesNotMatch(text(root), /paused_decisions|INSERT|private|Postgres/);
      if (outcome === 'success') {
        assert.match(text(root), /Token revocation confirmed/);
        assert.equal(await tokens.verifyCredential(issuedToken), undefined);
        assert.deepEqual(
          (await db.query('SELECT action FROM proxy_credential_events ORDER BY event_id')).rows,
          [{ action: 'issued' }, { action: 'revoked' }],
        );
      } else {
        assert.doesNotMatch(text(root), /Token revocation confirmed/);
        assert.match(
          text(root),
          outcome === 'deny'
            ? /Access denied/
            : outcome === 'inactive'
              ? /Sign-in required/
              : /outcome is unknown/,
        );
        assert.ok(await tokens.verifyCredential(issuedToken));
        assert.deepEqual((await db.query('SELECT action FROM proxy_credential_events')).rows, [
          { action: 'issued' },
        ]);
      }
      const auditTable =
        outcome === 'audit-outage' ? 'paused_decisions' : 'token_management_decisions';
      const audits = await db.query(
        `SELECT operation,outcome FROM ${auditTable} ORDER BY event_id`,
      );
      assert.deepEqual(audits.rows, [
        { operation: 'issue', outcome: 'allowed' },
        ...(outcome === 'success'
          ? [{ operation: 'revoke', outcome: 'allowed' }]
          : outcome === 'deny'
            ? [{ operation: 'revoke', outcome: 'denied' }]
            : []),
      ]);
      panel.dispose();
      handoff.listeners.click?.();
      confirm.listeners.click?.();
      assert.equal(text(root), '');
      assert.equal(calls.length, 2);
    } finally {
      panel.dispose();
      await runtime.close();
    }
  });
}
