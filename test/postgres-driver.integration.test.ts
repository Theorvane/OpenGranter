import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  createPostgresConnection,
  PostgresUnavailable,
} from '../src/storage/postgres-connection.ts';
import { applyPostgresMigrations } from '../src/storage/postgres-migrations.ts';

const connectionString = process.env.OPENGRANTER_TEST_DATABASE_URL;

test('real PostgreSQL migrations, binding, rollback, and shutdown', {
  skip: !connectionString,
}, async () => {
  // Use only an isolated disposable database: migrations change its schema.
  const schema = `opengranter_test_${randomUUID().replaceAll('-', '')}`;
  const admin = createPostgresConnection({ connectionString, connectionTimeoutMillis: 3000 });
  const connection = createPostgresConnection({
    connectionString,
    connectionTimeoutMillis: 3000,
    options: `-c search_path=${schema}`,
  });
  try {
    await admin.query(`CREATE SCHEMA ${schema}`, []);
    const directory = new URL('../migrations/', import.meta.url);
    const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
    const sources = await Promise.all(
      names.map(async (name) => ({
        version: name.slice(0, 3),
        sql: await readFile(new URL(name, directory), 'utf8'),
      })),
    );
    assert.deepEqual(
      await applyPostgresMigrations(connection, sources, () => 1),
      sources.map((source) => source.version),
    );
    assert.deepEqual(await applyPostgresMigrations(connection, sources, () => 2), []);
    const value = "literal'; DROP TABLE schema_migrations; --";
    assert.deepEqual((await connection.query('SELECT $1::text AS value', [value])).rows, [
      { value },
    ]);
    const failure = new Error('application failure');
    await assert.rejects(
      connection.transaction(async (tx) => {
        await tx.exec('CREATE TABLE rollback_probe (id integer)');
        throw failure;
      }),
      (error) => error === failure,
    );
    assert.deepEqual(
      (await connection.query("SELECT to_regclass('rollback_probe') AS value", [])).rows,
      [{ value: null }],
    );
    await assert.rejects(connection.query('SELECT missing_column', []), PostgresUnavailable);
    assert.deepEqual((await connection.query('SELECT 1 AS value', [])).rows, [{ value: 1 }]);
  } finally {
    try {
      await connection.close();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`, []);
    } finally {
      await admin.close();
    }
  }
  await assert.rejects(connection.query('SELECT 1', []), PostgresUnavailable);
});
