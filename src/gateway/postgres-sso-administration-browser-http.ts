import type { Server } from 'node:http';
import { createManagementBrowserHandler } from '../management/browser-http.ts';
import { createClientErrorResponse } from './client-errors.ts';
import { createNodeRequestServer } from './node-request-server.ts';
import { createPostgresRfc9068SsoManagementHandler } from './postgres-sso-management-http.ts';
import type { PostgresSsoReviewBrowserPorts } from './postgres-sso-review-browser-http.ts';
import { createPostgresSsoReviewHandler } from './postgres-sso-review-http.ts';

/** Explicit opt-in administration composition, NOT the read-only review server.
 * Existing signed SSO, fresh IAM and mandatory audit remain the authority.
 * Caller owns approved schemas, SQL lifecycle, public artifact and TLS/ingress.
 * No cookie/session bridge, startup activation, provider calls or new IAM right.
 */
export function createPostgresSsoAdministrationBrowserHandler(
  ports: PostgresSsoReviewBrowserPorts,
) {
  const { client, now, issuer, audience, jwks, newRequestId, javascript } = ports;
  const configuration = { client, now, issuer, audience, jwks, newRequestId };
  const review = createPostgresSsoReviewHandler(configuration);
  const credentials = createPostgresRfc9068SsoManagementHandler(configuration);
  return createManagementBrowserHandler({
    javascript,
    application: (request) => {
      const path = new URL(request.url).pathname;
      if (
        request.method === 'POST' &&
        (path === '/management/v1/proxy-tokens' || path === '/management/v1/proxy-tokens/revoke')
      )
        return credentials(request);
      return review(request);
    },
  });
}

/** Unbound only. Existing read-only factories and runtime defaults are unchanged. */
export function createPostgresSsoAdministrationBrowserServer(
  ports: PostgresSsoReviewBrowserPorts,
): Server {
  return createNodeRequestServer(createPostgresSsoAdministrationBrowserHandler(ports), () => {
    const response = createClientErrorResponse(503, 'internal_error');
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-content-type-options', 'nosniff');
    return response;
  });
}
