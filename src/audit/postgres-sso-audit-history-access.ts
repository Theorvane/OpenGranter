import type { SsoAuditHistoryAccessEvent } from '../gateway/postgres-sso-audit-history.ts';
import type { GatewayAuditSqlClient } from './postgres-gateway-audit.ts';

export class InvalidSsoAuditHistoryAccessEvent extends Error {
  constructor() {
    super('Invalid SSO audit history access event');
    this.name = 'InvalidSsoAuditHistoryAccessEvent';
  }
}
export class SsoAuditHistoryAccessUnavailable extends Error {
  constructor() {
    super('SSO audit history access store unavailable');
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
  const { outcome, count } = event;
  if (
    typeof outcome !== 'string' ||
    !['ready', 'forbidden', 'invalid_query', 'unauthenticated', 'unavailable'].includes(
      String(outcome),
    ) ||
    typeof count !== 'number' ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > 100 ||
    (outcome !== 'ready' && count !== 0)
  )
    throw new InvalidSsoAuditHistoryAccessEvent();
  const actor = event.principalId === null ? null : identifier(event.principalId);
  const target = event.targetPrincipalId === null ? null : identifier(event.targetPrincipalId);
  if (
    (actor === null &&
      (event.policyVersions !== null ||
        target !== null ||
        !['unauthenticated', 'unavailable'].includes(outcome))) ||
    (actor !== null && outcome === 'unauthenticated') ||
    ((outcome === 'ready' || outcome === 'forbidden') && target === null) ||
    (outcome === 'invalid_query' && target !== null)
  )
    throw new InvalidSsoAuditHistoryAccessEvent();
  let versions: { id: string; version: string }[] | null = null;
  if (actor !== null) {
    if (!Array.isArray(event.policyVersions) || event.policyVersions.length > 1024)
      throw new InvalidSsoAuditHistoryAccessEvent();
    versions = event.policyVersions.map((value) => {
      const policy = record(value);
      return { id: identifier(policy.id), version: identifier(policy.version) };
    });
  }
  return { requestId: identifier(event.requestId), actor, target, versions, outcome, count };
}

/** SSO audit-history ACCESS metadata, never gateway/proxy or retained content.
 * Candidate schema requires review before installation. Resolves on one INSERT
 * acknowledgement only: caller-owned transactions MUST commit before release.
 */
export function createPostgresSsoAuditHistoryAccessStore(
  client: GatewayAuditSqlClient,
  now: () => number,
) {
  return {
    async append(event: SsoAuditHistoryAccessEvent): Promise<void> {
      // Own the allowlisted values before the first asynchronous boundary.
      const value = project(event);
      try {
        const occurredAt = now();
        if (!Number.isSafeInteger(occurredAt) || occurredAt < 0)
          throw new SsoAuditHistoryAccessUnavailable();
        const result = await client.query(
          `INSERT INTO sso_audit_history_access_events
           (occurred_at_ms, request_id, principal_id, policy_versions, target_principal_id, outcome, record_count)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
           RETURNING event_id::text AS event_id`,
          [
            occurredAt,
            value.requestId,
            value.actor,
            value.versions === null ? null : JSON.stringify(value.versions),
            value.target,
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
          throw new SsoAuditHistoryAccessUnavailable();
      } catch {
        throw new SsoAuditHistoryAccessUnavailable();
      }
    },
  };
}
