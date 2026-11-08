import { isAbsolute } from 'node:path';
import { type OwnedGatewayProcessOptions, runOwnedGatewayProcess } from './gateway-service.ts';
import {
  type PostgresSsoBrowserBootstrapPorts,
  startPostgresSsoBrowserGateway,
} from './postgres-sso-browser-bootstrap.ts';

export type SsoBrowserBootstrapPorts = Omit<
  PostgresSsoBrowserBootstrapPorts,
  'host' | 'port' | 'now' | 'newRequestId'
>;
export type SsoBrowserServiceOptions = Omit<
  OwnedGatewayProcessOptions<SsoBrowserBootstrapPorts>,
  'factoryName' | 'validatePorts' | 'start'
> & {
  readonly start?: (
    ports: PostgresSsoBrowserBootstrapPorts,
  ) => Promise<{ readonly close: () => Promise<void> }>;
};

export function isSsoBrowserPorts(value: unknown): value is SsoBrowserBootstrapPorts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    ['openConnection', 'issuer', 'audience', 'jwks', 'browserArtifactPath'].every((key) =>
      Object.hasOwn(row, key),
    ) &&
    typeof row.openConnection === 'function' &&
    typeof row.issuer === 'string' &&
    row.issuer.length > 0 &&
    typeof row.audience === 'string' &&
    row.audience.length > 0 &&
    row.jwks !== null &&
    typeof row.jwks === 'object' &&
    !Array.isArray(row.jwks) &&
    typeof row.browserArtifactPath === 'string' &&
    isAbsolute(row.browserArtifactPath) &&
    !row.browserArtifactPath.includes('\0')
  );
}

/** Explicit separate process; no cookie/BFF/session bridge or proxy fallback. */
export async function runSsoBrowserService(options: SsoBrowserServiceOptions): Promise<void> {
  return runOwnedGatewayProcess({
    ...options,
    factoryName: 'createSsoBrowserPorts',
    validatePorts: isSsoBrowserPorts,
    start: options.start ?? startPostgresSsoBrowserGateway,
  });
}
