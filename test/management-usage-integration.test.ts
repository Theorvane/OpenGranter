import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { build } from 'esbuild';
import { createPostgresSsoUsageHistoryServer } from '../src/gateway/postgres-sso-usage-history-http.ts';
import { mountManagementUsage, type UsageElement } from '../src/management/usage-app.ts';
import { createManagementUsageClient } from '../src/management/usage-client.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

class Node implements UsageElement {
  textContent: string | null = null;
  value = '';
  children: Node[] = [];
  ownerDocument = { createElement: (_tag: string) => new Node() };
  setAttribute(_name: string, _value: string) {}
  append(...nodes: Node[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Node[]) {
    this.children = nodes;
  }
  listeners: Record<string, () => void> = {};
  addEventListener(type: string, listener: () => void) {
    this.listeners[type] = listener;
  }
  all(): Node[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
  focus() {}
  text(): string {
    return [this.textContent ?? '', ...this.children.map((node) => node.text())].join(' ');
  }
}

const record = buildUsageRecord({
  principalId: 'human',
  credentialId: 'credential',
  policyVersions: [],
  requestId: 'chat',
  attemptId: 'attempt',
  modelAlias: 'chat',
  routeKind: 'managed',
  upstreamModelId: 'model',
  selectedCandidateId: 'candidate',
  occurredAt: 1,
  latencyMs: 2,
  outcome: 'succeeded',
  possiblyBilled: true,
  possibleDuplicate: false,
});

test('usage client through signed SSO, real HTTP, database, fresh IAM and mandatory audit', async () => {
  const db = new PGlite();
  const jwt = await createSsoAccessTokenFixture();
  let token = await jwt.token();
  const sql = { query: (text: string, values: readonly unknown[]) => db.query(text, [...values]) };
  let id = 0;
  const server = createPostgresSsoUsageHistoryServer({
    ...jwt.config,
    client: sql,
    newRequestId: () => `client-${++id}`,
  });
  let client: ReturnType<typeof createManagementUsageClient> | undefined;
  try {
    for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
    // Explicit candidate schema, NOT an installed migration or production DDL.
    await db.exec(
      await readFile(new URL('../contracts/sso-usage-audit-schema.sql', import.meta.url), 'utf8'),
    );
    await db.exec(`INSERT INTO iam_principals VALUES ('human','human',true);
      INSERT INTO iam_policies VALUES ('p','v1','[{"effect":"Allow","actions":["usage:ReadSelf"],"resources":["principal:human"]}]');
      INSERT INTO iam_roles VALUES ('reader'); INSERT INTO iam_principal_roles VALUES ('human','reader');
      INSERT INTO iam_role_policies VALUES ('reader','p');`);
    await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'human',
    ]);
    await createPostgresUsageLedger(sql)(record);
    await createPostgresUsageLedger(sql)({
      ...record,
      modelAlias: 'second-model',
      attemptId: 'second-attempt',
      occurredAt: 3,
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('no address');
    client = createManagementUsageClient((path, init) =>
      fetch(`http://127.0.0.1:${address.port}${path}`, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${token}` },
      }),
    );
    assert.deepEqual(await client.list({ fromMs: 0, toMs: 2, model: 'chat' }), {
      state: 'ready',
      data: { records: [record], hasMore: false, nextCursor: null },
    });
    assert.deepEqual(await client.list({ model: 'absent' }), {
      state: 'ready',
      data: { records: [], hasMore: false, nextCursor: null },
    });
    assert.deepEqual(await client.list({ principalId: 'human' }), { state: 'denied' }); // Even self-explicit needs ReadAll.
    const csv = await client.csv();
    assert.equal(csv.state, 'ready');
    if (csv.state === 'ready') {
      assert.match(csv.data.csv, /attempt/u);
      assert.equal(csv.data.hasMore, false);
    }
    // Actual mounted app -> signed SSO HTTP -> SQL -> awaited audit.
    const appQueries: URLSearchParams[] = [];
    const root = new Node();
    let time = 1;
    let expire: (() => void) | undefined;
    const app = mountManagementUsage(root, {
      now: () => time,
      schedule: (_delay, callback) => {
        expire = callback;
        return () => {};
      },
    });
    try {
      await app.authorize({
        request: (path, init) => {
          appQueries.push(new URL(path, 'http://local').searchParams);
          return fetch(`http://127.0.0.1:${address.port}${path}`, {
            ...init,
            headers: { ...init.headers, authorization: `Bearer ${token}` },
          });
        },
        expiresAt: 2,
      });
      assert.match(root.text(), /human/);
      assert.match(root.text(), /Unknown/);
      assert.match(root.text(), /second-model/);
      const filter = root.all().find((node) => node.textContent === 'Filter usage for model chat');
      assert.ok(filter);
      filter.listeners.click?.();
      assert.match(root.text(), /Loading usage/);
      for (let i = 0; i < 100 && !root.text().includes('Usage records — current page'); i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.match(root.text(), /Usage records — current page/);
      assert.doesNotMatch(root.text(), /second-model/);
      assert.equal(appQueries.length, 2);
      assert.equal(appQueries[1]?.get('model'), 'chat');
      assert.equal(appQueries[1]?.has('principal_id'), false);
      assert.equal(appQueries[1]?.has('cursor'), false);
      const principalFilter = () =>
        root.all().find((node) => node.textContent === 'Filter usage for principal human');
      const selfOnly = principalFilter();
      assert.ok(selfOnly);
      selfOnly.listeners.click?.();
      assert.match(root.text(), /Loading usage/);
      for (let i = 0; i < 100 && !root.text().includes('Access denied'); i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      // Explicit principal selection requires ReadAll even for self. No downgrade.
      assert.match(root.text(), /Access denied/);
      assert.equal(appQueries.length, 3);
      assert.equal(appQueries[2]?.get('principal_id'), 'human');
      assert.equal(appQueries[2]?.get('model'), 'chat');
      const deniedAudits = await db.query<{ outcome: string; record_count: number }>(
        "SELECT outcome, record_count FROM sso_usage_audit_events WHERE outcome = 'forbidden'",
      );
      assert.ok(deniedAudits.rows.some((row) => row.record_count === 0));
      // Test-only policy transition through the real fresh IAM reader.
      await db.query('UPDATE iam_policies SET statements = $1 WHERE policy_id = $2', [
        JSON.stringify([
          {
            effect: 'Allow',
            actions: ['usage:ReadSelf', 'usage:ReadAll'],
            resources: ['principal:human'],
          },
        ]),
        'p',
      ]);
      await app.authorize({
        request: (path, init) => {
          appQueries.push(new URL(path, 'http://local').searchParams);
          return fetch('http://127.0.0.1:' + address.port + path, {
            ...init,
            headers: { ...init.headers, authorization: 'Bearer ' + token },
          });
        },
        expiresAt: 2,
      });
      const allowed = principalFilter();
      assert.ok(allowed);
      allowed.listeners.click?.();
      for (let i = 0; i < 100 && !root.text().includes('Usage records — current page'); i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.match(root.text(), /Usage records — current page/);
      assert.equal(appQueries.length, 5);
      assert.equal(appQueries[4]?.get('principal_id'), 'human');
      assert.equal(appQueries[4]?.has('cursor'), false);
      time = 2;
      expire?.();
      assert.match(root.text(), /Session expired/);
      assert.doesNotMatch(root.text(), /human/);
    } finally {
      app.dispose();
    }
    await db.exec('DELETE FROM iam_role_policies');
    assert.deepEqual(await client.list(), { state: 'denied' });
    token = await jwt.token({ exp: Math.floor(Date.now() / 1000) - 3600 });
    assert.deepEqual(await client.list(), { state: 'unauthenticated' });
    assert.equal(id, 11);
    assert.equal((await db.query('SELECT * FROM sso_usage_audit_events')).rows.length, 11);
    await db.exec('DROP TABLE sso_usage_audit_events');
    assert.deepEqual(await client.list(), { state: 'unavailable' });
  } finally {
    client?.invalidate();
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  }
});

test('bundles and executes in a browser-like runtime without Node Buffer or server dependencies', async () => {
  const bundle = await build({
    entryPoints: ['src/management/usage-client.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'UsageClient',
    write: false,
  });
  const source = bundle.outputFiles[0]?.text;
  assert.ok(source);
  const context = {
    AbortController,
    TextDecoder,
    Uint8Array,
    URLSearchParams,
    setTimeout,
    clearTimeout,
  };
  const api = runInNewContext(`${source}\nUsageClient`, context) as {
    createManagementUsageClient: typeof createManagementUsageClient;
  };
  const client = api.createManagementUsageClient(async () =>
    Response.json({
      object: 'list',
      data: [record],
      has_more: false,
      next_cursor: null,
    }),
  );
  const result = await client.list();
  assert.equal(result.state, 'ready');
  if (result.state === 'ready')
    assert.equal(JSON.stringify(result.data.records), JSON.stringify([record]));
});
