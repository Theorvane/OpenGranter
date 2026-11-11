import type { SsoAuditHistoryAccessEvent } from '../gateway/postgres-sso-audit-history.ts';
import type { GatewayAuditSqlClient } from './postgres-gateway-audit.ts';

export class InvalidSsoAuditHistoryAccessEvent extends Error {
  constructor() {
    super('Invalid SSO audit-history access event');
    this.name = 'InvalidSsoAuditHistoryAccessEvent';
  }
}
export class SsoAuditHistoryAccessUnavailable extends Error {
  constructor() {
    super('SSO audit-history access store unavailable');
    this.name = 'SsoAuditHistoryAccessUnavailable';
  }
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new InvalidSsoAuditHistoryAccessEvent();
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
    throw new InvalidSsoAuditHistoryAccessEvent();
  return value;
}
function project(value: unknown) {
  const event = record(value);
  const { outcome, count, principalId, policyVersions, targetPrincipalId } = event;
  if (
    typeof outcome !== 'string' ||
    !['ready', 'forbidden', 'invalid_query', 'unavailable', 'unauthenticated'].includes(outcome) ||
    typeof count !== 'number' ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    (outcome !== 'ready' && count !== 0) ||
    ((outcome === 'ready' || outcome === 'forbidden') && targetPrincipalId === null) ||
    ((outcome === 'invalid_query' || outcome === 'unauthenticated') && targetPrincipalId !== null)
  )
    throw new InvalidSsoAuditHistoryAccessEvent();
  const target = targetPrincipalId === null ? null : identifier(targetPrincipalId);
  if (principalId === null && target !== null) throw new InvalidSsoAuditHistoryAccessEvent();
  let versions: { id: string; version: string }[] | null;
  let actor: string | null;
  if (principalId === null) {
    if (policyVersions !== null || (outcome !== 'unauthenticated' && outcome !== 'unavailable'))
      throw new InvalidSsoAuditHistoryAccessEvent();
    actor = null;
    versions = null;
  } else {
    actor = identifier(principalId);
    if (
      outcome === 'unauthenticated' ||
      !Array.isArray(policyVersions) ||
      policyVersions.length > 1024
    )
      throw new InvalidSsoAuditHistoryAccessEvent();
    versions = policyVersions.map((value: unknown) => {
      const policy = record(value);
      return { id: identifier(policy.id), version: identifier(policy.version) };
    });
  }
  return { requestId: identifier(event.requestId), outcome, count, actor, versions, target };
}

/** Dedicated SSO metadata, never a synthetic proxy-credential gateway event. */
export function createPostgresSsoAuditHistoryAccessStore(
  client: GatewayAuditSqlClient,
  now: () => number,
): { readonly append: (event: SsoAuditHistoryAccessEvent) => Promise<void> } {
  return {
    async append(event) {
      const projected = project(event);
      try {
        const occurredAt = now();
        if (!Number.isSafeInteger(occurredAt) || occurredAt < 0)
          throw new SsoAuditHistoryAccessUnavailable();
        const result = await client.query(
          `INSERT INTO sso_audit_history_access_events
         (occurred_at_ms, request_id, outcome, record_count, principal_id, policy_versions, target_principal_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         RETURNING event_id::text AS event_id`,
          [
            occurredAt,
            projected.requestId,
            projected.outcome,
            projected.count,
            projected.actor,
            projected.versions === null ? null : JSON.stringify(projected.versions),
            projected.target,
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
          throw new SsoAuditHistoryAccessUnavailable();
      } catch {
        throw new SsoAuditHistoryAccessUnavailable();
      }
    },
  };
}
