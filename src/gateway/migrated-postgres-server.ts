import type { Server } from 'node:http';
import {
  applyPostgresMigrations,
  type MigrationConnection,
  type MigrationSource,
} from '../storage/postgres-migrations.ts';
import { createNodePostgresDirectChatServer } from './node-postgres-chat-server.ts';
import type { PostgresDirectChatHandlerPorts } from './postgres-direct-chat-handler.ts';

export interface MigratedPostgresServerPorts extends PostgresDirectChatHandlerPorts {
  readonly client: PostgresDirectChatHandlerPorts['client'] & MigrationConnection;
  readonly migrations: readonly MigrationSource[];
}

/** Verify trusted schema sources before composition. Caller owns listening and DB lifecycle. */
export async function createMigratedNodePostgresDirectChatServer(
  ports: MigratedPostgresServerPorts,
): Promise<Server> {
  await applyPostgresMigrations(ports.client, ports.migrations, ports.now);
  const { migrations: _migrations, ...serverPorts } = ports;
  return createNodePostgresDirectChatServer(serverPorts);
}
