import { type OwnedGatewayProcessOptions, runOwnedGatewayProcess } from './gateway-service.ts';
import {
  type PostgresSsoBrowserBootstrapPorts,
  startPostgresSsoWorkspaceBrowserGateway,
} from './postgres-sso-browser-bootstrap.ts';
import { isSsoBrowserPorts, type SsoBrowserBootstrapPorts } from './sso-browser-service.ts';

export type SsoWorkspaceServiceOptions = Omit<
  OwnedGatewayProcessOptions<SsoBrowserBootstrapPorts>,
  'factoryName' | 'validatePorts' | 'start'
> & {
  readonly start?: (
    ports: PostgresSsoBrowserBootstrapPorts,
  ) => Promise<{ readonly close: () => Promise<void> }>;
};

/** Explicit workspace executable only. Never upgrades the browser/proxy process.
 * Caller still owns approved schemas, ingress and identity configuration.
 */
export async function runSsoWorkspaceService(options: SsoWorkspaceServiceOptions): Promise<void> {
  return runOwnedGatewayProcess({
    ...options,
    factoryName: 'createSsoWorkspacePorts',
    validatePorts: isSsoBrowserPorts,
    start: options.start ?? startPostgresSsoWorkspaceBrowserGateway,
  });
}
