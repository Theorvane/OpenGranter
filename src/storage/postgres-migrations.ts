import { createHash } from 'node:crypto';

export interface MigrationSource {
  readonly version: string;
  readonly sql: string;
}

export interface MigrationTransaction {
  readonly exec: (sql: string) => Promise<unknown>;
  readonly query: (
    sql: string,
    params: readonly unknown[],
  ) => Promise<{ readonly rows: readonly unknown[] }>;
}

export interface MigrationConnection {
  readonly transaction: <T>(callback: (tx: MigrationTransaction) => Promise<T>) => Promise<T>;
}

export class InvalidMigrationSet extends Error {
  constructor() {
    super('Invalid migration set');
    this.name = 'InvalidMigrationSet';
  }
}

export class MigrationHistoryMismatch extends Error {
  constructor() {
    super('Migration history mismatch');
    this.name = 'MigrationHistoryMismatch';
  }
}

export class MigrationUnavailable extends Error {
  constructor() {
    super('Migration store unavailable');
    this.name = 'MigrationUnavailable';
  }
}

const CREATE_HISTORY = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  applied_at_ms bigint NOT NULL CHECK (applied_at_ms >= 0)
)`;

function preparedSources(sources: readonly MigrationSource[]) {
  if (sources.length === 0 || sources.length > 999) throw new InvalidMigrationSet();
  return sources.map((source, index) => {
    if (
      typeof source?.version !== 'string' ||
      !/^[0-9]{3}$/u.test(source.version) ||
      Number(source.version) !== index + 1 ||
      typeof source.sql !== 'string' ||
      source.sql.trim().length === 0
    ) {
      throw new InvalidMigrationSet();
    }
    return {
      version: source.version,
      sql: source.sql,
      checksum: createHash('sha256').update(source.sql, 'utf8').digest('hex'),
    };
  });
}

function historyRows(value: readonly unknown[]): { version: string; checksum: string }[] {
  return value.map((row) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw new MigrationHistoryMismatch();
    }
    const item = row as Record<string, unknown>;
    if (
      typeof item.version !== 'string' ||
      typeof item.checksum !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(item.checksum)
    ) {
      throw new MigrationHistoryMismatch();
    }
    return { version: item.version, checksum: item.checksum };
  });
}

/** Apply trusted SQL sources on a dedicated transaction-capable connection. */
export async function applyPostgresMigrations(
  connection: MigrationConnection,
  sources: readonly MigrationSource[],
  now: () => number,
): Promise<string[]> {
  const prepared = preparedSources(sources);
  let history: { version: string; checksum: string }[];
  try {
    history = await connection.transaction(async (tx) => {
      await tx.exec(CREATE_HISTORY);
      const result = await tx.query(
        'SELECT version, checksum FROM schema_migrations ORDER BY version',
        [],
      );
      return historyRows(result.rows);
    });
  } catch (error) {
    if (error instanceof MigrationHistoryMismatch) throw error;
    throw new MigrationUnavailable();
  }
  if (history.length > prepared.length) throw new MigrationHistoryMismatch();
  for (const [index, applied] of history.entries()) {
    const source = prepared[index];
    if (source?.version !== applied.version || source.checksum !== applied.checksum) {
      throw new MigrationHistoryMismatch();
    }
  }

  const appliedVersions: string[] = [];
  for (const source of prepared.slice(history.length)) {
    let appliedAt: number;
    try {
      appliedAt = now();
    } catch {
      throw new MigrationUnavailable();
    }
    if (!Number.isSafeInteger(appliedAt) || appliedAt < 0) throw new MigrationUnavailable();
    try {
      await connection.transaction(async (tx) => {
        await tx.exec(source.sql);
        const result = await tx.query(
          'INSERT INTO schema_migrations (version, checksum, applied_at_ms) VALUES ($1, $2, $3) RETURNING version',
          [source.version, source.checksum, appliedAt],
        );
        if (result.rows.length !== 1) throw new MigrationUnavailable();
      });
    } catch {
      throw new MigrationUnavailable();
    }
    appliedVersions.push(source.version);
  }
  return appliedVersions;
}
