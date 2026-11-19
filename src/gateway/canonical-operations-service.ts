import { isAbsolute } from 'node:path';
import { type OwnedGatewayProcessOptions, runOwnedGatewayProcess } from './gateway-service.ts';
import {
  type PostgresSsoCanonicalOperationsBrowserBootstrapPorts,
  startPostgresSsoCanonicalOperationsBrowserGateway,
  validBrowserArtifactSha256,
} from './postgres-sso-browser-bootstrap.ts';

export type CanonicalOperationsBootstrapPorts = Omit<
  PostgresSsoCanonicalOperationsBrowserBootstrapPorts,
  'host' | 'port' | 'now' | 'newRequestId'
>;
export type CanonicalOperationsServiceOptions = Omit<
  OwnedGatewayProcessOptions<CanonicalOperationsBootstrapPorts>,
  'factoryName' | 'validatePorts' | 'selectPorts' | 'start'
> & {
  readonly start?: (
    ports: PostgresSsoCanonicalOperationsBrowserBootstrapPorts,
  ) => Promise<{ readonly close: () => Promise<void> }>;
};

function isCanonicalOperationsPorts(value: unknown): value is CanonicalOperationsBootstrapPorts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    [
      'openConnection',
      'issuer',
      'audience',
      'jwks',
      'browserArtifactPath',
      'browserArtifactSha256',
    ].every((key) => Object.hasOwn(row, key)) &&
    validBrowserArtifactSha256(row.browserArtifactSha256) &&
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

/** Explicit canonical operations process; no cookie/BFF/session bridge or proxy fallback. */
export async function runCanonicalOperationsService(
  options: CanonicalOperationsServiceOptions,
): Promise<void> {
  return runOwnedGatewayProcess({
    ...options,
    factoryName: 'createCanonicalOperationsPorts',
    validatePorts: isCanonicalOperationsPorts,
    selectPorts: (ports) => {
      const {
        openConnection,
        issuer,
        audience,
        jwks,
        browserArtifactPath,
        browserArtifactSha256,
        migrationDirectory,
      } = ports;
      return {
        openConnection,
        issuer,
        audience,
        jwks,
        browserArtifactPath,
        browserArtifactSha256,
        ...(migrationDirectory === undefined ? {} : { migrationDirectory }),
      };
    },
    start: options.start ?? startPostgresSsoCanonicalOperationsBrowserGateway,
  });
}
