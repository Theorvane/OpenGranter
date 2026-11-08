import { type OwnedGatewayProcessOptions, runOwnedGatewayProcess } from './gateway-service.ts';
import {
  type PostgresSsoWorkspaceBrowserBootstrapPorts,
  startPostgresSsoWorkspaceBrowserGateway,
} from './postgres-sso-browser-bootstrap.ts';
import { isSsoBrowserPorts } from './sso-browser-service.ts';

export type SsoWorkspaceBootstrapPorts = Omit<
  PostgresSsoWorkspaceBrowserBootstrapPorts,
  'host' | 'port' | 'now' | 'newRequestId'
>;

/** Validate only the explicit trusted workspace factory; absence keeps old routes. */
export function isSsoWorkspacePorts(value: unknown): value is SsoWorkspaceBootstrapPorts {
  if (!isSsoBrowserPorts(value)) return false;
  return (
    !Object.hasOwn(value, 'writeAuditHistoryAccess') ||
    typeof (value as SsoWorkspaceBootstrapPorts).writeAuditHistoryAccess === 'function'
  );
}

export type SsoWorkspaceServiceOptions = Omit<
  OwnedGatewayProcessOptions<SsoWorkspaceBootstrapPorts>,
  'factoryName' | 'validatePorts' | 'start'
> & {
  readonly start?: (
    ports: PostgresSsoWorkspaceBrowserBootstrapPorts,
  ) => Promise<{ readonly close: () => Promise<void> }>;
};

/** Explicit workspace executable only. Never upgrades the browser/proxy process.
 * Caller still owns approved schemas, ingress and identity configuration.
 */
export async function runSsoWorkspaceService(options: SsoWorkspaceServiceOptions): Promise<void> {
  return runOwnedGatewayProcess({
    ...options,
    factoryName: 'createSsoWorkspacePorts',
    validatePorts: isSsoWorkspacePorts,
    start: options.start ?? startPostgresSsoWorkspaceBrowserGateway,
  });
}
