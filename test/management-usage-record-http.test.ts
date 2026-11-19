import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresSsoManagementGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountSessionManagementOperations } from '../src/management/operations-session.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const jwt = await createSsoAccessTokenFixture();
const token = await jwt.token();
async function fixture() {
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
    close: async () => {
      closes++;
      await db.close();
    },
    query: (sql, params) => db.query(sql, [...params]),
  };
  const runtime = await startPostgresSsoManagementGateway({
    ...jwt.config,
    host: '127.0.0.1',
    port: 0,
    openConnection: () => client,
    newRequestId: () => 'usage-detail-read',
  });
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
    request(path: string, authorization = `Bearer ${token}`, init: RequestInit = {}) {
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
    assert.ok(Date.now() < deadline, 'Usage UI did not settle');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function click(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
  return node;
}

for (const status of [401, 403] as const)
  test(`usage details: owned HTTP, durable audit, principal isolation and fresh ${status}`, async () => {
    const f = await fixture();
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
    await createPostgresUsageLedger(f.client)(
      buildUsageRecord({
        principalId: 'account-human',
        credentialId: 'historical-credential',
        policyVersions: [{ id: 'old-policy', version: 'v7' }],
        requestId: 'historical-request',
        attemptId: 'historical-attempt',
        occurredAt: 100,
        modelAlias: 'chat',
        routeKind: 'managed',
        upstreamModelId: 'upstream',
        selectedCandidateId: 'candidate',
        actualInferenceProviderId: 'provider',
        latencyMs: 23,
        outcome: 'succeeded',
        possiblyBilled: true,
        possibleDuplicate: true,
        providerUsage: { prompt_tokens: 0, completion_tokens: 2, total_tokens: 2 },
        estimatedCost: {
          amountDecimal: '0.100000000000000001',
          currency: 'USD',
          priceVersion: 'historical-v9',
        },
        upstreamBilledCost: {
          amountDecimal: '0.100000000000000002',
          currency: 'USD',
          source: 'direct-provider',
        },
      }),
    );
    await createPostgresUsageLedger(f.client)(
      buildUsageRecord({
        principalId: 'other-principal',
        credentialId: 'other-private-credential',
        policyVersions: [{ id: 'other-private-policy', version: 'v99' }],
        requestId: 'other-private-request',
        attemptId: 'other-private-attempt',
        occurredAt: 100,
        modelAlias: 'chat',
        routeKind: 'managed',
        upstreamModelId: 'upstream',
        selectedCandidateId: 'candidate',
        latencyMs: 1,
        outcome: 'succeeded',
        possiblyBilled: false,
        possibleDuplicate: false,
        providerUsage: {},
      }),
    );
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
      await waitFor(() => text(root).includes('historical-request'));
      const details = nodes(root).find((node) => node.tag === 'details');
      assert.ok(details);
      assert.equal(nodes(root).filter((n) => n.tag === 'details').length, 1);
      assert.doesNotMatch(text(root), /other-private/);
      assert.match(text(details), /historical-credential/);
      assert.match(text(details), /old-policy.*v7/);
      assert.match(text(details), /historical-attempt/);
      assert.match(text(details), /historical-v9/);
      assert.match(text(details), /0.000000000000000001/);
      assert.equal(paths.filter((path) => path.includes('/usage?')).length, 1);
      await f.db.exec('ALTER TABLE sso_usage_audit_events RENAME TO paused_history_audit');
      click(root, 'Apply filters');
      assert.doesNotMatch(text(root), /historical-request|old-policy/);
      await waitFor(() => text(root).includes('History unavailable'));
      assert.equal(nodes(root).filter((n) => n.tag === 'details').length, 0);
      await f.db.exec('ALTER TABLE paused_history_audit RENAME TO sso_usage_audit_events');
      click(root, 'Retry');
      await waitFor(() => text(root).includes('historical-request'));
      if (status === 401) await f.db.exec('UPDATE iam_principals SET active=false');
      else
        await f.db.query('UPDATE iam_policies SET statements=$1 WHERE policy_id=$2', [
          JSON.stringify([
            { effect: 'Deny', actions: ['usage:ReadSelf'], resources: ['principal:account-human'] },
          ]),
          'reader',
        ]);
      const stale = click(root, 'Apply filters');
      await waitFor(() =>
        text(root).includes(status === 401 ? 'Sign-in required' : 'Access denied'),
      );
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
            'SELECT outcome FROM sso_usage_audit_events ORDER BY event_id',
          )
        ).rows.map((r) => r.outcome),
        ['ready', 'ready', status === 401 ? 'unauthenticated' : 'forbidden'],
      );
    } finally {
      app.dispose();
      await f.close();
    }
  });
