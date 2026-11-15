import type { Server } from 'node:http';
import type { GatewayAuditSqlClient } from '../audit/postgres-gateway-audit.ts';
import {
  InvalidSsoAccessTokenConfiguration,
  type SsoAccessTokenConfiguration,
} from '../identity/rfc9068-sso-access-tokens.ts';
import { createManagementBrowserHandler } from '../management/browser-http.ts';
import { createClientErrorResponse } from './client-errors.ts';
import { createNodeRequestServer } from './node-request-server.ts';
import { createPostgresSsoAuditHistoryHandler } from './postgres-sso-audit-history-http.ts';
import { createPostgresSsoModelCatalogHandler } from './postgres-sso-model-catalog-http.ts';
import { createPostgresSsoUsageHistoryHandler } from './postgres-sso-usage-history-http.ts';

export interface PostgresSsoCanonicalReviewPorts extends SsoAccessTokenConfiguration {
  /** Same approved committed/autocommit connection for canonical readers and audit writers. */
  readonly client: GatewayAuditSqlClient;
  readonly newRequestId: () => string;
  /** Trusted public bundle only; omitted means no public shell. Not a session grant. */
  readonly javascript?: string;
}

function failure(status: number, code: 'not_found' | 'internal_error') {
  const response = createClientErrorResponse(status, code);
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-content-type-options', 'nosniff');
  return response;
}

/** Explicit read-only composition on canonical Fetch ports, not legacy workspace ports.
 * No callback audit overrides, proxy/token writes, cookies, runtime changes or listeners.
 * Caller owns migrations, SQL lifecycle, approved bundle and ingress/TLS.
 */
export function createPostgresSsoCanonicalReviewHandler(
  ports: PostgresSsoCanonicalReviewPorts,
): (request: Request) => Promise<Response> {
  const { client, now, issuer, audience, jwks, newRequestId, javascript } = ports;
  const shell = Object.hasOwn(ports, 'javascript');
  if (shell && (typeof javascript !== 'string' || !javascript.trim() || javascript.includes('\0')))
    throw new InvalidSsoAccessTokenConfiguration();
  const configuration = { client, now, issuer, audience, jwks, newRequestId };
  const catalog = createPostgresSsoModelCatalogHandler(configuration);
  const usage = createPostgresSsoUsageHistoryHandler(configuration);
  const audit = createPostgresSsoAuditHistoryHandler(configuration);
  const application = async (request: Request): Promise<Response> => {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/management/v1/audit') return await audit(request);
      if (path === '/management/v1/usage') return await usage(request);
      if (path === '/management/v1/models' || path.startsWith('/management/v1/models/'))
        return await catalog(request);
      return failure(404, 'not_found');
    } catch {
      return failure(503, 'internal_error');
    }
  };
  return shell
    ? createManagementBrowserHandler({ javascript: javascript as string, application })
    : application;
}

/** Unbound only; caller owns listen, close and database ownership. */
export function createPostgresSsoCanonicalReviewServer(
  ports: PostgresSsoCanonicalReviewPorts,
): Server {
  return createNodeRequestServer(createPostgresSsoCanonicalReviewHandler(ports), () =>
    failure(503, 'internal_error'),
  );
}
