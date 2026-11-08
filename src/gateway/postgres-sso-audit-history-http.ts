import type { Server } from 'node:http';
import type { GatewayAuditSqlClient } from '../audit/postgres-gateway-audit.ts';
import { createPostgresSsoAuditHistoryAccessStore } from '../audit/postgres-sso-audit-history-access.ts';
import {
  InvalidSsoAccessTokenConfiguration,
  type SsoAccessTokenConfiguration,
} from '../identity/rfc9068-sso-access-tokens.ts';
import { createPostgresSsoAuditHistory } from './postgres-sso-audit-history.ts';
import {
  createSsoAuditHistoryHandler,
  createSsoAuditHistoryServer,
  type SsoAuditHistoryHttpPorts,
} from './sso-audit-history-http.ts';

export interface PostgresSsoAuditHistoryHttpPorts extends SsoAccessTokenConfiguration {
  readonly client: GatewayAuditSqlClient;
  /** Explicit approved committed/autocommit access-audit client, not a writer callback.
   * May be the read client only when its acknowledgement means committed SQL.
   */
  readonly auditClient: GatewayAuditSqlClient;
  readonly newRequestId: () => string;
}
function compose(ports: PostgresSsoAuditHistoryHttpPorts): SsoAuditHistoryHttpPorts {
  try {
    if (
      typeof ports !== 'object' ||
      ports === null ||
      Array.isArray(ports) ||
      ['client', 'auditClient', 'now', 'issuer', 'audience', 'jwks', 'newRequestId'].some(
        (key) => !Object.hasOwn(ports, key),
      )
    )
      throw new InvalidSsoAccessTokenConfiguration();
    const { client, auditClient, now, issuer, audience, jwks, newRequestId } = ports;
    for (const sql of [client, auditClient]) {
      if (typeof sql !== 'object' || sql === null || typeof sql.query !== 'function')
        throw new InvalidSsoAccessTokenConfiguration();
    }
    if (typeof newRequestId !== 'function') throw new InvalidSsoAccessTokenConfiguration();
    const accessAudit = createPostgresSsoAuditHistoryAccessStore(auditClient, now);
    const audit = createPostgresSsoAuditHistory({
      client,
      now,
      issuer,
      audience,
      jwks,
      writeAudit: accessAudit.append,
    });
    return { audit, newRequestId };
  } catch {
    throw new InvalidSsoAccessTokenConfiguration();
  }
}
/** Concrete registered-key + fresh IAM + metadata reader + awaited SQL access audit.
 * No callback override, migrations, session or automatic runtime activation.
 * Caller owns approved schemas, committed SQL semantics, TLS and lifecycle.
 */
export function createPostgresSsoAuditHistoryHandler(ports: PostgresSsoAuditHistoryHttpPorts) {
  return createSsoAuditHistoryHandler(compose(ports));
}
/** Unbound server; no database or listener ownership is acquired by this factory. */
export function createPostgresSsoAuditHistoryServer(
  ports: PostgresSsoAuditHistoryHttpPorts,
): Server {
  return createSsoAuditHistoryServer(compose(ports));
}
