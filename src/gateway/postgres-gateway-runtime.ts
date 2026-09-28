import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PostgresConnection } from '../storage/postgres-connection.ts';
import { loadPostgresMigrationSources } from '../storage/postgres-migration-sources.ts';
import type { BundledPostgresServerPorts } from './bundled-postgres-server.ts';
import { createMigratedNodePostgresDirectChatServer } from './migrated-postgres-server.ts';

export interface PostgresGatewayRuntimePorts extends Omit<BundledPostgresServerPorts, 'client'> {
  readonly host: string;
  readonly port: number;
  readonly openConnection: () => PostgresConnection | Promise<PostgresConnection>;
}

export class InvalidGatewayRuntimeInput extends Error {
  constructor() {
    super('Invalid gateway runtime input');
    this.name = 'InvalidGatewayRuntimeInput';
  }
}

export class GatewayStartupUnavailable extends Error {
  constructor() {
    super('Gateway startup unavailable');
    this.name = 'GatewayStartupUnavailable';
  }
}

export class GatewayShutdownUnavailable extends Error {
  constructor() {
    super('Gateway shutdown unavailable');
    this.name = 'GatewayShutdownUnavailable';
  }
}

async function closeResources(server: Server | undefined, connection: PostgresConnection) {
  let failed = false;
  try {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  } catch {
    failed = true;
  }
  try {
    await connection.close();
  } catch {
    failed = true;
  }
  if (failed) throw new GatewayShutdownUnavailable();
}

/** Own the opened connection and HTTP listener. Deployment supplies trusted infrastructure ports. */
export async function startPostgresGateway(ports: PostgresGatewayRuntimePorts): Promise<{
  readonly address: Readonly<AddressInfo>;
  readonly close: () => Promise<void>;
}> {
  if (
    typeof ports.host !== 'string' ||
    ports.host.length === 0 ||
    ports.host.length > 253 ||
    /\s/u.test(ports.host) ||
    ports.host.includes('\0') ||
    !Number.isInteger(ports.port) ||
    ports.port < 0 ||
    ports.port > 65535
  ) {
    throw new InvalidGatewayRuntimeInput();
  }
  let connection: PostgresConnection | undefined;
  let server: Server | undefined;
  try {
    const { openConnection, host, port, migrationDirectory, ...gatewayPorts } = ports;
    const migrations = await loadPostgresMigrationSources(migrationDirectory);
    connection = await openConnection();
    server = await createMigratedNodePostgresDirectChatServer({
      ...gatewayPorts,
      client: connection,
      migrations,
    });
    const listeningServer = server;
    await new Promise<void>((resolve, reject) => {
      const onError = () => {
        listeningServer.removeListener('listening', onListening);
        reject(new GatewayStartupUnavailable());
      };
      const onListening = () => {
        listeningServer.removeListener('error', onError);
        resolve();
      };
      listeningServer.once('error', onError);
      listeningServer.once('listening', onListening);
      listeningServer.listen(port, host);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new GatewayStartupUnavailable();
    const ownedConnection = connection;
    let closing: Promise<void> | undefined;
    return {
      address: { ...address },
      close() {
        closing ??= closeResources(listeningServer, ownedConnection);
        return closing;
      },
    };
  } catch {
    if (connection !== undefined) {
      try {
        await closeResources(server, connection);
      } catch {
        /* Cleanup attempted; expose no infrastructure detail. */
      }
    }
    throw new GatewayStartupUnavailable();
  }
}
