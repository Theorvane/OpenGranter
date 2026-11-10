import type { SsoUsageAuditEvent } from '../gateway/postgres-sso-usage-history.ts';
import type { GatewayAuditSqlClient } from './postgres-gateway-audit.ts';

export class InvalidSsoUsageAuditEvent extends Error {
  constructor() {
    super('Invalid SSO usage audit event');
    this.name = 'InvalidSsoUsageAuditEvent';
  }
}
export class SsoUsageAuditUnavailable extends Error {
  constructor() {
    super('SSO usage audit store unavailable');
    this.name = 'SsoUsageAuditUnavailable';
  }
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new InvalidSsoUsageAuditEvent();
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 256 ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new InvalidSsoUsageAuditEvent();
  return value;
}
function project(value: unknown) {
  const event = record(value);
  const { outcome, count, principalId, policyVersions, mode, targetPrincipalId } = event;
  if (
    typeof outcome !== 'string' ||
    !['ready', 'forbidden', 'invalid_query', 'unavailable', 'unauthenticated'].includes(outcome) ||
    typeof count !== 'number' ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    (outcome !== 'ready' && count !== 0) ||
    (mode !== null && mode !== 'self' && mode !== 'all') ||
    (mode === null) !== (targetPrincipalId === null) ||
    ((outcome === 'ready' || outcome === 'forbidden') && mode === null) ||
    ((outcome === 'invalid_query' || outcome === 'unauthenticated') && mode !== null)
  )
    throw new InvalidSsoUsageAuditEvent();
  const target = targetPrincipalId === null ? null : identifier(targetPrincipalId);
  if ((mode === 'self' && target !== principalId) || (principalId === null && mode !== null))
    throw new InvalidSsoUsageAuditEvent();
  let versions: { id: string; version: string }[] | null;
  let actor: string | null;
  if (principalId === null) {
    if (policyVersions !== null || (outcome !== 'unauthenticated' && outcome !== 'unavailable'))
      throw new InvalidSsoUsageAuditEvent();
    actor = null;
    versions = null;
  } else {
    actor = identifier(principalId);
    if (
      outcome === 'unauthenticated' ||
      !Array.isArray(policyVersions) ||
      policyVersions.length > 1024
    )
      throw new InvalidSsoUsageAuditEvent();
    versions = policyVersions.map((value: unknown) => {
      const policy = record(value);
      return { id: identifier(policy.id), version: identifier(policy.version) };
    });
  }
  return { requestId: identifier(event.requestId), outcome, count, actor, versions, target, mode };
}

/** Dedicated SSO metadata, never a synthetic proxy-credential gateway event. */
export function createPostgresSsoUsageAuditStore(
  client: GatewayAuditSqlClient,
  now: () => number,
): { readonly append: (event: SsoUsageAuditEvent) => Promise<void> } {
  return {
    async append(event) {
      const projected = project(event);
      try {
        const occurredAt = now();
        if (!Number.isSafeInteger(occurredAt) || occurredAt < 0)
          throw new SsoUsageAuditUnavailable();
        const result = await client.query(
          `INSERT INTO sso_usage_audit_events
         (occurred_at_ms, request_id, outcome, record_count, principal_id, policy_versions, target_principal_id, mode)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         RETURNING event_id::text AS event_id`,
          [
            occurredAt,
            projected.requestId,
            projected.outcome,
            projected.count,
            projected.actor,
            projected.versions === null ? null : JSON.stringify(projected.versions),
            projected.target,
            projected.mode,
          ],
        );
        const row = result.rows[0];
        if (
          result.rows.length !== 1 ||
          typeof row !== 'object' ||
          row === null ||
          !('event_id' in row) ||
          typeof row.event_id !== 'string' ||
          !/^[1-9][0-9]*$/u.test(row.event_id)
        )
          throw new SsoUsageAuditUnavailable();
      } catch {
        throw new SsoUsageAuditUnavailable();
      }
    },
  };
}
