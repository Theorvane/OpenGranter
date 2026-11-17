import type { Server } from 'node:http';
import { createClientErrorResponse } from './client-errors.ts';
import { createNodeRequestServer } from './node-request-server.ts';
import {
  createPostgresSsoCanonicalReviewHandler,
  type PostgresSsoCanonicalReviewPorts,
} from './postgres-sso-canonical-review-http.ts';
import { createPostgresRfc9068SsoManagementHandler } from './postgres-sso-management-http.ts';

export type PostgresSsoCanonicalOperationsPorts = PostgresSsoCanonicalReviewPorts;

function privateResponse(response: Response): Response {
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-content-type-options', 'nosniff');
  return response;
}
function failure(): Response {
  return privateResponse(createClientErrorResponse(503, 'internal_error'));
}

/** Explicit operations composition, never the default read-only review boundary.
 * Existing registered-key human authentication, fresh IAM, lifetime and durable
 * audit gates remain owned by the underlying handlers. No callback overrides,
 * session/cookie bridge, new grants, migrations or runtime/listener activation.
 * Caller owns a committed/autocommit SQL connection, approved artifact and TLS.
 */
export function createPostgresSsoCanonicalOperationsHandler(
  ports: PostgresSsoCanonicalOperationsPorts,
): (request: Request) => Promise<Response> {
  const { client, now, issuer, audience, jwks, newRequestId } = ports;
  const configuration = { client, now, issuer, audience, jwks, newRequestId };
  const review = createPostgresSsoCanonicalReviewHandler({
    ...configuration,
    ...(Object.hasOwn(ports, 'javascript') ? { javascript: ports.javascript } : {}),
  });
  const management = createPostgresRfc9068SsoManagementHandler(configuration);
  return async (request: Request): Promise<Response> => {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/management/v1/proxy-tokens' || path === '/management/v1/proxy-tokens/revoke')
        return privateResponse(await management(request));
      return await review(request);
    } catch {
      return failure();
    }
  };
}

/** Unbound only: selection is explicit, listen/close/database lifetime caller-owned. */
export function createPostgresSsoCanonicalOperationsServer(
  ports: PostgresSsoCanonicalOperationsPorts,
): Server {
  return createNodeRequestServer(createPostgresSsoCanonicalOperationsHandler(ports), failure);
}
