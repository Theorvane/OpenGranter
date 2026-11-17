import type { SsoCatalogAuditEvent } from '../gateway/postgres-sso-model-catalog.ts';
import type { GatewayAuditSqlClient } from './postgres-gateway-audit.ts';

export class InvalidSsoCatalogAuditEvent extends Error {
  constructor() {
    super('Invalid SSO catalog audit event');
    this.name = 'InvalidSsoCatalogAuditEvent';
  }
}
export class SsoCatalogAuditUnavailable extends Error {
  constructor() {
    super('SSO catalog audit store unavailable');
    this.name = 'SsoCatalogAuditUnavailable';
  }
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new InvalidSsoCatalogAuditEvent();
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
    throw new InvalidSsoCatalogAuditEvent();
  return value;
}
function project(value: unknown) {
  const event = record(value);
  const { operation, outcome, count, principalId, policyVersions } = event;
  if (
    (operation !== 'list' && operation !== 'detail') ||
    typeof outcome !== 'string' ||
    !['ready', 'missing', 'unavailable', 'unauthenticated'].includes(outcome) ||
    typeof count !== 'number' ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    (outcome !== 'ready' && count !== 0) ||
    (outcome === 'missing' && operation !== 'detail') ||
    (outcome === 'ready' && operation === 'detail' && count !== 1)
  )
    throw new InvalidSsoCatalogAuditEvent();
  let versions: { id: string; version: string }[] | null;
  let actor: string | null;
  if (principalId === null) {
    if (policyVersions !== null || (outcome !== 'unauthenticated' && outcome !== 'unavailable'))
      throw new InvalidSsoCatalogAuditEvent();
    actor = null;
    versions = null;
  } else {
    actor = identifier(principalId);
    if (
      outcome === 'unauthenticated' ||
      !Array.isArray(policyVersions) ||
      policyVersions.length > 1024
    )
      throw new InvalidSsoCatalogAuditEvent();
    versions = policyVersions.map((value: unknown) => {
      const policy = record(value);
      return { id: identifier(policy.id), version: identifier(policy.version) };
    });
  }
  return { requestId: identifier(event.requestId), operation, outcome, count, actor, versions };
}

/** Dedicated SSO metadata, never a synthetic proxy-credential gateway event. */
export function createPostgresSsoCatalogAuditStore(
  client: GatewayAuditSqlClient,
  now: () => number,
): { readonly append: (event: SsoCatalogAuditEvent) => Promise<void> } {
  return {
    async append(event) {
      const projected = project(event);
      try {
        const occurredAt = now();
        if (!Number.isSafeInteger(occurredAt) || occurredAt < 0)
          throw new SsoCatalogAuditUnavailable();
        const result = await client.query(
          `INSERT INTO sso_catalog_audit_events
         (occurred_at_ms, request_id, operation, outcome, model_count, principal_id, policy_versions)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING event_id::text AS event_id`,
          [
            occurredAt,
            projected.requestId,
            projected.operation,
            projected.outcome,
            projected.count,
            projected.actor,
            projected.versions === null ? null : JSON.stringify(projected.versions),
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
          throw new SsoCatalogAuditUnavailable();
      } catch {
        throw new SsoCatalogAuditUnavailable();
      }
    },
  };
}
