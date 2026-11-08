import type { GatewayAuditEvent } from '../gateway/chat-handler.ts';
import type { ManagementAuthenticationAuditEvent } from '../gateway/sso-management-http.ts';
import type { DelegatedRouteAuditEvent } from '../routing/invoke-delegated-route.ts';
import type { ManagedRouteAuditEvent } from '../routing/invoke-jev-managed-route.ts';
import { projectGatewayAuditEvent } from './gateway-audit-projection.ts';

export { InvalidGatewayAuditEvent, projectGatewayAuditEvent } from './gateway-audit-projection.ts';

export type GatewayAuditInput =
  | GatewayAuditEvent
  | ManagementAuthenticationAuditEvent
  | ManagedRouteAuditEvent
  | DelegatedRouteAuditEvent;

export interface GatewayAuditSqlClient {
  readonly query: (
    sql: string,
    params: readonly unknown[],
  ) => Promise<{ readonly rows: readonly unknown[] }>;
}

export class GatewayAuditUnavailable extends Error {
  constructor() {
    super('Gateway audit store unavailable');
    this.name = 'GatewayAuditUnavailable';
  }
}

/** PostgreSQL append port for existing gateway and routing metadata events. */
export function createPostgresGatewayAuditStore(
  client: GatewayAuditSqlClient,
  now: () => number,
): { readonly append: (event: GatewayAuditInput) => Promise<void> } {
  return {
    async append(event) {
      let occurredAt: number;
      try {
        occurredAt = now();
      } catch {
        throw new GatewayAuditUnavailable();
      }
      const projected = projectGatewayAuditEvent(event, occurredAt);
      try {
        const result = await client.query(
          `INSERT INTO gateway_audit_events
             (occurred_at_ms, kind, request_id, principal_id, credential_id, policy_versions, details)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
           RETURNING event_id`,
          [
            projected.occurredAt,
            projected.kind,
            projected.requestId,
            projected.principalId,
            projected.credentialId,
            projected.policyVersions === null ? null : JSON.stringify(projected.policyVersions),
            JSON.stringify(projected.details),
          ],
        );
        if (result.rows.length !== 1) throw new GatewayAuditUnavailable();
      } catch {
        throw new GatewayAuditUnavailable();
      }
    },
  };
}
