import { type AuditTimeRange, matchesAuditTimeRange, validAuditTimeRange } from './time-range.ts';

export interface AuditHistoryFilters extends AuditTimeRange {
  readonly requestId?: string;
  readonly modelAlias?: string;
}

export function validAuditHistoryFilters(filters: AuditHistoryFilters): boolean {
  return (
    validAuditTimeRange(filters) &&
    (filters.requestId === undefined ||
      (typeof filters.requestId === 'string' &&
        filters.requestId.length <= 256 &&
        /^[A-Za-z0-9][A-Za-z0-9._+:/@-]*$/u.test(filters.requestId))) &&
    (filters.modelAlias === undefined ||
      (typeof filters.modelAlias === 'string' &&
        filters.modelAlias.trim().length > 0 &&
        filters.modelAlias.length <= 256 &&
        !/[\p{Cc}]/u.test(filters.modelAlias)))
  );
}

/** Match only the event's allowlisted projection, never an arbitrary stored alias field. */
export function matchesAuditHistoryFilters(
  occurredAt: number,
  details: Readonly<Record<string, unknown>>,
  filters: AuditHistoryFilters,
  requestId?: string,
): boolean {
  return (
    matchesAuditTimeRange(occurredAt, filters) &&
    (filters.requestId === undefined || requestId === filters.requestId) &&
    (filters.modelAlias === undefined || details.modelAlias === filters.modelAlias)
  );
}
