import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresSsoAuditHistoryAccessStore } from '../src/audit/postgres-sso-audit-history.ts';
import type { SsoAuditHistoryAccessEvent } from '../src/gateway/postgres-sso-audit-history.ts';

const event: SsoAuditHistoryAccessEvent = {
  requestId: 'server-1',
  principalId: 'human',
  policyVersions: [{ id: 'p', version: 'v1' }],
  targetPrincipalId: 'human',
  outcome: 'ready',
  count: 2,
};
test('durable audit-history access metadata projects fields and supports anonymous unavailable and cross-principal reads', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(
        new URL('../migrations/014_sso_audit_history_access.sql', import.meta.url),
        'utf8',
      ),
    );
    const store = createPostgresSsoAuditHistoryAccessStore(
      { query: (sql, params) => db.query(sql, [...params]) },
      () => 1000,
    );
    await store.append({ ...event, ...{ token: 'secret', prompt: 'secret' } });
    await store.append({ ...event, targetPrincipalId: 'other' });
    await store.append({
      ...event,
      principalId: null,
      policyVersions: null,
      targetPrincipalId: null,
      outcome: 'unavailable',
      count: 0,
    });
    const rows = (
      await db.query<Record<string, unknown>>(
        'SELECT * FROM sso_audit_history_access_events ORDER BY event_id',
      )
    ).rows;
    assert.equal(rows.length, 3);
    assert.equal(rows[1]?.target_principal_id, 'other');
    assert.equal(rows[2]?.principal_id, null);
    assert.equal(String(rows[0]?.occurred_at_ms), '1000');
    assert.doesNotMatch(JSON.stringify(rows), /secret|token|prompt/u);
    await assert.rejects(
      db.exec(
        "INSERT INTO sso_audit_history_access_events (occurred_at_ms,request_id,outcome,record_count,principal_id,policy_versions,target_principal_id) VALUES (1,'r','forbidden',1,'a','[]','a')",
      ),
    );
  } finally {
    await db.close();
  }
});
test('invalid metadata is rejected before any SQL', async () => {
  let calls = 0;
  const store = createPostgresSsoAuditHistoryAccessStore(
    {
      query: async () => {
        calls++;
        return { rows: [{ event_id: '1' }] };
      },
    },
    () => 1,
  );
  const invalid: readonly unknown[] = [
    null,
    [],
    {},
    { ...event, requestId: '' },
    { ...event, requestId: 'a\nb' },
    { ...event, principalId: '' },
    { ...event, policyVersions: null },
    { ...event, policyVersions: [{ id: 'p', version: '' }] },
    { ...event, count: -1 },
    { ...event, count: 0.5 },
    { ...event, count: Number.MAX_SAFE_INTEGER + 1 },
    { ...event, outcome: 'forbidden' },
    { ...event, outcome: 'audit_unavailable' },
    { ...event, targetPrincipalId: null },
    { ...event, targetPrincipalId: '' },
    { ...event, principalId: null, policyVersions: null },
    { ...event, outcome: 'unauthenticated', count: 0 },
    { ...event, outcome: 'invalid_query', count: 0 },
  ];
  for (const value of invalid)
    await assert.rejects(store.append(value as SsoAuditHistoryAccessEvent), {
      name: 'InvalidSsoAuditHistoryAccessEvent',
    });
  assert.equal(calls, 0);
});
test('SQL, clock and malformed acknowledgements fail closed with fixed errors', async () => {
  for (const rows of [
    [],
    [{}],
    [{ event_id: '0' }],
    [{ event_id: 1 }],
    [{ event_id: '1' }, { event_id: '2' }],
    [{ event_id: '-1' }],
  ]) {
    await assert.rejects(
      createPostgresSsoAuditHistoryAccessStore({ query: async () => ({ rows }) }, () => 1).append(
        event,
      ),
      {
        name: 'SsoAuditHistoryAccessUnavailable',
        message: 'SSO audit-history access store unavailable',
      },
    );
  }
  for (const now of [
    () => -1,
    () => NaN,
    () => Infinity,
    () => 0.1,
    () => {
      throw Error('private clock');
    },
  ]) {
    let queried = false;
    await assert.rejects(
      createPostgresSsoAuditHistoryAccessStore(
        {
          query: async () => {
            queried = true;
            return { rows: [] };
          },
        },
        now,
      ).append(event),
      { name: 'SsoAuditHistoryAccessUnavailable' },
    );
    assert.equal(queried, false);
  }
  await assert.rejects(
    createPostgresSsoAuditHistoryAccessStore(
      {
        query: async () => {
          throw Error('private driver');
        },
      },
      () => 1,
    ).append(event),
    {
      name: 'SsoAuditHistoryAccessUnavailable',
      message: 'SSO audit-history access store unavailable',
    },
  );
});

test('additive migration preserves prior checksums/data and runner is idempotent', async () => {
  const { loadPostgresMigrationSources } = await import(
    '../src/storage/postgres-migration-sources.ts'
  );
  const { applyPostgresMigrations } = await import('../src/storage/postgres-migrations.ts');
  const db = new PGlite();
  const connection = {
    transaction: <T>(
      callback: (
        tx: import('../src/storage/postgres-migrations.ts').MigrationTransaction,
      ) => Promise<T>,
    ) =>
      db.transaction((tx) =>
        callback({
          exec: (sql) => tx.exec(sql),
          query: (sql, params) => tx.query(sql, [...params]),
        }),
      ),
  };
  try {
    const sources = await loadPostgresMigrationSources();
    assert.equal(sources.at(-1)?.version, '014');
    await applyPostgresMigrations(connection, sources.slice(0, -1), () => 100);
    await db.exec("INSERT INTO iam_principals VALUES ('preserved', 'human', true)");
    const before = (
      await db.query('SELECT version, checksum FROM schema_migrations ORDER BY version')
    ).rows;
    assert.deepEqual(await applyPostgresMigrations(connection, sources, () => 200), ['014']);
    assert.deepEqual(await applyPostgresMigrations(connection, sources, () => 300), []);
    const after = (
      await db.query('SELECT version, checksum FROM schema_migrations ORDER BY version')
    ).rows;
    assert.deepEqual(after.slice(0, -1), before);
    assert.equal(
      (await db.query("SELECT * FROM iam_principals WHERE principal_id = 'preserved'")).rows.length,
      1,
    );
    assert.equal((await db.query('SELECT * FROM sso_audit_history_access_events')).rows.length, 0);
  } finally {
    await db.close();
  }
});
