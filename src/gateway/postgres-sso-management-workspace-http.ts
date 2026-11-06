import type { Server } from 'node:http';
import { createClientErrorResponse } from './client-errors.ts';
import { createNodeRequestServer } from './node-request-server.ts';
import { createPostgresRfc9068SsoManagementHandler } from './postgres-sso-management-http.ts';
import { createPostgresSsoReviewHandler } from './postgres-sso-review-http.ts';
import type { PostgresSsoUsageHistoryHttpPorts } from './postgres-sso-usage-history-http.ts';

/** Explicit opt-in writes, never an extension of the read-only review factory.
 * Existing child handlers retain registered-key SSO, current IAM and mandatory
 * durable audit. No service/auth/audit override, session, schema or activation.
 */
export function createPostgresSsoManagementWorkspaceHandler(
  ports: PostgresSsoUsageHistoryHttpPorts,
): (request: Request) => Promise<Response> {
  const { client, now, issuer, audience, jwks, newRequestId } = ports;
  const configuration = { client, now, issuer, audience, jwks, newRequestId };
  const management = createPostgresRfc9068SsoManagementHandler(configuration);
  const review = createPostgresSsoReviewHandler(configuration);
  return (request) => {
    const path = new URL(request.url).pathname;
    if (
      request.method === 'POST' &&
      (path === '/management/v1/proxy-tokens' || path === '/management/v1/proxy-tokens/revoke')
    )
      return management(request);
    return review(request);
  };
}

/** Unbound source factory. Caller owns approved SQL, TLS/listen and lifecycle.
 * A lost write response can be ambiguous; never retry automatically.
 */
export function createPostgresSsoManagementWorkspaceServer(
  ports: PostgresSsoUsageHistoryHttpPorts,
): Server {
  return createNodeRequestServer(createPostgresSsoManagementWorkspaceHandler(ports), () => {
    const response = createClientErrorResponse(503, 'internal_error');
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-content-type-options', 'nosniff');
    return response;
  });
}
