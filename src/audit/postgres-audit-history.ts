import { type GatewayAuditSqlClient, projectGatewayAuditEvent } from './postgres-gateway-audit.ts';

import { type AuditTimeRange, matchesAuditTimeRange, validAuditTimeRange } from './time-range.ts';

const MAX_BIGINT = 9_223_372_036_854_775_807n;

export class AuditHistoryUnavailable extends Error {
  constructor() {
    super('Audit history unavailable');
    this.name = 'AuditHistoryUnavailable';
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AuditHistoryUnavailable();
  }
  return value as Record<string, unknown>;
}

function positiveBigint(value: unknown): { text: string; numeric: bigint } {
  if (typeof value !== 'string' || value.length > 19 || !/^[1-9][0-9]*$/u.test(value)) {
    throw new AuditHistoryUnavailable();
  }
  const numeric = BigInt(value);
  if (numeric > MAX_BIGINT) throw new AuditHistoryUnavailable();
  return { text: value, numeric };
}

function occurredAt(value: unknown): number {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new AuditHistoryUnavailable();
  }
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) throw new AuditHistoryUnavailable();
  return numeric;
}

export interface AuditHistoryQuery extends AuditTimeRange {
  readonly principalId: string;
  readonly limit: number;
  readonly cursor?: string | null;
}

export interface AuditHistoryEvent {
  readonly eventId: string;
  readonly occurredAt: number;
  readonly kind: string;
  readonly requestId: string;
  readonly principalId: string;
  readonly credentialId: string;
  readonly policyVersions: readonly { readonly id: string; readonly version: string }[];
  readonly details: Readonly<Record<string, unknown>>;
}

export interface AuditHistoryPage {
  readonly events: readonly AuditHistoryEvent[];
  readonly nextCursor: string | null;
}

/** Read one principal's nonsecret audit metadata in descending event-ID order. */
export function createPostgresAuditHistoryReader(
  client: GatewayAuditSqlClient,
): (query: AuditHistoryQuery) => Promise<AuditHistoryPage> {
  return async (query) => {
    if (
      typeof query.principalId !== 'string' ||
      query.principalId.length === 0 ||
      query.principalId.length > 256 ||
      !Number.isSafeInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100 ||
      !validAuditTimeRange(query)
    ) {
      throw new AuditHistoryUnavailable();
    }
    const cursor = query.cursor == null ? null : positiveBigint(query.cursor);
    try {
      const result = await client.query(
        `SELECT event_id::text AS event_id,
                occurred_at_ms::text AS occurred_at_ms,
                kind, request_id, principal_id, credential_id, policy_versions, details
         FROM gateway_audit_events
         WHERE principal_id = $1
           AND ($2::bigint IS NULL OR event_id < $2::bigint)
           AND ($4::bigint IS NULL OR occurred_at_ms >= $4::bigint)
           AND ($5::bigint IS NULL OR occurred_at_ms < $5::bigint)
         ORDER BY event_id DESC
         LIMIT $3`,
        [
          query.principalId,
          cursor?.text ?? null,
          query.limit + 1,
          query.fromMs ?? null,
          query.toMs ?? null,
        ],
      );
      if (result.rows.length > query.limit + 1) throw new AuditHistoryUnavailable();
      let previous = cursor?.numeric ?? MAX_BIGINT + 1n;
      const events: AuditHistoryEvent[] = result.rows.map((value) => {
        const row = object(value);
        const eventId = positiveBigint(row.event_id);
        if (eventId.numeric >= previous || row.principal_id !== query.principalId) {
          throw new AuditHistoryUnavailable();
        }
        previous = eventId.numeric;
        const details = object(row.details);
        const projected = projectGatewayAuditEvent(
          {
            ...details,
            kind: row.kind,
            requestId: row.request_id,
            principalId: row.principal_id,
            credentialId: row.credential_id,
            policyVersions: row.policy_versions,
          },
          occurredAt(row.occurred_at_ms),
        );
        if (
          !matchesAuditTimeRange(projected.occurredAt, query) ||
          projected.principalId !== query.principalId ||
          projected.credentialId === null ||
          projected.policyVersions === null
        ) {
          throw new AuditHistoryUnavailable();
        }
        return {
          eventId: eventId.text,
          occurredAt: projected.occurredAt,
          kind: projected.kind,
          requestId: projected.requestId,
          principalId: projected.principalId,
          credentialId: projected.credentialId,
          policyVersions: projected.policyVersions,
          details: projected.details,
        };
      });
      const page = events.slice(0, query.limit);
      return {
        events: page,
        nextCursor: events.length > query.limit ? (page.at(-1)?.eventId ?? null) : null,
      };
    } catch {
      throw new AuditHistoryUnavailable();
    }
  };
}
