import type { Server } from 'node:http';
import type { GatewayAuditSqlClient } from '../audit/postgres-gateway-audit.ts';
import { InvalidSsoAccessTokenConfiguration } from '../identity/rfc9068-sso-access-tokens.ts';
import { createManagementBrowserHandler } from '../management/browser-http.ts';
import { createClientErrorResponse } from './client-errors.ts';
import { createNodeRequestServer } from './node-request-server.ts';
import {
  createPostgresSsoAuditHistory,
  type SsoAuditHistoryAccessEvent,
} from './postgres-sso-audit-history.ts';
import { createPostgresSsoAuditHistoryHandler } from './postgres-sso-audit-history-http.ts';
import { createPostgresRfc9068SsoManagementHandler } from './postgres-sso-management-http.ts';
import type { PostgresSsoReviewBrowserPorts } from './postgres-sso-review-browser-http.ts';
import { createPostgresSsoReviewHandler } from './postgres-sso-review-http.ts';
import { createSsoAuditHistoryHandler } from './sso-audit-history-http.ts';

export interface PostgresSsoAdministrationBrowserPorts extends PostgresSsoReviewBrowserPorts {
  /** Explicit approved committed/autocommit SQL store; mutually exclusive with callback. */
  readonly auditHistoryClient?: GatewayAuditSqlClient;
  /** Legacy trusted durable SSO writer; never a proxy audit adapter.
   * Omit both ports to preserve the old route surface. Invalid explicit ports fail.
   */
  readonly writeAuditHistoryAccess?: (event: SsoAuditHistoryAccessEvent) => Promise<void>;
}

/** Explicit opt-in administration composition, NOT the read-only review server.
 * Existing signed SSO, fresh IAM and mandatory audit remain the authority.
 * Caller owns approved schemas, SQL lifecycle, public artifact and TLS/ingress.
 * No cookie/session bridge, startup activation, provider calls or new IAM right.
 */
export function createPostgresSsoAdministrationBrowserHandler(
  ports: PostgresSsoAdministrationBrowserPorts,
) {
  const { client, now, issuer, audience, jwks, newRequestId, javascript } = ports;
  const configuration = { client, now, issuer, audience, jwks, newRequestId };
  const auditEnabled = Object.hasOwn(ports, 'writeAuditHistoryAccess');
  const sqlAuditEnabled = Object.hasOwn(ports, 'auditHistoryClient');
  if (auditEnabled && sqlAuditEnabled) throw new InvalidSsoAccessTokenConfiguration();
  const writeAudit = ports.writeAuditHistoryAccess;
  if (auditEnabled && typeof writeAudit !== 'function')
    throw new InvalidSsoAccessTokenConfiguration();
  const audit = sqlAuditEnabled
    ? createPostgresSsoAuditHistoryHandler({
        ...configuration,
        auditClient: ports.auditHistoryClient as GatewayAuditSqlClient,
      })
    : auditEnabled && writeAudit
      ? createSsoAuditHistoryHandler({
          newRequestId,
          audit: createPostgresSsoAuditHistory({ ...configuration, writeAudit }),
        })
      : undefined;
  const review = createPostgresSsoReviewHandler({
    ...configuration,
    ...(Object.hasOwn(ports, 'principalAuditClient')
      ? { principalAuditClient: ports.principalAuditClient }
      : {}),
  });
  const credentials = createPostgresRfc9068SsoManagementHandler(configuration);
  return createManagementBrowserHandler({
    javascript,
    application: (request) => {
      const path = new URL(request.url).pathname;
      if (audit && request.method === 'GET' && path === '/management/v1/audit')
        return audit(request);
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
  ports: PostgresSsoAdministrationBrowserPorts,
): Server {
  return createNodeRequestServer(createPostgresSsoAdministrationBrowserHandler(ports), () => {
    const response = createClientErrorResponse(503, 'internal_error');
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-content-type-options', 'nosniff');
    return response;
  });
}
