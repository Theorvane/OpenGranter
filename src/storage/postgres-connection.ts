import type { PoolConfig } from 'pg';
import pg from 'pg';
import type { MigrationConnection, MigrationTransaction } from './postgres-migrations.ts';

type QueryResult = { readonly rows: readonly unknown[] };
type Query = (sql: string, params?: unknown[]) => Promise<QueryResult>;

export interface PostgresPoolPort {
  readonly query: Query;
  readonly connect: () => Promise<{
    readonly query: Query;
    readonly release: (discard?: boolean) => void;
    readonly on: (event: 'error', listener: () => void) => unknown;
    readonly removeListener: (event: 'error', listener: () => void) => unknown;
  }>;
  readonly end: () => Promise<void>;
  readonly on: (event: 'error', listener: () => void) => unknown;
}

export interface PostgresConnection extends MigrationConnection {
  readonly query: (sql: string, params: readonly unknown[]) => Promise<QueryResult>;
  readonly close: () => Promise<void>;
}

export class PostgresUnavailable extends Error {
  constructor() {
    super('PostgreSQL connection unavailable');
    this.name = 'PostgresUnavailable';
  }
}

/** Own the supplied pool. Notifications contain no driver error or SQL details. */
export function adaptPostgresPool(
  pool: PostgresPoolPort,
  onUnavailable?: (error: PostgresUnavailable) => void,
): PostgresConnection {
  let closing: Promise<void> | undefined;
  const ensureOpen = () => {
    if (closing) throw new PostgresUnavailable();
  };
  pool.on('error', () => {
    try {
      onUnavailable?.(new PostgresUnavailable());
    } catch {
      // A monitoring callback must not crash the database event listener.
    }
  });
  return {
    async query(sql, params) {
      ensureOpen();
      try {
        return await pool.query(sql, [...params]);
      } catch {
        throw new PostgresUnavailable();
      }
    },
    async transaction<T>(callback: (tx: MigrationTransaction) => Promise<T>): Promise<T> {
      ensureOpen();
      const client = await pool.connect().catch(() => {
        throw new PostgresUnavailable();
      });
      let active = true;
      let began = false;
      let committing = false;
      let discard = false;
      let failedQuery = false;
      let broken = false;
      const onClientError = () => {
        broken = true;
      };
      client.on('error', onClientError);
      const query = async (sql: string, params: readonly unknown[] = []) => {
        if (!active || broken || failedQuery) throw new PostgresUnavailable();
        try {
          return await client.query(sql, [...params]);
        } catch {
          failedQuery = true;
          throw new PostgresUnavailable();
        }
      };
      try {
        await query('BEGIN');
        began = true;
        const result = await callback({ query, exec: (sql) => query(sql) });
        if (broken || failedQuery) throw new PostgresUnavailable();
        active = false;
        committing = true;
        await client.query('COMMIT').catch(() => {
          throw new PostgresUnavailable();
        });
        return result;
      } catch (error) {
        active = false;
        discard = !began || committing || broken;
        if (began) {
          try {
            await client.query('ROLLBACK');
          } catch {
            discard = true;
            throw new PostgresUnavailable();
          }
        }
        throw error;
      } finally {
        active = false;
        client.release(discard || broken);
        client.removeListener('error', onClientError);
      }
    },
    close() {
      closing ??= Promise.resolve()
        .then(() => pool.end())
        .catch(() => {
          throw new PostgresUnavailable();
        });
      return closing;
    },
  };
}

/** Configuration comes from trusted deployment code, never an HTTP caller. */
export function createPostgresConnection(
  config: PoolConfig,
  onUnavailable?: (error: PostgresUnavailable) => void,
): PostgresConnection {
  return adaptPostgresPool(new pg.Pool(config), onUnavailable);
}
