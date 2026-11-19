import type { GatewayAuditSqlClient } from '../audit/postgres-gateway-audit.ts';
import { createPostgresSsoAuditHistoryAccessStore } from '../audit/postgres-sso-audit-history.ts';
import type { SsoAccessTokenConfiguration } from '../identity/rfc9068-sso-access-tokens.ts';
import { createPostgresSsoAuditHistory } from './postgres-sso-audit-history.ts';
import { createSsoAuditHistoryHandler } from './sso-audit-history-http.ts';

export interface PostgresSsoAuditHistoryHttpPorts extends SsoAccessTokenConfiguration {
  readonly client: GatewayAuditSqlClient;
  readonly newRequestId: () => string;
}

/** Explicit Fetch composition with awaited durable metadata audit.
 * No callback override, cookie, listener or runtime activation.
 * Caller owns migrations, database lifecycle and trusted configuration.
 */
export function createPostgresSsoAuditHistoryHandler(
  ports: PostgresSsoAuditHistoryHttpPorts,
): (request: Request) => Promise<Response> {
  const { client, now, issuer, audience, jwks, newRequestId } = ports;
  const audit = createPostgresSsoAuditHistoryAccessStore(client, now);
  const history = createPostgresSsoAuditHistory({
    client,
    now,
    issuer,
    audience,
    jwks,
    writeAudit: audit.append,
  });
  return createSsoAuditHistoryHandler({ history, newRequestId });
}
