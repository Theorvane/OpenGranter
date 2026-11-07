import type { GatewayAuditEvent } from '../gateway/chat-handler.ts';
import type { ManagementAuthenticationAuditEvent } from '../gateway/sso-management-http.ts';
import type { DelegatedRouteAuditEvent } from '../routing/invoke-delegated-route.ts';
import type { ManagedRouteAuditEvent } from '../routing/invoke-jev-managed-route.ts';
import { projectGatewayAuditEvent } from './gateway-event-projection.ts';

export { InvalidGatewayAuditEvent, projectGatewayAuditEvent } from './gateway-event-projection.ts';

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

function requireAuditAcknowledgement(value: unknown): void {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !Object.hasOwn(value, 'rows')
  )
    throw new GatewayAuditUnavailable();
  const rows = (value as Record<string, unknown>).rows;
  if (!Array.isArray(rows) || rows.length !== 1 || !Object.hasOwn(rows, 0))
    throw new GatewayAuditUnavailable();
  const row: unknown = rows[0];
  if (
    typeof row !== 'object' ||
    row === null ||
    Array.isArray(row) ||
    !Object.hasOwn(row, 'event_id')
  )
    throw new GatewayAuditUnavailable();
  const id = (row as Record<string, unknown>).event_id;
  if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) return;
  if (
    typeof id === 'string' &&
    id.length <= 19 &&
    /^[1-9][0-9]*$/u.test(id) &&
    BigInt(id) <= 9_223_372_036_854_775_807n
  )
    return;
  throw new GatewayAuditUnavailable();
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
        requireAuditAcknowledgement(result);
      } catch {
        throw new GatewayAuditUnavailable();
      }
    },
  };
}
