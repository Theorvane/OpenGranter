import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';
import { startPostgresSsoCanonicalOperationsGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { Element, nodes, text } from './account-token-dom-fixture.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

function click(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
}
async function until(check: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(check(), 'owned HTTP response settled');
}
for (const outcome of ['ready', 'fresh-deny', 'audit-failure'] as const) {
  test(`Usage-to-Audit request investigation over canonical owned signed-JWT HTTP: ${outcome}`, async () => {
    const jwt = await createSsoAccessTokenFixture();
    const token = await jwt.token();
    const db = new PGlite();
    let closes = 0;
    const client: PostgresConnection = {
      query: (sql, params) => db.query(sql, [...params]),
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
    };
    const runtime = await startPostgresSsoCanonicalOperationsGateway({
      ...jwt.config,
      host: '127.0.0.1',
      port: 0,
      newRequestId: () => 'investigation-read',
      openConnection: () => client,
    });
    const root = new Element();
    let ui: { dispose(): void } | undefined;
    let savedCsv: string | undefined;
    const statuses: { path: string; status: number }[] = [];
    try {
      await db.exec(`INSERT INTO iam_principals VALUES ('human','human',true);
        INSERT INTO iam_policies VALUES ('reader','v1','[{"effect":"Allow","actions":["usage:ReadSelf","audit:Read"],"resources":["principal:human"]}]');
        INSERT INTO iam_principal_policies VALUES ('human','reader');`);
      await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
        jwt.issuer,
        jwt.subject,
        'human',
      ]);
      const audit = createPostgresGatewayAuditStore(client, () => 100);
      for (const [requestId, principalId, credentialId] of [
        ['historical', 'human', 'visible-credential'],
        ['different', 'human', 'hidden-request-credential'],
        ['historical', 'other', 'hidden-principal-credential'],
      ] as const)
        await audit.append({
          kind: 'models-listed',
          principalId,
          requestId,
          credentialId,
          policyVersions: [],
          count: 1,
        });
      const write = createPostgresUsageLedger(client);
      for (const [attemptId, requestId, principalId] of [
        ['visible-attempt', 'historical', 'human'],
        ['other-request', 'different', 'human'],
        ['other-principal', 'historical', 'other'],
      ] as const)
        await write(
          buildUsageRecord({
            principalId,
            credentialId: 'old',
            policyVersions: [],
            requestId,
            attemptId,
            occurredAt: 100,
            modelAlias: 'chat',
            routeKind: 'managed',
            upstreamModelId: 'up',
            selectedCandidateId: 'c',
            latencyMs: 1,
            outcome: 'succeeded',
            possiblyBilled: true,
            possibleDuplicate: true,
          }),
        );
      ui = mountHistoryWorkspace(
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
        {
          save: (kind, csv) => {
            assert.equal(kind, 'audit');
            savedCsv = csv;
            return 'started';
          },
          dispose() {},
        },
      );
      await until(() => text(root).includes('records shown'));
      await until(() => nodes(root).some((n) => n.textContent === 'View audit for this request'));
      if (outcome === 'fresh-deny')
        await db.exec(
          `UPDATE iam_policies SET version='v2', statements='[{"effect":"Allow","actions":["usage:ReadSelf"],"resources":["principal:human"]},{"effect":"Deny","actions":["audit:Read"],"resources":["principal:human"]}]'`,
        );
      if (outcome === 'audit-failure') await db.exec('DROP TABLE sso_audit_history_access_events');
      click(root, 'View audit for this request');
      await until(
        () =>
          statuses.some((s) => s.path.includes('request_id=')) &&
          !text(root).includes('Loading history'),
      );
      const result = statuses.find((s) => s.path.includes('request_id='));
      assert.ok(result);
      assert.equal(result.status, outcome === 'ready' ? 200 : outcome === 'fresh-deny' ? 403 : 503);
      const q = new URL(result.path, 'https://local.invalid').searchParams;
      assert.equal(q.get('request_id'), 'historical');
      assert.equal(q.has('principal_id'), false);
      if (outcome === 'ready') {
        assert.match(text(root), /visible-credential/);
        assert.doesNotMatch(text(root), /hidden-request-credential|hidden-principal-credential/);
        const rows = await db.query<{ target_principal_id: string; outcome: string }>(
          'SELECT target_principal_id, outcome FROM sso_audit_history_access_events ORDER BY event_id',
        );
        assert.equal(rows.rows.at(-1)?.target_principal_id, 'human');
        assert.equal(rows.rows.at(-1)?.outcome, 'ready');
        assert.equal((await db.query('SELECT * FROM sso_usage_audit_events')).rows.length, 1);
        click(root, 'Download current page CSV');
        await until(() => savedCsv !== undefined);
        assert.match(savedCsv ?? '', /visible-credential/);
        assert.doesNotMatch(
          savedCsv ?? '',
          /hidden-request-credential|hidden-principal-credential/,
        );
        const exportQuery = new URL(statuses.at(-1)?.path ?? '', 'https://local.invalid')
          .searchParams;
        assert.equal(exportQuery.get('request_id'), 'historical');
        assert.equal(exportQuery.get('format'), 'csv');
        assert.equal(exportQuery.has('principal_id'), false);
      } else
        assert.match(
          text(root),
          outcome === 'fresh-deny' ? /Access denied/ : /History unavailable/,
        );
      assert.doesNotMatch(text(root), /SELECT \*|INSERT INTO|sso_usage|postgres/i);
    } finally {
      ui?.dispose();
      await runtime.close();
      assert.equal(closes, 1);
    }
  });
}
