import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  applyPostgresMigrations,
  type MigrationTransaction,
} from '../src/storage/postgres-migrations.ts';

const names = [
  '001_usage_records.sql',
  '002_proxy_credentials.sql',
  '003_gateway_audit.sql',
  '004_iam_snapshots.sql',
  '005_model_catalog.sql',
];
const migrations = await Promise.all(
  names.map(async (name) => ({
    version: name.slice(0, 3),
    sql: await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'),
  })),
);
const [firstMigration, secondMigration, thirdMigration] = migrations;
assert.ok(firstMigration && secondMigration && thirdMigration);

function connection(db: PGlite) {
  return {
    transaction: <T>(
      callback: (tx: {
        exec: (sql: string) => Promise<unknown>;
        query: (sql: string, params: readonly unknown[]) => Promise<{ rows: readonly unknown[] }>;
      }) => Promise<T>,
    ) =>
      db.transaction((tx) =>
        callback({
          exec: (sql) => tx.exec(sql),
          query: (sql, params) => tx.query(sql, [...params]),
        }),
      ),
  };
}

test('apply all migration files once and retain matching checksums', async () => {
  const db = new PGlite();
  try {
    const first = await applyPostgresMigrations(connection(db), migrations, () => 1_000);
    assert.deepEqual(first, ['001', '002', '003', '004', '005']);
    const second = await applyPostgresMigrations(connection(db), migrations, () => 2_000);
    assert.deepEqual(second, []);
    const result = await db.query<{ version: string; checksum: string; applied_at_ms: string }>(
      'SELECT version, checksum, applied_at_ms::text AS applied_at_ms FROM schema_migrations ORDER BY version',
    );
    assert.deepEqual(
      result.rows.map((row) => row.version),
      ['001', '002', '003', '004', '005'],
    );
    assert.equal(
      result.rows.every((row) => /^[a-f0-9]{64}$/u.test(row.checksum)),
      true,
    );
    assert.equal(
      result.rows.every((row) => row.applied_at_ms === '1000'),
      true,
    );
  } finally {
    await db.close();
  }
});

test('changed or missing historical sources stop before later migrations', async () => {
  const db = new PGlite();
  try {
    await applyPostgresMigrations(connection(db), migrations.slice(0, 2), () => 1_000);
    await assert.rejects(
      applyPostgresMigrations(
        connection(db),
        [
          firstMigration,
          { ...secondMigration, sql: `${secondMigration.sql}\n-- edited` },
          thirdMigration,
        ],
        () => 2_000,
      ),
      { name: 'MigrationHistoryMismatch', message: 'Migration history mismatch' },
    );
    await assert.rejects(
      applyPostgresMigrations(connection(db), migrations.slice(0, 1), () => 2_000),
      { name: 'MigrationHistoryMismatch', message: 'Migration history mismatch' },
    );
    const rows = await db.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    assert.deepEqual(
      rows.rows.map((row) => row.version),
      ['001', '002'],
    );
  } finally {
    await db.close();
  }
});

test('duplicate, skipped, and out-of-order versions reject before SQL', async () => {
  const calls: string[] = [];
  const connectionPort = {
    transaction: async <T>(_callback: (tx: MigrationTransaction) => Promise<T>): Promise<T> => {
      calls.push('transaction');
      throw new Error('unexpected call');
    },
  };
  for (const sources of [
    [firstMigration, firstMigration],
    [secondMigration],
    [secondMigration, firstMigration],
  ]) {
    await assert.rejects(
      applyPostgresMigrations(connectionPort, sources, () => 1_000),
      { name: 'InvalidMigrationSet', message: 'Invalid migration set' },
    );
  }
  assert.deepEqual(calls, []);
});

test('failing migration rolls back schema and history together', async () => {
  const db = new PGlite();
  try {
    await applyPostgresMigrations(connection(db), migrations.slice(0, 1), () => 1_000);
    const broken = {
      version: '002',
      sql: 'CREATE TABLE transient_migration (id int); SELECT 1 / 0;',
    };
    await assert.rejects(
      applyPostgresMigrations(connection(db), [firstMigration, broken], () => 2_000),
      { name: 'MigrationUnavailable', message: 'Migration store unavailable' },
    );
    const history = await db.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    assert.deepEqual(
      history.rows.map((row) => row.version),
      ['001'],
    );
    const table = await db.query<{ name: string | null }>(
      "SELECT to_regclass('transient_migration')::text AS name",
    );
    assert.equal(table.rows[0]?.name, null);
  } finally {
    await db.close();
  }
});

test('database failure is safe and does not expose driver detail', async () => {
  const failing = {
    transaction: async <T>(_callback: (tx: MigrationTransaction) => Promise<T>): Promise<T> => {
      throw new Error('private SQL detail');
    },
  };
  await assert.rejects(
    applyPostgresMigrations(failing, migrations, () => 1_000),
    { name: 'MigrationUnavailable', message: 'Migration store unavailable' },
  );
});
