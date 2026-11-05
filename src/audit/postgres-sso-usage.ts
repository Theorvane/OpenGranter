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
  const { outcome, count, mode } = event;
  if (
    typeof outcome !== 'string' ||
    !['ready', 'forbidden', 'invalid_query', 'unauthenticated', 'unavailable'].includes(
      String(outcome),
    ) ||
    typeof count !== 'number' ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > 100 ||
    (outcome !== 'ready' && count !== 0) ||
    (mode !== null && mode !== 'self' && mode !== 'all')
  )
    throw new InvalidSsoUsageAuditEvent();
  const actor = event.principalId === null ? null : identifier(event.principalId);
  const target = event.targetPrincipalId === null ? null : identifier(event.targetPrincipalId);
  if (
    (mode === null) !== (target === null) ||
    (actor === null &&
      (event.policyVersions !== null ||
        mode !== null ||
        !['unauthenticated', 'unavailable'].includes(String(outcome)))) ||
    (actor !== null && outcome === 'unauthenticated') ||
    ((outcome === 'ready' || outcome === 'forbidden') && mode === null) ||
    (outcome === 'invalid_query' && mode !== null) ||
    (mode === 'self' && target !== actor)
  )
    throw new InvalidSsoUsageAuditEvent();
  let versions: { id: string; version: string }[] | null = null;
  if (actor !== null) {
    if (!Array.isArray(event.policyVersions) || event.policyVersions.length > 1024)
      throw new InvalidSsoUsageAuditEvent();
    versions = event.policyVersions.map((value) => {
      const policy = record(value);
      return { id: identifier(policy.id), version: identifier(policy.version) };
    });
  }
  return { requestId: identifier(event.requestId), actor, target, versions, mode, outcome, count };
}

/** Metadata only. The candidate schema requires review before installed activation. */
export function createPostgresSsoUsageAuditStore(client: GatewayAuditSqlClient, now: () => number) {
  return {
    async append(event: SsoUsageAuditEvent): Promise<void> {
      // Own the allowlisted values before the first asynchronous boundary.
      const value = project(event);
      try {
        const occurredAt = now();
        if (!Number.isSafeInteger(occurredAt) || occurredAt < 0)
          throw new SsoUsageAuditUnavailable();
        const result = await client.query(
          `INSERT INTO sso_usage_audit_events
           (occurred_at_ms, request_id, principal_id, policy_versions, target_principal_id, mode, outcome, record_count)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
           RETURNING event_id::text AS event_id`,
          [
            occurredAt,
            value.requestId,
            value.actor,
            value.versions === null ? null : JSON.stringify(value.versions),
            value.target,
            value.mode,
            value.outcome,
            value.count,
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
