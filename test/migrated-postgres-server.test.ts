import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createMigratedNodePostgresDirectChatServer } from '../src/gateway/migrated-postgres-server.ts';
import type { MigrationSource } from '../src/storage/postgres-migrations.ts';

const directory = new URL('../migrations/', import.meta.url);
const sources = await Promise.all(
  (await readdir(directory)).sort().map(async (name) => ({
    version: name.slice(0, 3),
    sql: await readFile(new URL(name, directory), 'utf8'),
  })),
);

function fixture() {
  const db = new PGlite();
  let configurationReads = 0;
  let clockCalls = 0;
  let upstreamCalls = 0;
  let configurationFails = false;
  const client = {
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
    query: async (sql: string, params: readonly unknown[]) => {
      if (sql.includes('direct_provider_registrations')) {
        configurationReads++;
        // A registration read must only occur after every migration has committed.
        const history = await db.query<{ version: string }>(
          'SELECT version FROM schema_migrations ORDER BY version',
        );
        assert.deepEqual(
          history.rows.map((row) => row.version),
          sources.map((source) => source.version),
        );
        if (configurationFails) throw new Error('private-driver-detail');
      }
      return db.query(sql, [...params]);
    },
  };
  const ports = {
    client,
    migrations: sources,
    now: () => {
      clockCalls++;
      return 1000;
    },
    newRequestId: () => 'startup-request',
    checkLimit: async () => true,
    resolveSecret: async () => {
      upstreamCalls++;
      return undefined;
    },
    fetcher: async () => {
      upstreamCalls++;
      throw new Error('unexpected upstream');
    },
  };
  return {
    db,
    ports,
    counts: () => ({ configurationReads, clockCalls, upstreamCalls }),
    failConfiguration: () => {
      configurationFails = true;
    },
  };
}

test('startup commits all migrations before configuration, returns an unbound server, and enforces authentication', async () => {
  const { db, ports, counts } = fixture();
  try {
    const server = await createMigratedNodePostgresDirectChatServer(ports);
    assert.equal(server.listening, false);
    assert.deepEqual(counts(), {
      configurationReads: 1,
      clockCalls: sources.length,
      upstreamCalls: 0,
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/models`,
      );
      assert.equal(response.status, 401);
      await response.text();
      assert.deepEqual(
        (await db.query('SELECT kind, principal_id, credential_id FROM gateway_audit_events')).rows,
        [{ kind: 'auth-denied', principal_id: null, credential_id: null }],
      );
      assert.equal(counts().upstreamCalls, 0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    assert.equal((await db.query('SELECT * FROM schema_migrations')).rows.length, sources.length);
  } finally {
    await db.close();
  }
});

test('sequential reconstruction verifies history and skips every unchanged migration', async () => {
  const { db, ports, counts } = fixture();
  try {
    await createMigratedNodePostgresDirectChatServer(ports);
    const first = counts();
    const second = await createMigratedNodePostgresDirectChatServer(ports);
    assert.equal(second.listening, false);
    assert.deepEqual(counts(), { ...first, configurationReads: 2 });
  } finally {
    await db.close();
  }
});

test('edited or missing historical sources prevent further configuration reads', async () => {
  const { db, ports, counts } = fixture();
  try {
    await createMigratedNodePostgresDirectChatServer(ports);
    const first = counts();
    for (const migrations of [
      sources.slice(0, -1),
      sources.map((source, index) =>
        index === 0 ? { ...source, sql: `${source.sql}\n-- changed` } : source,
      ),
    ]) {
      await assert.rejects(createMigratedNodePostgresDirectChatServer({ ...ports, migrations }), {
        name: 'MigrationHistoryMismatch',
        message: 'Migration history mismatch',
      });
    }
    assert.deepEqual(counts(), first);
  } finally {
    await db.close();
  }
});

test('invalid sources stop before any configuration or clock call', async () => {
  const { db, ports, counts } = fixture();
  try {
    await assert.rejects(createMigratedNodePostgresDirectChatServer({ ...ports, migrations: [] }), {
      name: 'InvalidMigrationSet',
    });
    assert.deepEqual(counts(), { configurationReads: 0, clockCalls: 0, upstreamCalls: 0 });
    assert.equal(
      (await db.query<{ name: string | null }>("SELECT to_regclass('schema_migrations') AS name"))
        .rows[0]?.name,
      null,
    );
  } finally {
    await db.close();
  }
});

test('failed migration stops startup, rolls back its changes, and retains earlier commits', async () => {
  const { db, ports, counts } = fixture();
  try {
    const first = sources[0];
    assert.ok(first);
    const migrations: readonly MigrationSource[] = [
      first,
      { version: '002', sql: 'CREATE TABLE transient_startup (id int); SELECT 1 / 0;' },
    ];
    await assert.rejects(createMigratedNodePostgresDirectChatServer({ ...ports, migrations }), {
      name: 'MigrationUnavailable',
      message: 'Migration store unavailable',
    });
    assert.deepEqual((await db.query('SELECT version FROM schema_migrations')).rows, [
      { version: '001' },
    ]);
    assert.equal(
      (await db.query<{ name: string | null }>("SELECT to_regclass('transient_startup') AS name"))
        .rows[0]?.name,
      null,
    );
    assert.equal(counts().configurationReads, 0);
    assert.equal(counts().upstreamCalls, 0);
  } finally {
    await db.close();
  }
});

test('configuration failure exposes a safe error and leaves caller-owned database and migration history intact', async () => {
  const { db, ports, counts, failConfiguration } = fixture();
  try {
    failConfiguration();
    await assert.rejects(createMigratedNodePostgresDirectChatServer(ports), (error: unknown) => {
      assert.equal((error as Error).name, 'DirectProviderStoreUnavailable');
      assert.equal((error as Error).cause, undefined);
      assert.equal(String(error).includes('private'), false);
      return true;
    });
    assert.equal((await db.query('SELECT * FROM schema_migrations')).rows.length, sources.length);
    assert.equal(counts().upstreamCalls, 0);
  } finally {
    await db.close();
  }
});
