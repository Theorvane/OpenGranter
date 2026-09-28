import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adaptPostgresPool, PostgresUnavailable } from '../src/storage/postgres-connection.ts';
import type { MigrationTransaction } from '../src/storage/postgres-migrations.ts';

function fixture(failOn?: string) {
  const calls: string[] = [];
  const releases: boolean[] = [];
  const poolQueries: string[] = [];
  let idleError: (() => void) | undefined;
  let clientError: (() => void) | undefined;
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push(sql);
    if (sql === failOn) throw new Error('secret password SQL');
    return { rows: [{ value: params[0] ?? 1 }] };
  };
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      poolQueries.push(sql);
      return query(sql, params);
    },
    connect: async () => {
      if (failOn === 'connect') throw new Error('secret password');
      calls.push('connect');
      return {
        query,
        release: (discard?: boolean) => releases.push(discard === true),
        on: (_event: 'error', listener: () => void) => {
          clientError = listener;
        },
        removeListener: (_event: 'error', listener: () => void) => {
          if (clientError === listener) clientError = undefined;
        },
      };
    },
    end: async () => {
      calls.push('end');
      if (failOn === 'end') throw new Error('secret');
    },
    on: (_event: 'error', listener: () => void) => {
      idleError = listener;
    },
  };
  return {
    pool,
    calls,
    releases,
    poolQueries,
    emitError: () => idleError?.(),
    emitClientError: () => clientError?.(),
  };
}

test('query binds parameters and transactions use one dedicated client', async () => {
  const f = fixture();
  const connection = adaptPostgresPool(f.pool);
  assert.deepEqual((await connection.query('SELECT $1', [42])).rows, [{ value: 42 }]);
  let escaped: MigrationTransaction | undefined;
  assert.equal(
    await connection
      .transaction(async (tx) => {
        escaped = tx;
        await tx.exec('CREATE TABLE');
        return (await tx.query('SELECT $1', [7])).rows[0];
      })
      .then((row) => (row as { value: number }).value),
    7,
  );
  assert.deepEqual(f.calls, [
    'SELECT $1',
    'connect',
    'BEGIN',
    'CREATE TABLE',
    'SELECT $1',
    'COMMIT',
  ]);
  assert.deepEqual(f.releases, [false]);
  assert.deepEqual(f.poolQueries, ['SELECT $1']);
  await assert.rejects(escaped?.query('SELECT', []) as Promise<unknown>, PostgresUnavailable);
});

test('application failure rolls back and preserves the callback error', async () => {
  const f = fixture();
  const connection = adaptPostgresPool(f.pool);
  const failure = new Error('domain failure');
  await assert.rejects(
    connection.transaction(async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(f.calls, ['connect', 'BEGIN', 'ROLLBACK']);
  assert.deepEqual(f.releases, [false]);
});

for (const stage of ['connect', 'BEGIN', 'SELECT', 'COMMIT', 'ROLLBACK']) {
  test(`driver failure at ${stage} is safe and releases or discards the connection`, async () => {
    const f = fixture(stage);
    const connection = adaptPostgresPool(f.pool);
    await assert.rejects(
      connection.transaction(async (tx) => {
        if (stage === 'ROLLBACK') throw new Error('domain failure');
        await tx.query('SELECT', []);
      }),
      (error) => error instanceof PostgresUnavailable && !String(error).includes('secret'),
    );
    assert.deepEqual(f.releases, stage === 'connect' ? [] : [stage !== 'SELECT']);
  });
}

test('pool query errors and idle errors reveal only safe errors', async () => {
  const f = fixture('SELECT');
  const notifications: unknown[] = [];
  const connection = adaptPostgresPool(f.pool, (error) => notifications.push(error));
  await assert.rejects(connection.query('SELECT', []), PostgresUnavailable);
  f.emitError();
  assert.ok(notifications[0] instanceof PostgresUnavailable);
  const throwing = adaptPostgresPool(f.pool, () => {
    throw new Error('monitor unavailable');
  });
  f.emitError();
  await throwing.close();
});

test('shutdown is idempotent and blocks further operations', async () => {
  const f = fixture();
  const connection = adaptPostgresPool(f.pool);
  await Promise.all([connection.close(), connection.close()]);
  assert.deepEqual(f.calls, ['end']);
  await assert.rejects(connection.query('SELECT', []), PostgresUnavailable);
  await assert.rejects(
    connection.transaction(async () => 1),
    PostgresUnavailable,
  );
});

test('shutdown failures are safe', async () => {
  const connection = adaptPostgresPool(fixture('end').pool);
  await assert.rejects(connection.close(), PostgresUnavailable);
});

test('a checked-out client error prevents commit and discards the connection', async () => {
  const f = fixture();
  const connection = adaptPostgresPool(f.pool);
  await assert.rejects(
    connection.transaction(async () => {
      f.emitClientError();
      return 1;
    }),
    PostgresUnavailable,
  );
  assert.ok(!f.calls.includes('COMMIT'));
  assert.deepEqual(f.releases, [true]);
});

test('a caught transaction query error still prevents a false successful commit', async () => {
  const f = fixture('SELECT');
  const connection = adaptPostgresPool(f.pool);
  await assert.rejects(
    connection.transaction(async (tx) => {
      await tx.query('SELECT', []).catch(() => undefined);
      return 1;
    }),
    PostgresUnavailable,
  );
  assert.deepEqual(f.calls, ['connect', 'BEGIN', 'SELECT', 'ROLLBACK']);
});
