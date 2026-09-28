import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createBundledNodePostgresDirectChatServer } from '../src/gateway/bundled-postgres-server.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import type { MigrationTransaction } from '../src/storage/postgres-migrations.ts';

test('bundled factory migrates a fresh DB before registrations and verifies unchanged restart', async () => {
  const db = new PGlite();
  const sources = await loadPostgresMigrationSources();
  let registrationReads = 0;
  let clockCalls = 0;
  let providerCalls = 0;
  try {
    const ports = {
      client: {
        transaction: <T>(callback: (tx: MigrationTransaction) => Promise<T>) =>
          db.transaction((tx) =>
            callback({
              exec: (sql) => tx.exec(sql),
              query: (sql, params) => tx.query(sql, [...params]),
            }),
          ),
        query: async (sql: string, params: readonly unknown[]) => {
          registrationReads++;
          assert.ok(sql.includes('direct_provider_registrations'));
          assert.deepEqual(
            (
              await db.query<{ version: string }>(
                'SELECT version FROM schema_migrations ORDER BY version',
              )
            ).rows.map((row) => row.version),
            sources.map((source) => source.version),
          );
          return db.query(sql, [...params]);
        },
      },
      now: () => {
        clockCalls++;
        return 1000;
      },
      newRequestId: () => 'bundled-request',
      checkLimit: async () => true,
      resolveSecret: async () => {
        providerCalls++;
        return undefined;
      },
      fetcher: async () => {
        providerCalls++;
        throw new Error('unexpected provider');
      },
    };
    const first = await createBundledNodePostgresDirectChatServer(ports);
    assert.equal(first.listening, false);
    assert.equal(clockCalls, sources.length);
    const second = await createBundledNodePostgresDirectChatServer(ports);
    assert.equal(second.listening, false);
    assert.equal(clockCalls, sources.length);
    assert.equal(registrationReads, 2);
    assert.equal(providerCalls, 0);
  } finally {
    await db.close();
  }
});

test('invalid deployment bundle prevents all DB, clock, secret, and provider activity', async () => {
  let calls = 0;
  await assert.rejects(
    createBundledNodePostgresDirectChatServer({
      migrationDirectory: new URL('https://invalid.example/private-bundle'),
      client: {
        transaction: async <T>(_callback: (tx: MigrationTransaction) => Promise<T>): Promise<T> => {
          calls++;
          throw new Error('unexpected DB');
        },
        query: async () => {
          calls++;
          throw new Error('unexpected DB');
        },
      },
      now: () => {
        calls++;
        return 1000;
      },
      newRequestId: () => 'request',
      checkLimit: async () => true,
      resolveSecret: async () => {
        calls++;
        return undefined;
      },
      fetcher: async () => {
        calls++;
        throw new Error('unexpected provider');
      },
    }),
    { name: 'MigrationSourceUnavailable', message: 'Migration sources unavailable' },
  );
  assert.equal(calls, 0);
});
