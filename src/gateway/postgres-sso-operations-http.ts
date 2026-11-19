import type { Server } from 'node:http';
import { createNodeRequestServer } from './node-request-server.ts';
import {
  createPostgresSsoCanonicalReviewHandler,
  type PostgresSsoCanonicalReviewPorts,
} from './postgres-sso-canonical-review-http.ts';
import { createPostgresRfc9068SsoManagementHandler } from './postgres-sso-management-http.ts';

export type PostgresSsoOperationsPorts = PostgresSsoCanonicalReviewPorts;

/** Opt-in bearer-only composition; not a browser session or runtime activation.
 * Preserve read-only review separately. Each existing handler owns fresh SSO,
 * IAM and mandatory durable audit. Caller owns committed SQL, TLS and lifetime.
 */
export function createPostgresSsoOperationsHandler(
  ports: PostgresSsoOperationsPorts,
): (request: Request) => Promise<Response> {
  const { client, now, issuer, audience, jwks, newRequestId } = ports;
  const configuration = { client, now, issuer, audience, jwks, newRequestId };
  const review = createPostgresSsoCanonicalReviewHandler(ports);
  const tokens = createPostgresRfc9068SsoManagementHandler(configuration);
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path === '/management/v1/proxy-tokens' || path === '/management/v1/proxy-tokens/revoke')
      return tokens(request);
    return review(request);
  };
}

/** Unbound server; this factory never listens or owns the SQL connection. */
export function createPostgresSsoOperationsServer(ports: PostgresSsoOperationsPorts): Server {
  return createNodeRequestServer(createPostgresSsoOperationsHandler(ports));
}
