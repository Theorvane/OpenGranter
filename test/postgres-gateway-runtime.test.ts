import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { PGlite } from '@electric-sql/pglite';
import { startPostgresGateway } from '../src/gateway/postgres-gateway-runtime.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';

const startupError = { name: 'GatewayStartupUnavailable', message: 'Gateway startup unavailable' };
const shutdownError = {
  name: 'GatewayShutdownUnavailable',
  message: 'Gateway shutdown unavailable',
};

function fixture() {
  const db = new PGlite();
  let opens = 0;
  let closes = 0;
  let externalCalls = 0;
  let auditGate: (() => Promise<void>) | undefined;
  const connection: PostgresConnection = {
    query: async (sql, params) => {
      if (sql.includes('INSERT INTO gateway_audit_events')) await auditGate?.();
      return db.query(sql, [...params]);
    },
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
  const ports = {
    host: '127.0.0.1',
    port: 0,
    openConnection: () => {
      opens++;
      return connection;
    },
    now: () => 1000,
    newRequestId: () => 'runtime-request',
    checkLimit: async () => true,
    resolveSecret: async () => {
      externalCalls++;
      return undefined;
    },
    fetcher: async () => {
      externalCalls++;
      throw new Error('unexpected provider');
    },
  };
  return {
    db,
    ports,
    connection,
    counts: () => ({ opens, closes, externalCalls }),
    gateAudit: (gate: () => Promise<void>) => {
      auditGate = gate;
    },
  };
}

test('runtime starts a migrated socket and shares one shutdown promise', async () => {
  const { db, ports, counts } = fixture();
  const runtime = await startPostgresGateway(ports);
  const url = `http://127.0.0.1:${runtime.address.port}/v1/models`;
  try {
    assert.equal(runtime.address.address, '127.0.0.1');
    assert.ok(runtime.address.port > 0);
    const response = await fetch(url);
    assert.equal(response.status, 401);
    await response.text();
    assert.deepEqual((await db.query('SELECT kind FROM gateway_audit_events')).rows, [
      { kind: 'auth-denied' },
    ]);
    assert.deepEqual(counts(), { opens: 1, closes: 0, externalCalls: 0 });
  } finally {
    const close = runtime.close();
    assert.equal(runtime.close(), close);
    await close;
    assert.equal(runtime.close(), close);
  }
  assert.equal(counts().closes, 1);
  await assert.rejects(fetch(url));
});

test('shutdown waits for an active audit write before closing the database', {
  timeout: 15_000,
}, async () => {
  const { ports, counts, gateAudit } = fixture();
  const runtime = await startPostgresGateway(ports);
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  gateAudit(async () => {
    entered();
    await gate;
  });
  const response = fetch(`http://127.0.0.1:${runtime.address.port}/v1/models`);
  try {
    await started;
    const closing = runtime.close();
    await nextTurn();
    assert.equal(counts().closes, 0);
    release();
    const result = await response;
    assert.equal(result.status, 401);
    await result.text();
    await closing;
    assert.equal(counts().closes, 1);
  } finally {
    release();
    await runtime.close();
  }
});

test('invalid bind input and source loading failure occur before connection opening', async () => {
  const { db, ports, counts } = fixture();
  try {
    for (const input of [
      { host: '' },
      { host: 'bad host' },
      { port: -1 },
      { port: 65536 },
      { port: 0.5 },
    ]) {
      await assert.rejects(startPostgresGateway({ ...ports, ...input }), {
        name: 'InvalidGatewayRuntimeInput',
        message: 'Invalid gateway runtime input',
      });
    }
    await assert.rejects(
      startPostgresGateway({
        ...ports,
        migrationDirectory: new URL('https://invalid.example/private-bundle'),
      }),
      startupError,
    );
    assert.deepEqual(counts(), { opens: 0, closes: 0, externalCalls: 0 });
  } finally {
    await db.close();
  }
});

test('connection opening failures expose no driver details or causes', async () => {
  const { db, ports } = fixture();
  try {
    await assert.rejects(
      startPostgresGateway({
        ...ports,
        openConnection: () => {
          throw new Error('private-connection-detail');
        },
      }),
      (error: unknown) => {
        assert.equal((error as Error).name, startupError.name);
        assert.equal((error as Error).message, startupError.message);
        assert.equal((error as Error).cause, undefined);
        return true;
      },
    );
  } finally {
    await db.close();
  }
});

test('migration failure closes the opened connection without external calls', async () => {
  const { ports, connection, counts } = fixture();
  await assert.rejects(
    startPostgresGateway({
      ...ports,
      openConnection: () => ({
        ...connection,
        transaction: async () => {
          throw new Error('private-sql-detail');
        },
      }),
    }),
    startupError,
  );
  assert.equal(counts().closes, 1);
  assert.equal(counts().externalCalls, 0);
});

test('an occupied bind port closes the opened database on startup failure', async () => {
  const blocker = createServer();
  await new Promise<void>((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(0, '127.0.0.1', resolve);
  });
  const { ports, counts } = fixture();
  try {
    await assert.rejects(
      startPostgresGateway({ ...ports, port: (blocker.address() as AddressInfo).port }),
      startupError,
    );
    assert.deepEqual(counts(), { opens: 1, closes: 1, externalCalls: 0 });
  } finally {
    await new Promise<void>((resolve, reject) =>
      blocker.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('database shutdown failure is safe, shared, and not automatically retried', async () => {
  const { ports, connection } = fixture();
  let attempts = 0;
  const runtime = await startPostgresGateway({
    ...ports,
    openConnection: () => ({
      ...connection,
      close: async () => {
        attempts++;
        await connection.close();
        throw new Error('private-close-detail');
      },
    }),
  });
  const closing = runtime.close();
  assert.equal(runtime.close(), closing);
  await assert.rejects(closing, (error: unknown) => {
    assert.equal((error as Error).name, shutdownError.name);
    assert.equal((error as Error).message, shutdownError.message);
    assert.equal((error as Error).cause, undefined);
    return true;
  });
  assert.equal(runtime.close(), closing);
  assert.equal(attempts, 1);
});

test('failed startup cleanup does not replace the safe startup error with a driver error', async () => {
  const { ports, connection } = fixture();
  let attempts = 0;
  await assert.rejects(
    startPostgresGateway({
      ...ports,
      openConnection: () => ({
        ...connection,
        transaction: async () => {
          throw new Error('private-startup-detail');
        },
        close: async () => {
          attempts++;
          await connection.close();
          throw new Error('private-cleanup-detail');
        },
      }),
    }),
    startupError,
  );
  assert.equal(attempts, 1);
});
