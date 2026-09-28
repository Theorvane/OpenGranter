import type { Server } from 'node:http';
import { loadPostgresMigrationSources } from '../storage/postgres-migration-sources.ts';
import {
  createMigratedNodePostgresDirectChatServer,
  type MigratedPostgresServerPorts,
} from './migrated-postgres-server.ts';

export interface BundledPostgresServerPorts
  extends Omit<MigratedPostgresServerPorts, 'migrations'> {
  readonly migrationDirectory?: URL;
}

/** Load trusted bundled SQL before DB activity; caller owns listening and resource lifecycle. */
export async function createBundledNodePostgresDirectChatServer(
  ports: BundledPostgresServerPorts,
): Promise<Server> {
  const { migrationDirectory, ...serverPorts } = ports;
  const migrations = await loadPostgresMigrationSources(migrationDirectory);
  return createMigratedNodePostgresDirectChatServer({ ...serverPorts, migrations });
}
