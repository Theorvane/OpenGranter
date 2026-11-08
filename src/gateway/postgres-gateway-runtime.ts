import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createManagementBrowserHandler } from '../management/browser-http.ts';
import type { PostgresConnection } from '../storage/postgres-connection.ts';
import { loadPostgresMigrationSources } from '../storage/postgres-migration-sources.ts';
import { applyPostgresMigrations } from '../storage/postgres-migrations.ts';
import type { BundledPostgresServerPorts } from './bundled-postgres-server.ts';
import { createClientErrorResponse } from './client-errors.ts';
import { createNodePostgresDirectChatServer } from './node-postgres-chat-server.ts';
import { createNodePostgresDualRouteChatServer } from './node-postgres-dual-chat-server.ts';
import { createNodeRequestServer } from './node-request-server.ts';
import type { PostgresDualRouteChatHandlerPorts } from './postgres-dual-chat-handler.ts';
import {
  createPostgresSsoAdministrationBrowserServer,
  type PostgresSsoAdministrationBrowserPorts,
} from './postgres-sso-administration-browser-http.ts';
import {
  createPostgresRfc9068SsoManagementHandler,
  type createPostgresRfc9068SsoManagementServer,
} from './postgres-sso-management-http.ts';
import { createPostgresSsoModelCatalogHandler } from './postgres-sso-model-catalog-http.ts';

interface GatewayRuntimeInfrastructure {
  readonly host: string;
  readonly port: number;
  readonly now: () => number;
  readonly openConnection: () => PostgresConnection | Promise<PostgresConnection>;
  readonly migrationDirectory?: URL;
}

export interface PostgresGatewayRuntimePorts
  extends Omit<BundledPostgresServerPorts, 'client'>,
    GatewayRuntimeInfrastructure {}

export interface PostgresDualRouteGatewayRuntimePorts
  extends Omit<PostgresDualRouteChatHandlerPorts, 'client'>,
    GatewayRuntimeInfrastructure {}

export interface PostgresSsoManagementRuntimePorts
  extends Omit<Parameters<typeof createPostgresRfc9068SsoManagementServer>[0], 'client'>,
    GatewayRuntimeInfrastructure {
  /** Explicit trusted PUBLIC bundle; absent means no browser routes. Never a session grant. */
  readonly browserJavascript?: string;
}

/** Only this explicit workspace can opt in to the audit history route. */
export interface PostgresSsoWorkspaceRuntimePorts extends PostgresSsoManagementRuntimePorts {
  readonly browserJavascript: string;
  readonly writeAuditHistoryAccess?: NonNullable<
    PostgresSsoAdministrationBrowserPorts['writeAuditHistoryAccess']
  >;
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

/** Shared private ownership boundary; public wrappers choose the trusted server composition. */
async function startOwnedPostgresGateway(
  ports: GatewayRuntimeInfrastructure,
  buildServer: (client: PostgresConnection) => Promise<Server>,
): Promise<{
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
    const { openConnection, host, port, migrationDirectory } = ports;
    const migrations = await loadPostgresMigrationSources(migrationDirectory);
    connection = await openConnection();
    await applyPostgresMigrations(connection, migrations, ports.now);
    server = await buildServer(connection);
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

/** Own a migrated direct gateway with optional custom delegated ports. */
export async function startPostgresGateway(ports: PostgresGatewayRuntimePorts) {
  const {
    openConnection: _open,
    host: _host,
    port: _port,
    migrationDirectory: _directory,
    ...gatewayPorts
  } = ports;
  return startOwnedPostgresGateway(ports, (client) =>
    createNodePostgresDirectChatServer({ ...gatewayPorts, client }),
  );
}

/** Own a migrated gateway with persisted direct and OpenRouter adapters. */
export async function startPostgresDualRouteGateway(ports: PostgresDualRouteGatewayRuntimePorts) {
  const {
    openConnection: _open,
    host: _host,
    port: _port,
    migrationDirectory: _directory,
    ...gatewayPorts
  } = ports;
  return startOwnedPostgresGateway(ports, (client) =>
    createNodePostgresDualRouteChatServer({ ...gatewayPorts, client }),
  );
}

/** Explicitly own a migrated, separate SSO proxy-token management listener. */
export async function startPostgresSsoManagementGateway(ports: PostgresSsoManagementRuntimePorts) {
  const { browserJavascript } = ports;
  if (
    browserJavascript !== undefined &&
    (typeof browserJavascript !== 'string' || browserJavascript.length === 0)
  ) {
    throw new InvalidGatewayRuntimeInput();
  }
  const {
    openConnection: _open,
    host: _host,
    port: _port,
    migrationDirectory: _directory,
    browserJavascript: _browser,
    ...managementPorts
  } = ports;
  return startOwnedPostgresGateway(ports, async (client) => {
    const tokens = createPostgresRfc9068SsoManagementHandler({ ...managementPorts, client });
    const catalog = createPostgresSsoModelCatalogHandler({ ...managementPorts, client });
    const application = (request: Request) => {
      const path = new URL(request.url).pathname;
      return path === '/management/v1/models' || path.startsWith('/management/v1/models/')
        ? catalog(request)
        : tokens(request);
    };
    const handler =
      browserJavascript === undefined
        ? application
        : createManagementBrowserHandler({ javascript: browserJavascript, application });
    // Preserve the SSO management adapter contract even when Fetch construction fails.
    return createNodeRequestServer(handler, () => {
      const response = createClientErrorResponse(503, 'internal_error');
      response.headers.set('cache-control', 'no-store');
      return response;
    });
  });
}

/** Explicit source-only workspace listener; never selected by existing startup.
 * Reuses the owned autocommit connection for mandatory identity/usage audit.
 * Candidate audit schemas remain caller-reviewed/installed, NOT migrations.
 * Missing schema fails closed. No session, cookie bridge or new IAM grant.
 */
export async function startPostgresSsoWorkspaceGateway(ports: PostgresSsoWorkspaceRuntimePorts) {
  if (
    typeof ports.browserJavascript !== 'string' ||
    !ports.browserJavascript.trim() ||
    (Object.hasOwn(ports, 'writeAuditHistoryAccess') &&
      typeof ports.writeAuditHistoryAccess !== 'function')
  ) {
    throw new InvalidGatewayRuntimeInput();
  }
  const {
    browserJavascript,
    openConnection: _open,
    host: _host,
    port: _port,
    migrationDirectory: _directory,
    ...managementPorts
  } = ports;
  return startOwnedPostgresGateway(ports, async (client) =>
    createPostgresSsoAdministrationBrowserServer({
      ...managementPorts,
      client,
      principalAuditClient: client,
      javascript: browserJavascript,
    }),
  );
}
