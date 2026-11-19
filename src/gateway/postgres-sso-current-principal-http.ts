import type { Server } from 'node:http';
import { createPostgresCurrentPrincipalAuditStore } from '../audit/postgres-current-principal.ts';
import type { GatewayAuditSqlClient } from '../audit/postgres-gateway-audit.ts';
import { createPostgresSsoHumanAuthenticator } from '../identity/postgres-sso-human-authentication.ts';
import {
  createRfc9068SsoAccessTokenVerifier,
  InvalidSsoAccessTokenConfiguration,
  type SsoAccessTokenConfiguration,
} from '../identity/rfc9068-sso-access-tokens.ts';
import {
  createSsoCurrentPrincipalHandler,
  createSsoCurrentPrincipalServer,
  type SsoCurrentPrincipalHttpPorts,
} from './sso-current-principal-http.ts';

export interface PostgresSsoCurrentPrincipalHttpPorts extends SsoAccessTokenConfiguration {
  /** Caller-owned committed/autocommit SQL; dedicated audit contract must be installed explicitly. */
  readonly client: GatewayAuditSqlClient;
  readonly newRequestId: () => string;
}
function compose(ports: PostgresSsoCurrentPrincipalHttpPorts): SsoCurrentPrincipalHttpPorts {
  try {
    if (
      typeof ports !== 'object' ||
      ports === null ||
      Array.isArray(ports) ||
      ['client', 'now', 'issuer', 'audience', 'jwks', 'newRequestId'].some(
        (field) => !Object.hasOwn(ports, field),
      ) ||
      Object.hasOwn(ports, 'writeAudit') ||
      Object.hasOwn(ports, 'auditClient')
    )
      throw new InvalidSsoAccessTokenConfiguration();
    const { client, now, issuer, audience, jwks, newRequestId } = ports;
    if (typeof newRequestId !== 'function') throw new InvalidSsoAccessTokenConfiguration();
    const verifyAccessToken = createRfc9068SsoAccessTokenVerifier({ now, issuer, audience, jwks });
    const authenticate = createPostgresSsoHumanAuthenticator({ client, verifyAccessToken });
    const audit = createPostgresCurrentPrincipalAuditStore(client, now);
    return { authenticate, writeAudit: audit.append, newRequestId };
  } catch {
    throw new InvalidSsoAccessTokenConfiguration();
  }
}

/** Fresh identity plus mandatory durable audit. No cookie, IAM grant, DDL or activation. */
export function createPostgresRfc9068SsoCurrentPrincipalHandler(
  ports: PostgresSsoCurrentPrincipalHttpPorts,
): (request: Request) => Promise<Response> {
  return createSsoCurrentPrincipalHandler(compose(ports));
}
/** Unbound only; database and ingress lifecycle remain caller-owned. */
export function createPostgresRfc9068SsoCurrentPrincipalServer(
  ports: PostgresSsoCurrentPrincipalHttpPorts,
): Server {
  return createSsoCurrentPrincipalServer(compose(ports));
}
