import type { Server } from 'node:http';
import { createClientErrorResponse } from './client-errors.ts';
import { createNodeRequestServer } from './node-request-server.ts';
import {
  createPostgresSsoCanonicalReviewHandler,
  type PostgresSsoCanonicalReviewPorts,
} from './postgres-sso-canonical-review-http.ts';
import { createPostgresRfc9068SsoManagementHandler } from './postgres-sso-management-http.ts';

export type PostgresSsoOperationsPorts = PostgresSsoCanonicalReviewPorts;

function privateResponse(response: Response): Response {
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-content-type-options', 'nosniff');
  return response;
}
function failure(): Response {
  return privateResponse(createClientErrorResponse(503, 'internal_error'));
}

/** Opt-in bearer-only composition; not a browser session or runtime activation.
 * Preserve read-only review separately. Each existing handler owns fresh SSO,
 * IAM and mandatory durable audit. Caller owns committed SQL, TLS and lifetime.
 */
export function createPostgresSsoOperationsHandler(
  ports: PostgresSsoOperationsPorts,
): (request: Request) => Promise<Response> {
  const { client, now, issuer, audience, jwks, newRequestId } = ports;
  const configuration = { client, now, issuer, audience, jwks, newRequestId };
  const review = createPostgresSsoCanonicalReviewHandler({
    ...configuration,
    ...(Object.hasOwn(ports, 'javascript') ? { javascript: ports.javascript } : {}),
  });
  const tokens = createPostgresRfc9068SsoManagementHandler(configuration);
  return async (request: Request): Promise<Response> => {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/management/v1/proxy-tokens' || path === '/management/v1/proxy-tokens/revoke')
        return privateResponse(await tokens(request));
      return await review(request);
    } catch {
      return failure();
    }
  };
}

/** Unbound server; this factory never listens or owns the SQL connection. */
export function createPostgresSsoOperationsServer(ports: PostgresSsoOperationsPorts): Server {
  return createNodeRequestServer(createPostgresSsoOperationsHandler(ports), failure);
}
