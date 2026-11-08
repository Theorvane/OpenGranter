import type { Server } from 'node:http';
import type { GatewayAuditSqlClient } from '../audit/postgres-gateway-audit.ts';
import { InvalidSsoAccessTokenConfiguration } from '../identity/rfc9068-sso-access-tokens.ts';
import { createClientErrorResponse } from './client-errors.ts';
import { createNodeRequestServer } from './node-request-server.ts';
import { createPostgresRfc9068SsoCurrentPrincipalHandler } from './postgres-sso-current-principal-http.ts';
import { createPostgresRfc9068SsoManagementHandler } from './postgres-sso-management-http.ts';
import { createPostgresSsoModelCatalogHandler } from './postgres-sso-model-catalog-http.ts';
import {
  createPostgresSsoUsageHistoryHandler,
  type PostgresSsoUsageHistoryHttpPorts,
} from './postgres-sso-usage-history-http.ts';

export interface PostgresSsoReviewHttpPorts extends PostgresSsoUsageHistoryHttpPorts {
  /** Explicit opt-in; caller owns reviewed DDL and committed/autocommit SQL. */
  readonly principalAuditClient?: GatewayAuditSqlClient | undefined;
}

/** Explicit read-only source composition, NOT an installed runtime or session.
 * Caller owns SQL lifecycle and reviewed schemas. Both child handlers retain
 * fresh registered-key SSO/IAM and mandatory durable audit, with no overrides.
 * No credential writes, socket binding, migrations or browser authority API.
 */
export function createPostgresSsoReviewHandler(
  ports: PostgresSsoReviewHttpPorts,
): (request: Request) => Promise<Response> {
  const { client, now, issuer, audience, jwks, newRequestId } = ports;
  const configuration = { client, now, issuer, audience, jwks, newRequestId };
  const catalog = createPostgresSsoModelCatalogHandler(configuration);
  const usage = createPostgresSsoUsageHistoryHandler(configuration);
  const auditClient = Object.hasOwn(ports, 'principalAuditClient')
    ? ports.principalAuditClient
    : undefined;
  if (Object.hasOwn(ports, 'principalAuditClient') && !auditClient)
    throw new InvalidSsoAccessTokenConfiguration();
  const principal = auditClient
    ? createPostgresRfc9068SsoCurrentPrincipalHandler({ ...configuration, auditClient })
    : createPostgresRfc9068SsoManagementHandler(configuration);
  return async (request) => {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET') {
      // Identity projection only: never dispatch token issue/revoke operations.
      if (path === '/management/v1/me') return principal(request);
      if (path === '/management/v1/usage') return usage(request);
      if (path === '/management/v1/models' || path.startsWith('/management/v1/models/'))
        return catalog(request);
    }
    const response = createClientErrorResponse(404, 'not_found');
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-content-type-options', 'nosniff');
    return response;
  };
}

/** Returns an unbound read-only server, not an installed runtime or session.
 * Caller owns listen/TLS, SQL lifecycle and reviewed schema promotion.
 */
export function createPostgresSsoReviewServer(ports: PostgresSsoReviewHttpPorts): Server {
  return createNodeRequestServer(createPostgresSsoReviewHandler(ports), () => {
    const response = createClientErrorResponse(503, 'internal_error');
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-content-type-options', 'nosniff');
    return response;
  });
}
