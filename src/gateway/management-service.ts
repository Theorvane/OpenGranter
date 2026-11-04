import {
  type ConfiguredGatewayServiceOptions,
  runConfiguredGatewayService,
} from './gateway-service.ts';
import {
  type PostgresSsoManagementRuntimePorts,
  startPostgresSsoManagementGateway,
} from './postgres-gateway-runtime.ts';

export type ManagementBootstrapPorts = Omit<
  PostgresSsoManagementRuntimePorts,
  'host' | 'port' | 'now' | 'newRequestId'
>;
type ManagementServiceOptions = Omit<
  ConfiguredGatewayServiceOptions<ManagementBootstrapPorts>,
  'factoryName' | 'isBootstrapPorts' | 'start'
> & {
  readonly start?: ConfiguredGatewayServiceOptions<ManagementBootstrapPorts>['start'];
};

function isManagementBootstrap(value: unknown): value is ManagementBootstrapPorts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.openConnection === 'function' &&
    typeof input.issuer === 'string' &&
    input.issuer.length > 0 &&
    typeof input.audience === 'string' &&
    input.audience.length > 0 &&
    typeof input.jwks === 'object' &&
    input.jwks !== null &&
    !Array.isArray(input.jwks)
  );
}

/** Explicit separate management process; never auto-started by inference. */
export function runManagementService(options: ManagementServiceOptions): Promise<void> {
  const env = options.env;
  return runConfiguredGatewayService({
    ...options,
    env: {
      OPENGRANTER_BOOTSTRAP_MODULE: env.OPENGRANTER_MANAGEMENT_BOOTSTRAP_MODULE,
      OPENGRANTER_HOST: env.OPENGRANTER_MANAGEMENT_HOST,
      OPENGRANTER_PORT: env.OPENGRANTER_MANAGEMENT_PORT ?? '8081',
      OPENGRANTER_SHUTDOWN_MS: env.OPENGRANTER_MANAGEMENT_SHUTDOWN_MS,
    },
    factoryName: 'createManagementPorts',
    isBootstrapPorts: isManagementBootstrap,
    start: options.start ?? startPostgresSsoManagementGateway,
  });
}
