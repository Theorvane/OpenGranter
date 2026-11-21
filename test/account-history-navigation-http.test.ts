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
function click(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
}
async function until(check: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(check(), 'owned HTTP response settled');
}
for (const outcome of ['ready', 'fresh-deny', 'audit-failure'] as const) {
  test(`Account to scoped history over owned signed-JWT HTTP: ${outcome}`, async () => {
    const db = new PGlite();
    let closes = 0;
    const client: PostgresConnection = {
      transaction: (callback) =>
        db.transaction((tx) =>
          callback({
            exec: (sql) => tx.exec(sql),
            query: (sql, params) => tx.query(sql, [...params]),
          }),
        ),
      query: (sql, params) => db.query(sql, [...params]),
      close: async () => {
        closes++;
        await db.close();
      },
    };
    const runtime = await startPostgresSsoManagementGateway({
      ...jwt.config,
      host: '127.0.0.1',
      port: 0,
      openConnection: () => client,
      newRequestId: () => 'history-read',
    });
    const root = new Element();
    let ui: { dispose(): void } | undefined;
    const statuses: { path: string; status: number }[] = [];
    try {
      await db.exec(
        await readFile(
          new URL('../contracts/sql/current-principal-audit.sql', import.meta.url),
          'utf8',
        ),
      );
      await db.exec(`INSERT INTO iam_principals VALUES ('account-human','human',true);
        INSERT INTO iam_policies VALUES ('reader','v1','[{"effect":"Allow","actions":["usage:ReadSelf","usage:ReadAll","audit:Read"],"resources":["principal:account-human"]}]');
        INSERT INTO iam_principal_policies VALUES ('account-human','reader');`);
      await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
        jwt.issuer,
        jwt.subject,
        'account-human',
      ]);
      ui = mountManagementOperations(
        root,
        async (path, init) => {
          const headers = new Headers(init.headers);
          headers.set('authorization', `Bearer ${token}`);
          const response = await fetch(`http://127.0.0.1:${runtime.address.port}${path}`, {
            ...init,
            headers,
          });
          statuses.push({ path, status: response.status });
          return response;
        },
        () => ({ save: () => 'started', dispose() {} }),
      );
      await until(() => text(root).includes('No history matches'));
      click(root, 'Account');
      await until(() => text(root).includes('View history for this account'));
      if (outcome === 'fresh-deny')
        await db.exec(
          `UPDATE iam_policies SET version='v2', statements='[{"effect":"Allow","actions":["usage:ReadSelf"],"resources":["principal:account-human"]},{"effect":"Deny","actions":["usage:ReadAll"],"resources":["principal:account-human"]}]'`,
        );
      if (outcome === 'audit-failure') await db.exec('DROP TABLE sso_usage_audit_events');
      click(root, 'View history for this account');
      await until(
        () =>
          statuses.some((row) => row.path.includes('principal_id=')) &&
          !text(root).includes('Loading history'),
      );
      const target = statuses.find((row) => row.path.includes('principal_id='));
      assert.ok(target);
      assert.equal(
        target?.status,
        outcome === 'ready' ? 200 : outcome === 'fresh-deny' ? 403 : 503,
      );
      assert.equal(
        new URL(target.path, 'https://local.invalid').searchParams.get('principal_id'),
        'account-human',
      );
      assert.doesNotMatch(text(root), /SELECT|INSERT|sso_usage|postgres/i);
      if (outcome === 'ready') {
        assert.match(text(root), /No history matches/);
        click(root, 'Audit');
        await until(
          () =>
            statuses.some((row) => row.path.startsWith('/management/v1/audit')) &&
            !text(root).includes('Loading history'),
        );
        assert.equal(statuses.at(-1)?.status, 200);
        const audit = await db.query<{ mode: string; target_principal_id: string }>(
          'SELECT mode, target_principal_id FROM sso_usage_audit_events ORDER BY event_id',
        );
        assert.equal(audit.rows.at(-1)?.mode, 'all');
        assert.equal(audit.rows.at(-1)?.target_principal_id, 'account-human');
        assert.equal(
          (await db.query('SELECT * FROM sso_audit_history_access_events')).rows.length,
          1,
        );
      } else
        assert.match(
          text(root),
          outcome === 'fresh-deny' ? /Access denied/ : /History unavailable/,
        );
    } finally {
      ui?.dispose();
      await runtime.close();
      assert.equal(closes, 1);
    }
  });
}
