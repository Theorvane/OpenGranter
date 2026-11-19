import { isAbsolute } from 'node:path';
import { type OwnedGatewayProcessOptions, runOwnedGatewayProcess } from './gateway-service.ts';
import {
  type PostgresSsoCanonicalReviewBrowserBootstrapPorts,
  startPostgresSsoCanonicalReviewBrowserGateway,
  validBrowserArtifactSha256,
} from './postgres-sso-browser-bootstrap.ts';

export type CanonicalReviewBootstrapPorts = Omit<
  PostgresSsoCanonicalReviewBrowserBootstrapPorts,
  'host' | 'port' | 'now' | 'newRequestId'
>;
export type CanonicalReviewServiceOptions = Omit<
  OwnedGatewayProcessOptions<CanonicalReviewBootstrapPorts>,
  'factoryName' | 'validatePorts' | 'start'
> & {
  readonly start?: (
    ports: PostgresSsoCanonicalReviewBrowserBootstrapPorts,
  ) => Promise<{ readonly close: () => Promise<void> }>;
};

function isCanonicalReviewPorts(value: unknown): value is CanonicalReviewBootstrapPorts {
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

/** Explicit canonical read-only process; no cookie/BFF/session bridge or proxy fallback. */
export async function runCanonicalReviewService(
  options: CanonicalReviewServiceOptions,
): Promise<void> {
  return runOwnedGatewayProcess({
    ...options,
    factoryName: 'createCanonicalReviewPorts',
    validatePorts: isCanonicalReviewPorts,
    start: options.start ?? startPostgresSsoCanonicalReviewBrowserGateway,
  });
}
