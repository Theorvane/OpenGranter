import type { GatewayAuditSqlClient } from '../audit/postgres-gateway-audit.ts';
import { clientErrorFormat, createClientErrorResponse } from './client-errors.ts';
import { isModelDiscoveryPath } from './model-discovery-path.ts';
import { createNodeRequestServer } from './node-request-server.ts';
import { createPostgresChatHandler } from './postgres-chat-handler.ts';

export interface PostgresCatalogHttpPorts {
  readonly client: GatewayAuditSqlClient;
  readonly now: () => number;
  readonly newRequestId: () => string;
}

/** No caller-configurable execution ports: catalog discovery must never execute. */
async function unavailable(): Promise<never> {
  throw new Error('Catalog execution unavailable');
}

/** Standalone existing proxy-authenticated discovery, not a browser authenticator.
 * Reuses persisted credential verification, fresh IAM, catalog projection and
 * required audit. Caller owns migrations/connections/ingress. No provider setup,
 * proxy issuance, SSO exchange, usage/audit reading, or inference is exposed.
 */
export function createPostgresCatalogHandler(ports: PostgresCatalogHttpPorts) {
  const discovery = createPostgresChatHandler<never>({
    client: ports.client,
    now: ports.now,
    newRequestId: ports.newRequestId,
    checkLimit: unavailable,
    resolveSecret: unavailable,
    invokeDirect: unavailable,
  });
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method !== 'GET' || !isModelDiscoveryPath(url.pathname)) {
      const response = createClientErrorResponse(
        404,
        'not_found',
        undefined,
        clientErrorFormat(url.pathname),
      );
      response.headers.set('cache-control', 'no-store');
      return response;
    }
    return discovery(request);
  };
}

/** Creates, but never binds, a read-only listener. Caller owns its lifecycle. */
export function createPostgresCatalogServer(ports: PostgresCatalogHttpPorts) {
  return createNodeRequestServer(createPostgresCatalogHandler(ports));
}
