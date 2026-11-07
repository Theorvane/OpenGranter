import type { Server } from 'node:http';
import type { GatewayAuditSqlClient } from '../audit/postgres-gateway-audit.ts';
import { InvalidSsoAccessTokenConfiguration } from '../identity/rfc9068-sso-access-tokens.ts';
import { createClientErrorResponse } from './client-errors.ts';
import { createNodeRequestServer } from './node-request-server.ts';
import { createPostgresRfc9068SsoCurrentPrincipalHandler } from './postgres-sso-current-principal-http.ts';
import {
  createPostgresSsoModelCatalogHandler,
  type PostgresSsoModelCatalogHttpPorts,
} from './postgres-sso-model-catalog-http.ts';

export interface PostgresSsoReadApiPorts extends PostgresSsoModelCatalogHttpPorts {
  /** Required committed/autocommit client; dedicated identity-audit schema is caller-installed. */
  readonly principalAuditClient: GatewayAuditSqlClient;
}

function failure(status: number, code: 'not_found' | 'internal_error') {
  const response = createClientErrorResponse(status, code);
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-content-type-options', 'nosniff');
  return response;
}

/** Explicit server-facing Bearer read API. Identity is not catalog authority or a session. */
export function createPostgresSsoReadApiHandler(
  ports: PostgresSsoReadApiPorts,
): (request: Request) => Promise<Response> {
  try {
    if (
      typeof ports !== 'object' ||
      ports === null ||
      Array.isArray(ports) ||
      ['client', 'principalAuditClient', 'now', 'issuer', 'audience', 'jwks', 'newRequestId'].some(
        (field) => !Object.hasOwn(ports, field),
      )
    )
      throw new InvalidSsoAccessTokenConfiguration();
    const { client, principalAuditClient, now, issuer, audience, jwks, newRequestId } = ports;
    // Project known fields, not callback authentication or caller-supplied dispatch overrides.
    const configuration = { client, now, issuer, audience, jwks, newRequestId };
    const principal = createPostgresRfc9068SsoCurrentPrincipalHandler({
      ...configuration,
      auditClient: principalAuditClient,
    });
    const catalog = createPostgresSsoModelCatalogHandler(configuration);
    return async (request) => {
      try {
        const path = new URL(request.url).pathname;
        if (request.method !== 'GET') return failure(404, 'not_found');
        if (path === '/management/v1/principal') return await principal(request);
        if (path === '/management/v1/models' || path.startsWith('/management/v1/models/'))
          return await catalog(request);
        return failure(404, 'not_found');
      } catch {
        return failure(503, 'internal_error');
      }
    };
  } catch {
    throw new InvalidSsoAccessTokenConfiguration();
  }
}

/** Unbound: caller owns listen/TLS, schema installation, database lifecycle and durable clients. */
export function createPostgresSsoReadApiServer(ports: PostgresSsoReadApiPorts): Server {
  return createNodeRequestServer(createPostgresSsoReadApiHandler(ports), () =>
    failure(503, 'internal_error'),
  );
}
