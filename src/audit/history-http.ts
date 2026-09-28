import type { AuditHistoryEvent, AuditHistoryPage } from './postgres-audit-history.ts';
import { projectGatewayAuditEvent } from './postgres-gateway-audit.ts';

import {
  type AuditTimeRange,
  matchesAuditTimeRange,
  parseAuditTimeRange,
  validAuditTimeRange,
} from './time-range.ts';

const MAX_BIGINT = 9_223_372_036_854_775_807n;

export class InvalidAuditHistoryQuery extends Error {
  constructor() {
    super('Invalid audit history query');
    this.name = 'InvalidAuditHistoryQuery';
  }
}

function eventId(value: unknown): bigint {
  if (typeof value !== 'string' || value.length > 19 || !/^[1-9][0-9]*$/u.test(value)) {
    throw new InvalidAuditHistoryQuery();
  }
  const parsed = BigInt(value);
  if (parsed > MAX_BIGINT) throw new InvalidAuditHistoryQuery();
  return parsed;
}

function principalId(value: string): boolean {
  return value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._+:/@-]*$/u.test(value);
}

export function parseAuditHistoryQuery(url: URL): AuditTimeRange & {
  readonly requestedPrincipalId: string | null;
  readonly format: 'json' | 'csv';
  readonly limit: number;
  readonly cursor: string | null;
} {
  for (const key of url.searchParams.keys()) {
    if (
      !['principal_id', 'limit', 'cursor', 'from_ms', 'to_ms', 'format'].includes(key) ||
      url.searchParams.getAll(key).length !== 1
    ) {
      throw new InvalidAuditHistoryQuery();
    }
  }
  const requestedPrincipalId = url.searchParams.get('principal_id');
  if (requestedPrincipalId !== null && !principalId(requestedPrincipalId)) {
    throw new InvalidAuditHistoryQuery();
  }
  const format = url.searchParams.get('format') ?? 'json';
  if (format !== 'json' && format !== 'csv') throw new InvalidAuditHistoryQuery();
  const rawLimit = url.searchParams.get('limit');
  if (rawLimit !== null && !/^(?:[1-9]|[1-9][0-9]|100)$/u.test(rawLimit)) {
    throw new InvalidAuditHistoryQuery();
  }
  const cursor = url.searchParams.get('cursor');
  if (cursor !== null) eventId(cursor);
  const range = parseAuditTimeRange(url.searchParams);
  if (range === null) throw new InvalidAuditHistoryQuery();
  return {
    ...range,
    requestedPrincipalId,
    format,
    limit: rawLimit === null ? 50 : Number(rawLimit),
    cursor,
  };
}

/** Reproject an injected reader's output before it crosses the HTTP boundary. */
export function projectAuditHistoryPage(
  value: AuditHistoryPage,
  targetPrincipalId: string,
  limit: number,
  cursor: string | null,
  range: AuditTimeRange = {},
): AuditHistoryPage {
  if (
    !validAuditTimeRange(range) ||
    !value ||
    !Array.isArray(value.events) ||
    value.events.length > limit
  ) {
    throw new InvalidAuditHistoryQuery();
  }
  let previous = cursor === null ? MAX_BIGINT + 1n : eventId(cursor);
  const events: AuditHistoryEvent[] = value.events.map((input) => {
    if (!input || typeof input !== 'object') throw new InvalidAuditHistoryQuery();
    const id = eventId(input.eventId);
    if (id >= previous || input.principalId !== targetPrincipalId) {
      throw new InvalidAuditHistoryQuery();
    }
    previous = id;
    const projected = projectGatewayAuditEvent(
      {
        ...input.details,
        kind: input.kind,
        requestId: input.requestId,
        principalId: input.principalId,
        credentialId: input.credentialId,
        policyVersions: input.policyVersions,
      },
      input.occurredAt,
    );
    if (
      !matchesAuditTimeRange(projected.occurredAt, range) ||
      projected.principalId !== targetPrincipalId ||
      projected.credentialId === null ||
      projected.policyVersions === null
    ) {
      throw new InvalidAuditHistoryQuery();
    }
    return {
      eventId: input.eventId,
      occurredAt: projected.occurredAt,
      kind: projected.kind,
      requestId: projected.requestId,
      principalId: projected.principalId,
      credentialId: projected.credentialId,
      policyVersions: projected.policyVersions,
      details: projected.details,
    };
  });
  if (
    value.nextCursor !== null &&
    (events.length === 0 || value.nextCursor !== events.at(-1)?.eventId)
  ) {
    throw new InvalidAuditHistoryQuery();
  }
  return { events, nextCursor: value.nextCursor };
}
