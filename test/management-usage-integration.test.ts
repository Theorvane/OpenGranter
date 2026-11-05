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
  addEventListener(_type: string, _listener: () => void) {}
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
        request: (path, init) =>
          fetch(`http://127.0.0.1:${address.port}${path}`, {
            ...init,
            headers: { ...init.headers, authorization: `Bearer ${token}` },
          }),
        expiresAt: 2,
      });
      assert.match(root.text(), /human/);
      assert.match(root.text(), /Unknown/);
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
    assert.equal(id, 7);
    assert.equal((await db.query('SELECT * FROM sso_usage_audit_events')).rows.length, 7);
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
