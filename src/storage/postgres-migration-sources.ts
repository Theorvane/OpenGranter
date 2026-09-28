import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MigrationSource } from './postgres-migrations.ts';

// Update this manifest whenever a migration is added; deployment must ship every listed file.
const migrationFiles = [
  '001_usage_records.sql',
  '002_proxy_credentials.sql',
  '003_gateway_audit.sql',
  '004_iam_snapshots.sql',
  '005_model_catalog.sql',
  '006_optional_managed_jev.sql',
  '007_direct_provider_registrations.sql',
  '008_token_management_decisions.sql',
] as const;

export class MigrationSourceUnavailable extends Error {
  constructor() {
    super('Migration sources unavailable');
    this.name = 'MigrationSourceUnavailable';
  }
}

/** Load a complete trusted deployment bundle, preserving SQL bytes used for checksums. */
export async function loadPostgresMigrationSources(
  directory: URL = new URL('../../migrations/', import.meta.url),
): Promise<readonly MigrationSource[]> {
  try {
    const path = fileURLToPath(directory);
    const entries = (await readdir(path, { withFileTypes: true }))
      .filter((entry) => /\.sql$/iu.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    if (
      entries.length !== migrationFiles.length ||
      entries.some((entry, index) => entry.name !== migrationFiles[index] || !entry.isFile())
    ) {
      throw new MigrationSourceUnavailable();
    }
    const sources: MigrationSource[] = [];
    for (const name of migrationFiles) {
      const sql = await readFile(join(path, name), 'utf8');
      if (sql.trim().length === 0) throw new MigrationSourceUnavailable();
      sources.push({ version: name.slice(0, 3), sql });
    }
    return sources;
  } catch {
    throw new MigrationSourceUnavailable();
  }
}
