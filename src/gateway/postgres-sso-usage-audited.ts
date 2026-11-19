import { createPostgresSsoUsageAuditStore } from '../audit/postgres-sso-usage.ts';
import type { SsoAccessTokenConfiguration } from '../identity/rfc9068-sso-access-tokens.ts';
import type { UsageSqlClient } from '../usage/postgres-ledger.ts';
import { createPostgresSsoUsageHistory } from './postgres-sso-usage-history.ts';

/** Concrete internal composition, not an activated route or migration.
 * Requires reviewed sso_usage_audit_events schema and normal committed/autocommit
 * SQL acknowledgements. A caller-owned transaction must commit before release.
 */
export function createPostgresSsoUsageHistoryWithAudit(
  ports: SsoAccessTokenConfiguration & {
    readonly client: UsageSqlClient;
  },
) {
  const audit = createPostgresSsoUsageAuditStore(ports.client, ports.now);
  return createPostgresSsoUsageHistory({ ...ports, writeAudit: audit.append });
}
