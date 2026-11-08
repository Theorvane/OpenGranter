import type { Server } from 'node:http';
import type { SsoAccessTokenConfiguration } from '../identity/rfc9068-sso-access-tokens.ts';
import type { UsageSqlClient } from '../usage/postgres-ledger.ts';
import { createPostgresSsoUsageHistoryWithAudit } from './postgres-sso-usage-audited.ts';
import {
  createSsoUsageHistoryHandler,
  createSsoUsageHistoryServer,
  type SsoUsageHistoryHttpPorts,
} from './sso-usage-history-http.ts';

export interface PostgresSsoUsageHistoryHttpPorts extends SsoAccessTokenConfiguration {
  readonly client: UsageSqlClient;
  readonly newRequestId: () => string;
}
function compose(ports: PostgresSsoUsageHistoryHttpPorts): SsoUsageHistoryHttpPorts {
  const { client, now, issuer, audience, jwks, newRequestId } = ports;
  const usage = createPostgresSsoUsageHistoryWithAudit({ client, now, issuer, audience, jwks });
  return { usage, newRequestId };
}
/** Concrete registered-key + SQL reader + awaited durable audit, no audit callback override.
 * Candidate audit schema must be reviewed/promoted before any installed activation.
 * Caller owns committed SQL, database, TLS and lifecycle; no session/runtime activation.
 */
export function createPostgresSsoUsageHistoryHandler(
  ports: PostgresSsoUsageHistoryHttpPorts,
): (request: Request) => Promise<Response> {
  return createSsoUsageHistoryHandler(compose(ports));
}
export function createPostgresSsoUsageHistoryServer(
  ports: PostgresSsoUsageHistoryHttpPorts,
): Server {
  return createSsoUsageHistoryServer(compose(ports));
}
