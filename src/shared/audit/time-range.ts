export interface AuditTimeRange {
  readonly fromMs?: number;
  readonly toMs?: number;
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function validAuditTimeRange(range: AuditTimeRange): boolean {
  return (
    (range.fromMs === undefined || timestamp(range.fromMs)) &&
    (range.toMs === undefined || timestamp(range.toMs)) &&
    (range.fromMs === undefined || range.toMs === undefined || range.fromMs < range.toMs)
  );
}

export function matchesAuditTimeRange(occurredAt: number, range: AuditTimeRange): boolean {
  return (
    (range.fromMs === undefined || occurredAt >= range.fromMs) &&
    (range.toMs === undefined || occurredAt < range.toMs)
  );
}

/** A null result denotes malformed input; an empty object is an unbounded range. */
export function parseAuditTimeRange(params: URLSearchParams): AuditTimeRange | null {
  const result: { fromMs?: number; toMs?: number } = {};
  for (const [parameter, field] of [
    ['from_ms', 'fromMs'],
    ['to_ms', 'toMs'],
  ] as const) {
    const raw = params.get(parameter);
    if (raw === null) continue;
    if (raw.length > 16 || !/^(?:0|[1-9][0-9]*)$/u.test(raw) || !timestamp(Number(raw)))
      return null;
    result[field] = Number(raw);
  }
  return validAuditTimeRange(result) ? result : null;
}
