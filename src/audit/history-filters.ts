import { type AuditTimeRange, matchesAuditTimeRange, validAuditTimeRange } from './time-range.ts';

export interface AuditHistoryFilters extends AuditTimeRange {
  readonly modelAlias?: string;
}

export function validAuditHistoryFilters(filters: AuditHistoryFilters): boolean {
  return (
    validAuditTimeRange(filters) &&
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
): boolean {
  return (
    matchesAuditTimeRange(occurredAt, filters) &&
    (filters.modelAlias === undefined || details.modelAlias === filters.modelAlias)
  );
}
