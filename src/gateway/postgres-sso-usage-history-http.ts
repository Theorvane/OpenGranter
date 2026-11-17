import { createPostgresSsoUsageAuditStore } from '../audit/postgres-sso-usage-history.ts';
import type { SsoAccessTokenConfiguration } from '../identity/rfc9068-sso-access-tokens.ts';
import type { UsageSqlClient } from '../usage/postgres-ledger.ts';
import { createPostgresSsoUsageHistory } from './postgres-sso-usage-history.ts';
import { createSsoUsageHistoryHandler } from './sso-usage-history-http.ts';

export interface PostgresSsoUsageHistoryHttpPorts extends SsoAccessTokenConfiguration {
  readonly client: UsageSqlClient;
  readonly newRequestId: () => string;
}

/** Explicit Fetch composition with awaited durable metadata audit.
 * No callback override, cookie, listener or runtime activation.
 * Caller owns migrations, database lifecycle and trusted configuration.
 */
export function createPostgresSsoUsageHistoryHandler(
  ports: PostgresSsoUsageHistoryHttpPorts,
): (request: Request) => Promise<Response> {
  const { client, now, issuer, audience, jwks, newRequestId } = ports;
  const audit = createPostgresSsoUsageAuditStore(client, now);
  const history = createPostgresSsoUsageHistory({
    client,
    now,
    issuer,
    audience,
    jwks,
    writeAudit: audit.append,
  });
  return createSsoUsageHistoryHandler({ history, newRequestId });
}
